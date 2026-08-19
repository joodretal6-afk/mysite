'use strict';

const { MAP_SIZE, hasLineOfSight, dist, angleTo } = require('./world');
const { angleDiff } = require('./rng');

const TICK_RATE = 20;                 // Hz
const MAX_SPEED = 0.5;                // units per tick the rules allow
const SPEED_TOLERANCE = 1.05;         // network jitter allowance before flagging
const TELEPORT_FACTOR = 3;            // displacement beyond this * MAX_SPEED is a jump
const HIT_CONE = 0.055;               // radians
const WEAPON_RANGE = 260;
const DAMAGE = 22;
const RESPAWN_TICKS = 40;

// This server deliberately TRUSTS client-reported positions. That is the flaw a
// movement cheat exploits, and modelling it is the point: the lab measures what a
// detector can still recover once the authority boundary has already been lost.
// The production fix is to clamp, not to detect - see README.
class GameServer {
  constructor({ players, ticks, rng }) {
    this.rng = rng;
    this.totalTicks = ticks;
    this.tick = 0;
    this.players = players.map((p, i) => ({
      id: i,
      controller: p,
      x: rng.range(20, MAP_SIZE - 20),
      y: rng.range(20, MAP_SIZE - 20),
      aim: rng.range(-Math.PI, Math.PI),
      hp: 100,
      alive: true,
      respawnAt: 0,
      lastShotTick: -999,
      aimHistory: [],
      visSince: new Map(),      // enemyId -> tick that enemy became visible to us
      telemetry: newTelemetry(),
    }));
  }

  enemiesOf(p) {
    return this.players.filter((q) => q.id !== p.id && q.alive);
  }

  // The enemy closest to a player's crosshair. The server does not know which
  // target the client *meant*, so every detector feature is built on this
  // inference - exactly what a real anti-cheat has to work with.
  inferTarget(p) {
    let best = null;
    let bestErr = Infinity;
    for (const e of this.enemiesOf(p)) {
      if (dist(p, e) > WEAPON_RANGE) continue;
      const err = Math.abs(angleDiff(p.aim, angleTo(p, e)));
      if (err < bestErr) {
        bestErr = err;
        best = e;
      }
    }
    return best ? { enemy: best, err: bestErr } : null;
  }

  run() {
    for (; this.tick < this.totalTicks; this.tick++) {
      this.stepVisibility();
      const intents = this.collectIntents();
      this.applyMovement(intents);
      this.resolveShots(intents);
      this.stepRespawns();
    }
    return this.players.map((p) => ({ id: p.id, tag: p.controller.tag, telemetry: p.telemetry }));
  }

  stepVisibility() {
    for (const p of this.players) {
      if (!p.alive) continue;
      for (const e of this.enemiesOf(p)) {
        const visible = hasLineOfSight(p.x, p.y, e.x, e.y) && dist(p, e) <= WEAPON_RANGE;
        if (visible) {
          if (!p.visSince.has(e.id)) p.visSince.set(e.id, this.tick);
        } else {
          p.visSince.delete(e.id);
        }
      }
    }
  }

  collectIntents() {
    // Full world state goes to every controller. Honest controllers filter it down
    // to what they can see; a wallhack simply declines to filter. That asymmetry is
    // the information leak the detector has to find downstream.
    const state = {
      tick: this.tick,
      players: this.players.map((p) => ({ id: p.id, x: p.x, y: p.y, alive: p.alive, hp: p.hp })),
    };
    const intents = new Map();
    for (const p of this.players) {
      if (!p.alive) continue;
      intents.set(p.id, p.controller.think(state, { id: p.id, x: p.x, y: p.y, aim: p.aim }));
    }
    return intents;
  }

  applyMovement(intents) {
    for (const p of this.players) {
      const intent = intents.get(p.id);
      if (!intent) continue;

      const nx = Math.max(0, Math.min(MAP_SIZE, intent.x));
      const ny = Math.max(0, Math.min(MAP_SIZE, intent.y));
      const step = Math.hypot(nx - p.x, ny - p.y);

      const t = p.telemetry;
      t.moveTicks++;
      t.stepSum += step;
      if (step > MAX_SPEED * SPEED_TOLERANCE) t.speedViolations++;
      if (step > MAX_SPEED * TELEPORT_FACTOR) t.teleports++;
      if (step > t.maxStep) t.maxStep = step;

      // Input-source evidence. A thumb on a virtual joystick produces continuous
      // headings; WASD on an emulator can only produce 8 of them. Same for aim: a
      // mouse reports quantised pixel deltas, a swipe reports interpolated ones.
      if (step > 0.01) {
        const heading = Math.atan2(ny - p.y, nx - p.x);
        const octant = Math.round(heading / (Math.PI / 4)) * (Math.PI / 4);
        t.headingTicks++;
        if (Math.abs(angleDiff(heading, octant)) < 0.04) t.headingOnOctant++;
      }
      t.aimDeltas.push(angleDiff(intent.aim, p.aim));

      p.x = nx;
      p.y = ny;
      p.aim = intent.aim;
      p.aimHistory.push(intent.aim);
      if (p.aimHistory.length > 6) p.aimHistory.shift();

      this.sampleCrosshair(p);
    }
  }

  // Per-tick crosshair audit. Tracking an enemy through a wall is the single
  // cleanest wallhack tell, because honest play cannot produce it at scale.
  sampleCrosshair(p) {
    const t = p.telemetry;
    const inferred = this.inferTarget(p);
    if (!inferred || inferred.err > 0.2) return;
    t.aimOnTargetTicks++;
    if (!hasLineOfSight(p.x, p.y, inferred.enemy.x, inferred.enemy.y)) t.aimThroughWallTicks++;
  }

  resolveShots(intents) {
    for (const p of this.players) {
      const intent = intents.get(p.id);
      if (!intent || !intent.shoot) continue;

      const t = p.telemetry;
      const inferred = this.inferTarget(p);
      if (!inferred) continue;

      const target = inferred.enemy;
      const visible = hasLineOfSight(p.x, p.y, target.x, target.y);
      const hit = inferred.err < HIT_CONE && visible;

      const interval = this.tick - p.lastShotTick;
      if (p.lastShotTick > -999) t.fireIntervals.push(interval);
      p.lastShotTick = this.tick;

      // Peak turn rate over the three ticks leading into the shot: an aimbot
      // arrives on target faster than a hand on a mouse can move.
      let angVel = 0;
      const h = p.aimHistory;
      for (let i = Math.max(1, h.length - 3); i < h.length; i++) {
        angVel = Math.max(angVel, Math.abs(angleDiff(h[i], h[i - 1])));
      }

      const seenAt = p.visSince.get(target.id);
      if (seenAt !== undefined) t.reactionTicks.push(this.tick - seenAt);

      t.shots++;
      if (hit) t.hits++;
      t.aimErrors.push(inferred.err);
      t.snapVels.push(angVel);
      if (!visible) t.blindShots++;

      p.pendingRecoilCheck = { tick: this.tick, targetAngle: angleTo(p, target) };

      if (hit) {
        target.hp -= DAMAGE;
        if (target.hp <= 0) {
          target.alive = false;
          target.respawnAt = this.tick + RESPAWN_TICKS;
          target.visSince.clear();
          t.kills++;
        }
      }
    }

    // Recoil recovery, sampled two ticks after each shot: a human is kicked off
    // target and has to drag back; no-recoil leaves the crosshair welded on.
    for (const p of this.players) {
      const pending = p.pendingRecoilCheck;
      if (!pending || this.tick !== pending.tick + 2) continue;
      p.telemetry.postShotDrift.push(Math.abs(angleDiff(p.aim, pending.targetAngle)));
      p.pendingRecoilCheck = null;
    }
  }

  stepRespawns() {
    for (const p of this.players) {
      if (p.alive || this.tick < p.respawnAt) continue;
      p.alive = true;
      p.hp = 100;
      p.x = this.rng.range(20, MAP_SIZE - 20);
      p.y = this.rng.range(20, MAP_SIZE - 20);
      p.lastShotTick = -999;
      p.visSince.clear();
    }
  }
}

function newTelemetry() {
  return {
    shots: 0, hits: 0, kills: 0, blindShots: 0,
    aimErrors: [], snapVels: [], reactionTicks: [], fireIntervals: [], postShotDrift: [],
    moveTicks: 0, stepSum: 0, maxStep: 0, speedViolations: 0, teleports: 0,
    aimOnTargetTicks: 0, aimThroughWallTicks: 0,
    headingTicks: 0, headingOnOctant: 0, aimDeltas: [],
  };
}

module.exports = { GameServer, TICK_RATE, MAX_SPEED, HIT_CONE, WEAPON_RANGE };

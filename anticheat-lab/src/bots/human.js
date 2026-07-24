'use strict';

const { MAP_SIZE, hasLineOfSight, dist, angleTo } = require('../world');
const { angleDiff, clamp } = require('../rng');
const { MAX_SPEED, WEAPON_RANGE } = require('../server');

// Baseline "honest player" model. Everything the detector calls suspicious is
// defined relative to this distribution, so its realism sets the false-positive
// floor for the whole lab: make it too robotic and every real player looks like a
// cheater.
const HUMAN = {
  maxTurn: 0.30,        // rad/tick ~ 6 rad/s, a realistic mouse sweep
  tremor: 0.045,        // hand noise, rad/tick
  reactionMean: 5.0,    // ticks (250 ms)
  reactionSd: 1.6,      // humans are inconsistent, and that variance is the tell
  fireCone: 0.10,       // how close to on-target before pulling the trigger
  cooldownMean: 6.5,    // ticks between shots
  cooldownSd: 1.1,
  recoilKick: 0.055,    // rad pushed off target per shot
};

// A mouse and a thumb are different instruments. Emulator play is not cheating -
// plenty of games allow it - but it has to be separable, because emulator input
// mimics some aimbot signals (steadier, faster) and would otherwise poison the
// cheat detector's false-positive rate.
const INPUT_SOURCE = {
  touch:    { maxTurn: 0.30, tremor: 0.045, quantum: 0,      octantSnap: false },
  emulator: { maxTurn: 0.55, tremor: 0.020, quantum: 0.0025, octantSnap: true },
};

class HumanBot {
  constructor(rng, opts = {}) {
    this.rng = rng;
    this.tag = opts.tag || 'clean';
    this.input = INPUT_SOURCE[opts.inputSource || 'touch'];
    this.inputSource = opts.inputSource || 'touch';
    this.p = { ...HUMAN, ...this.input, ...(opts.overrides || {}) };
    this.aim = 0;
    this.cooldown = 0;
    this.acquireTimer = null;
    this.currentTargetId = null;
    this.waypoint = null;
  }

  // Honest clients only ever reason about what the renderer could have drawn.
  visibleEnemies(state, self) {
    return state.players.filter(
      (e) => e.id !== self.id && e.alive
        && dist(self, e) <= WEAPON_RANGE
        && hasLineOfSight(self.x, self.y, e.x, e.y),
    );
  }

  pickTarget(candidates, self) {
    let best = null;
    let bestD = Infinity;
    for (const e of candidates) {
      const d = dist(self, e);
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  // Reaction is charged once per newly acquired target, then spent down.
  onTarget(target) {
    if (!target) {
      this.currentTargetId = null;
      this.acquireTimer = null;
      return false;
    }
    if (target.id !== this.currentTargetId) {
      this.currentTargetId = target.id;
      this.acquireTimer = Math.max(2, this.rng.gauss(this.p.reactionMean, this.p.reactionSd));
    }
    if (this.acquireTimer > 0) {
      this.acquireTimer--;
      return false;
    }
    return true;
  }

  steer(self) {
    if (!this.waypoint || dist(self, this.waypoint) < 8) {
      this.waypoint = { x: this.rng.range(10, MAP_SIZE - 10), y: this.rng.range(10, MAP_SIZE - 10) };
    }
    let a = angleTo(self, this.waypoint);
    // Keyboard movement cannot express an arbitrary heading - it snaps to the 8
    // directions WASD can encode.
    if (this.p.octantSnap) a = Math.round(a / (Math.PI / 4)) * (Math.PI / 4);
    return { dx: Math.cos(a) * MAX_SPEED, dy: Math.sin(a) * MAX_SPEED };
  }

  // Mouse deltas arrive as whole counts, so the aim angle lands on a lattice.
  quantiseAim() {
    if (!this.p.quantum) return;
    this.aim = Math.round(this.aim / this.p.quantum) * this.p.quantum;
  }

  // Turn toward the target under a rate cap, with tremor. The cap is what an
  // aimbot has to break to be fast, and breaking it is what shows up as a snap.
  track(self, target, maxTurn, noise) {
    if (!target) {
      this.aim += this.rng.gauss(0, noise);
      return;
    }
    const want = angleTo(self, target);
    const delta = angleDiff(want, this.aim);
    this.aim += clamp(delta, -maxTurn, maxTurn) + this.rng.gauss(0, noise);
  }

  think(state, self) {
    this.aim = self.aim;
    const target = this.pickTarget(this.visibleEnemies(state, self), self);
    const ready = this.onTarget(target);

    this.track(self, target, this.p.maxTurn, this.p.tremor);

    let shoot = false;
    if (this.cooldown > 0) this.cooldown--;
    if (ready && target && this.cooldown <= 0) {
      const err = Math.abs(angleDiff(this.aim, angleTo(self, target)));
      if (err < this.p.fireCone) {
        shoot = true;
        this.cooldown = Math.max(5, this.rng.gauss(this.p.cooldownMean, this.p.cooldownSd));
        this.aim += this.rng.gauss(0, 1) > 0 ? this.p.recoilKick : -this.p.recoilKick;
      }
    }

    this.quantiseAim();
    const move = this.steer(self);
    return { x: self.x + move.dx, y: self.y + move.dy, aim: this.aim, shoot };
  }
}

module.exports = { HumanBot, HUMAN, INPUT_SOURCE };

'use strict';

const { hasLineOfSight, dist, angleTo } = require('../world');
const { angleDiff, clamp, lerp } = require('../rng');
const { MAX_SPEED, WEAPON_RANGE } = require('../server');
const { HumanBot } = require('./human');

// The stealth dial is the whole experiment. 0 is a blatant cheat that any check
// catches; 10 is tuned to sit inside the human distribution. Every behaviour
// below interpolates its parameters from "obvious" to "human" across that range,
// so sweeping it produces a detectability curve instead of a yes/no answer.
//
// Nothing here hides the cheat from the process, the memory scanner, or the
// integrity check. It changes only what the player *does*, which is the layer a
// server-side detector actually observes - and the only layer worth studying
// when you own the server.
const BEHAVIOURS = {
  // Perfect target acquisition. Blatant: instant, zero error. Subtle: human-ish
  // error and delay, assisting only some shots.
  aimbot: (t) => ({
    aimError:   lerp(0.001, 0.075, t),
    reaction:   lerp(0, 5.0, t),
    maxTurn:    lerp(3.0, 0.32, t),
    assistRate: lerp(1.0, 0.35, t),
  }),
  // Sees through geometry. Subtle version only uses the information at short
  // range and declines to track most of the time - "peek" cheating.
  wallhack: (t) => ({
    useRate:  lerp(1.0, 0.22, t),
    maxRange: lerp(WEAPON_RANGE, 110, t),
  }),
  // Movement above the server's speed rule.
  speedhack: (t) => ({ multiplier: lerp(2.5, 1.06, t) }),
  // Discrete position jumps.
  teleport: (t) => ({ everyTicks: Math.round(lerp(25, 260, t)), magnitude: lerp(110, 11, t) }),
  // Suppressed recoil kick.
  norecoil: (t) => ({ kick: lerp(0.0, 0.05, t) }),
  // Fire rate below the human floor.
  rapidfire: (t) => ({ cooldown: lerp(1.0, 5.2, t) }),
};

class CheatBot extends HumanBot {
  constructor(rng, opts = {}) {
    super(rng, { ...opts, tag: 'cheat' });
    this.behaviour = opts.behaviour;
    this.stealth = opts.stealth;           // 0 = blatant .. 10 = human-like
    this.cfg = BEHAVIOURS[this.behaviour](clamp(opts.stealth / 10, 0, 1));
    this.tickCount = 0;
  }

  // A wallhack is not a different aiming skill, it is a different candidate list.
  visibleEnemies(state, self) {
    const honest = super.visibleEnemies(state, self);
    if (this.behaviour !== 'wallhack') return honest;
    if (this.rng.next() > this.cfg.useRate) return honest;

    const seen = new Set(honest.map((e) => e.id));
    const through = state.players.filter(
      (e) => e.id !== self.id && e.alive && !seen.has(e.id) && dist(self, e) <= this.cfg.maxRange,
    );
    return honest.concat(through);
  }

  onTarget(target) {
    if (this.behaviour !== 'aimbot') return super.onTarget(target);
    if (!target) { this.currentTargetId = null; this.acquireTimer = null; return false; }
    if (target.id !== this.currentTargetId) {
      this.currentTargetId = target.id;
      this.acquireTimer = this.cfg.reaction > 0
        ? Math.max(0, this.rng.gauss(this.cfg.reaction, this.cfg.reaction * 0.3))
        : 0;
    }
    if (this.acquireTimer > 0) { this.acquireTimer--; return false; }
    return true;
  }

  track(self, target, maxTurn, noise) {
    if (this.behaviour !== 'aimbot' || !target) return super.track(self, target, maxTurn, noise);
    // Assist only a fraction of the time at high stealth; the rest is honest aim,
    // which is what smears the statistical signature.
    if (this.rng.next() > this.cfg.assistRate) return super.track(self, target, maxTurn, noise);

    const want = angleTo(self, target) + this.rng.gauss(0, this.cfg.aimError);
    const delta = angleDiff(want, this.aim);
    this.aim += clamp(delta, -this.cfg.maxTurn, this.cfg.maxTurn);
  }

  steer(self) {
    const base = super.steer(self);
    if (this.behaviour === 'speedhack') {
      return { dx: base.dx * this.cfg.multiplier, dy: base.dy * this.cfg.multiplier };
    }
    if (this.behaviour === 'teleport' && this.tickCount % this.cfg.everyTicks === 0 && this.tickCount > 0) {
      const a = this.rng.range(-Math.PI, Math.PI);
      return { dx: Math.cos(a) * this.cfg.magnitude, dy: Math.sin(a) * this.cfg.magnitude };
    }
    return base;
  }

  think(state, self) {
    this.tickCount++;
    if (this.behaviour === 'norecoil') this.p.recoilKick = this.cfg.kick;
    if (this.behaviour === 'rapidfire') {
      this.p.cooldownMean = this.cfg.cooldown;
      this.p.cooldownSd = 0.2;
    }

    const intent = super.think(state, self);

    // The human bot floors its cooldown at 5 ticks; a rapidfire cheat is defined
    // by ignoring that floor, so it is re-applied after the fact.
    if (this.behaviour === 'rapidfire' && intent.shoot) {
      this.cooldown = Math.max(0.5, this.rng.gauss(this.cfg.cooldown, 0.2));
    }
    return intent;
  }
}

module.exports = { CheatBot, BEHAVIOURS };

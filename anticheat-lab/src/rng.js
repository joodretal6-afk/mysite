'use strict';

// Deterministic RNG so every experiment run is reproducible from its seed.
function makeRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  let spare = null;
  const gauss = (mean = 0, sd = 1) => {
    if (spare !== null) {
      const v = spare;
      spare = null;
      return mean + sd * v;
    }
    let u = 0, v = 0, s = 0;
    do {
      u = next() * 2 - 1;
      v = next() * 2 - 1;
      s = u * u + v * v;
    } while (s === 0 || s >= 1);
    const f = Math.sqrt((-2 * Math.log(s)) / s);
    spare = v * f;
    return mean + sd * u * f;
  };

  return {
    next,
    gauss,
    range: (lo, hi) => lo + next() * (hi - lo),
    int: (lo, hi) => Math.floor(lo + next() * (hi - lo)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
  };
}

const lerp = (a, b, t) => a + (b - a) * t;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// Shortest signed difference between two angles, in [-PI, PI].
function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

module.exports = { makeRng, lerp, clamp, angleDiff };

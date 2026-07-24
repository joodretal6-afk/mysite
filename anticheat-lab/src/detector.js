'use strict';

const MIN_SHOTS = 8;      // below this there is not enough evidence to judge anyone

const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const sd = (a) => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
};
const pct = (a, q) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

// Each feature declares which direction is suspicious, so a single sign
// convention turns all of them into "higher z = more suspect".
// dir: +1 means an unusually HIGH value is suspicious, -1 means unusually LOW.
const CHEAT_FEATURES = {
  accuracy:        { dir: +1, of: (f) => f.accuracy },
  aimErrorMean:    { dir: -1, of: (f) => f.aimErrorMean },
  aimErrorSd:      { dir: -1, of: (f) => f.aimErrorSd },
  snapVelP95:      { dir: +1, of: (f) => f.snapVelP95 },
  reactionMean:    { dir: -1, of: (f) => f.reactionMean },
  reactionSd:      { dir: -1, of: (f) => f.reactionSd },
  wallAimRatio:    { dir: +1, of: (f) => f.wallAimRatio },
  blindShotRatio:  { dir: +1, of: (f) => f.blindShotRatio },
  speedViolRate:   { dir: +1, of: (f) => f.speedViolRate },
  teleportRate:    { dir: +1, of: (f) => f.teleportRate },
  fireIntervalMin: { dir: -1, of: (f) => f.fireIntervalMin },
  fireIntervalSd:  { dir: -1, of: (f) => f.fireIntervalSd },
  postShotDrift:   { dir: -1, of: (f) => f.postShotDrift },
};

// Kept separate on purpose: emulator input is not cheating. Mixing these into the
// cheat score would ban a legitimate population and inflate the false-positive
// rate, which is the most expensive mistake an anti-cheat can make.
const EMULATOR_FEATURES = {
  octantRate:     { dir: +1, of: (f) => f.octantRate },
  aimLatticeFit:  { dir: +1, of: (f) => f.aimLatticeFit },
  turnRateP99:    { dir: +1, of: (f) => f.turnRateP99 },
  aimDeltaSd:     { dir: -1, of: (f) => f.aimDeltaSd },
};

const LATTICE_QUANTUM = 0.0025;

function extractFeatures(t) {
  if (t.shots < MIN_SHOTS) return null;

  const deltas = t.aimDeltas.filter((d) => Math.abs(d) > 1e-9);
  const latticeResidual = mean(
    deltas.map((d) => {
      const r = Math.abs(d / LATTICE_QUANTUM);
      return Math.abs(r - Math.round(r));
    }),
  );

  return {
    accuracy:        t.hits / t.shots,
    aimErrorMean:    mean(t.aimErrors),
    aimErrorSd:      sd(t.aimErrors),
    snapVelP95:      pct(t.snapVels, 0.95),
    reactionMean:    t.reactionTicks.length ? mean(t.reactionTicks) : 99,
    reactionSd:      t.reactionTicks.length > 1 ? sd(t.reactionTicks) : 99,
    wallAimRatio:    t.aimOnTargetTicks ? t.aimThroughWallTicks / t.aimOnTargetTicks : 0,
    blindShotRatio:  t.blindShots / t.shots,
    speedViolRate:   t.moveTicks ? t.speedViolations / t.moveTicks : 0,
    teleportRate:    t.moveTicks ? t.teleports / t.moveTicks : 0,
    fireIntervalMin: t.fireIntervals.length ? Math.min(...t.fireIntervals) : 99,
    fireIntervalSd:  sd(t.fireIntervals),
    postShotDrift:   mean(t.postShotDrift),
    // 0.25 is the mean residual of uniformly distributed angles; near 0 means the
    // aim values sit on a mouse-count lattice.
    aimLatticeFit:   0.25 - latticeResidual,
    octantRate:      t.headingTicks ? t.headingOnOctant / t.headingTicks : 0,
    turnRateP99:     pct(deltas.map(Math.abs), 0.99),
    aimDeltaSd:      sd(deltas),
  };
}

// Baseline built from known-clean players only. Everything downstream is measured
// in standard deviations from this population, so the lab never hard-codes a
// magic threshold that would not survive contact with a real playerbase.
function calibrate(cleanFeatureRows) {
  const stats = {};
  const names = [...Object.keys(CHEAT_FEATURES), ...Object.keys(EMULATOR_FEATURES)];
  for (const name of names) {
    const spec = CHEAT_FEATURES[name] || EMULATOR_FEATURES[name];
    const vals = cleanFeatureRows.map(spec.of).filter((v) => Number.isFinite(v));
    stats[name] = { mean: mean(vals), sd: Math.max(sd(vals), 1e-6) };
  }
  return stats;
}

function scoreWith(featureSet, baseline, f) {
  const contributions = {};
  let total = 0;
  for (const [name, spec] of Object.entries(featureSet)) {
    const v = spec.of(f);
    if (!Number.isFinite(v)) continue;
    const z = ((v - baseline[name].mean) / baseline[name].sd) * spec.dir;
    const c = Math.max(0, z);       // only evidence *against* the player counts
    contributions[name] = c;
    total += c;
  }
  return { total, contributions };
}

function score(baseline, f) {
  const cheat = scoreWith(CHEAT_FEATURES, baseline, f);
  const emu = scoreWith(EMULATOR_FEATURES, baseline, f);
  return {
    cheatScore: cheat.total,
    emulatorScore: emu.total,
    cheatEvidence: cheat.contributions,
    emulatorEvidence: emu.contributions,
  };
}

module.exports = { extractFeatures, calibrate, score, CHEAT_FEATURES, EMULATOR_FEATURES, MIN_SHOTS, mean, sd, pct };

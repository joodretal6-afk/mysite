'use strict';

const { makeRng } = require('./rng');
const { GameServer } = require('./server');
const { HumanBot } = require('./bots/human');
const { CheatBot, BEHAVIOURS } = require('./bots/cheater');
const { extractFeatures, calibrate, score, MIN_SHOTS } = require('./detector');
const { auc, thresholdAtFpr, rateAbove } = require('./metrics');

const CONFIG = {
  playersPerMatch: 12,
  cheatersPerMatch: 3,
  ticksPerMatch: 900,
  calibrationMatches: 14,
  matchesPerCondition: 8,
  emulatorShare: 0.4,          // fraction of honest players on an emulator
  stealthLevels: [0, 2, 4, 6, 8, 10],
  targetFpr: 0.01,
  seed: 20260724,
};

function playMatch({ seed, behaviour, stealth, cheaters, emulatorShare }) {
  const rng = makeRng(seed);
  const bots = [];
  for (let i = 0; i < CONFIG.playersPerMatch; i++) {
    const inputSource = rng.next() < emulatorShare ? 'emulator' : 'touch';
    bots.push(i < cheaters && behaviour
      ? new CheatBot(rng, { behaviour, stealth, inputSource })
      : new HumanBot(rng, { inputSource }));
  }
  const results = new GameServer({ players: bots, ticks: CONFIG.ticksPerMatch, rng }).run();

  return results.map((r, i) => {
    const f = extractFeatures(r.telemetry);
    return f && { features: f, isCheat: bots[i].tag === 'cheat', isEmulator: bots[i].inputSource === 'emulator' };
  }).filter(Boolean);
}

function main() {
  // Phase 1 - calibrate on honest play only. A baseline contaminated with
  // cheaters would normalise their behaviour into "normal" and blind the detector.
  const calibrationRows = [];
  for (let m = 0; m < CONFIG.calibrationMatches; m++) {
    calibrationRows.push(...playMatch({
      seed: CONFIG.seed + m, behaviour: null, stealth: 0,
      cheaters: 0, emulatorShare: CONFIG.emulatorShare,
    }));
  }
  const touchOnly = calibrationRows.filter((r) => !r.isEmulator).map((r) => r.features);
  const baseline = calibrate(touchOnly);

  console.log('='.repeat(78));
  console.log('ANTI-CHEAT DETECTION LAB - behavioural detectability sweep');
  console.log('='.repeat(78));
  console.log(`baseline: ${touchOnly.length} honest touch players over ${CONFIG.calibrationMatches} matches`);
  console.log(`operating point: threshold fixed at ${(CONFIG.targetFpr * 100).toFixed(0)}% false-positive rate`);
  console.log(`each cell: ${CONFIG.matchesPerCondition} matches x ${CONFIG.cheatersPerMatch} cheaters`);
  console.log(`players below ${MIN_SHOTS} shots are excluded as insufficient evidence\n`);

  // Phase 2 - sweep every behaviour across the stealth dial.
  const cleanPool = [];
  const cells = {};
  let seedCursor = CONFIG.seed + 10_000;

  for (const behaviour of Object.keys(BEHAVIOURS)) {
    cells[behaviour] = {};
    for (const stealth of CONFIG.stealthLevels) {
      const cheatScores = [];
      for (let m = 0; m < CONFIG.matchesPerCondition; m++) {
        const rows = playMatch({
          seed: seedCursor++, behaviour, stealth,
          cheaters: CONFIG.cheatersPerMatch, emulatorShare: CONFIG.emulatorShare,
        });
        for (const r of rows) {
          const s = score(baseline, r.features);
          if (r.isCheat) cheatScores.push(s.cheatScore);
          else cleanPool.push(s.cheatScore);
        }
      }
      cells[behaviour][stealth] = cheatScores;
    }
  }

  const threshold = thresholdAtFpr(cleanPool, CONFIG.targetFpr);
  const actualFpr = rateAbove(cleanPool, threshold);

  console.log(`clean population: ${cleanPool.length} players | threshold = ${threshold.toFixed(2)} `
    + `| realised FPR = ${(actualFpr * 100).toFixed(2)}%\n`);

  console.log('DETECTION RATE (%) at that fixed threshold - stealth 0 = blatant, 10 = human-like');
  console.log('-'.repeat(78));
  console.log(['behaviour'.padEnd(12), ...CONFIG.stealthLevels.map((s) => `s=${s}`.padStart(8))].join(''));
  console.log('-'.repeat(78));
  for (const [behaviour, byStealth] of Object.entries(cells)) {
    const row = CONFIG.stealthLevels.map((s) => {
      const rate = rateAbove(byStealth[s], threshold) * 100;
      return `${rate.toFixed(0)}%`.padStart(8);
    });
    console.log([behaviour.padEnd(12), ...row].join(''));
  }

  console.log(`\nSEPARABILITY (AUC) - 1.00 = perfectly separable, 0.50 = indistinguishable`);
  console.log('-'.repeat(78));
  console.log(['behaviour'.padEnd(12), ...CONFIG.stealthLevels.map((s) => `s=${s}`.padStart(8))].join(''));
  console.log('-'.repeat(78));
  const blindSpots = [];
  for (const [behaviour, byStealth] of Object.entries(cells)) {
    const row = CONFIG.stealthLevels.map((s) => {
      const a = auc(byStealth[s], cleanPool);
      if (a < 0.75) blindSpots.push({ behaviour, stealth: s, auc: a });
      return a.toFixed(2).padStart(8);
    });
    console.log([behaviour.padEnd(12), ...row].join(''));
  }

  // Phase 3 - which signals carry each behaviour. This is the actionable part:
  // it says which server-side check to build first for each threat.
  console.log('\nDOMINANT EVIDENCE per behaviour (blatant vs. subtle)');
  console.log('-'.repeat(78));
  for (const behaviour of Object.keys(BEHAVIOURS)) {
    for (const stealth of [0, 8]) {
      const rows = playMatch({
        seed: seedCursor++, behaviour, stealth,
        cheaters: CONFIG.cheatersPerMatch, emulatorShare: 0,
      }).filter((r) => r.isCheat);
      const agg = {};
      for (const r of rows) {
        for (const [k, v] of Object.entries(score(baseline, r.features).cheatEvidence)) {
          agg[k] = (agg[k] || 0) + v / rows.length;
        }
      }
      const top = Object.entries(agg).sort((a, b) => b[1] - a[1]).slice(0, 3)
        .filter(([, v]) => v > 0.5)
        .map(([k, v]) => `${k} (${v.toFixed(1)}o)`);
      console.log(`${behaviour.padEnd(12)} s=${String(stealth).padEnd(3)} ${top.join(', ') || 'no signal above noise'}`);
    }
  }

  // Phase 4 - the emulator axis, scored and reported separately from cheating.
  const emuRows = calibrationRows.filter((r) => r.isEmulator).map((r) => score(baseline, r.features));
  const touchRows = calibrationRows.filter((r) => !r.isEmulator).map((r) => score(baseline, r.features));
  const emuAuc = auc(emuRows.map((r) => r.emulatorScore), touchRows.map((r) => r.emulatorScore));
  const emuThreshold = thresholdAtFpr(touchRows.map((r) => r.emulatorScore), CONFIG.targetFpr);
  const emuDetect = rateAbove(emuRows.map((r) => r.emulatorScore), emuThreshold);

  console.log('\nINPUT-SOURCE CLASSIFICATION (emulator vs. touch) - honest players only');
  console.log('-'.repeat(78));
  console.log(`AUC ${emuAuc.toFixed(3)} | ${(emuDetect * 100).toFixed(0)}% of emulator players identified `
    + `at ${(CONFIG.targetFpr * 100).toFixed(0)}% FPR`);
  console.log(`(${emuRows.length} emulator vs. ${touchRows.length} touch players)`);
  const cheatScoreEmu = emuRows.reduce((s, r) => s + r.cheatScore, 0) / (emuRows.length || 1);
  const cheatScoreTouch = touchRows.reduce((s, r) => s + r.cheatScore, 0) / (touchRows.length || 1);
  console.log(`honest emulator players score ${cheatScoreEmu.toFixed(2)} on the CHEAT axis vs. `
    + `${cheatScoreTouch.toFixed(2)} for touch`);
  console.log(cheatScoreEmu > cheatScoreTouch * 1.5
    ? '  -> emulator input is leaking into the cheat score: separate your lobbies or\n'
      + '     calibrate the cheat baseline per input source, or you will ban honest players.'
    : '  -> emulator input is not inflating the cheat score at this baseline.');

  console.log('\nBLIND SPOTS (AUC < 0.75 - behaviour is effectively invisible here)');
  console.log('-'.repeat(78));
  if (!blindSpots.length) console.log('none at the stealth levels tested');
  for (const b of blindSpots.sort((x, y) => x.auc - y.auc)) {
    console.log(`  ${b.behaviour.padEnd(12)} stealth ${String(b.stealth).padStart(2)}  AUC ${b.auc.toFixed(2)}`);
  }
  console.log('');
}

main();

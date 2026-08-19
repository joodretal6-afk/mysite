'use strict';

// Area under the ROC curve via the rank-sum identity, with ties averaged.
// AUC answers "how well does this score separate cheaters from honest players",
// independent of whatever threshold you eventually pick.
function auc(positives, negatives) {
  if (!positives.length || !negatives.length) return NaN;
  const all = [
    ...positives.map((v) => ({ v, pos: true })),
    ...negatives.map((v) => ({ v, pos: false })),
  ].sort((a, b) => a.v - b.v);

  let i = 0;
  let rankSum = 0;
  while (i < all.length) {
    let j = i;
    while (j + 1 < all.length && all[j + 1].v === all[i].v) j++;
    const avgRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) if (all[k].pos) rankSum += avgRank;
    i = j + 1;
  }
  const n1 = positives.length;
  const n0 = negatives.length;
  return (rankSum - (n1 * (n1 + 1)) / 2) / (n1 * n0);
}

// The threshold that keeps false positives at or below the target rate. Banning
// honest players is far more costly than missing a cheater, so the operating
// point is chosen on the clean population first and detection is whatever it
// happens to buy at that price.
function thresholdAtFpr(negatives, targetFpr) {
  if (!negatives.length) return Infinity;
  const s = [...negatives].sort((a, b) => b - a);
  const idx = Math.floor(targetFpr * s.length);
  return idx < s.length ? s[idx] : s[s.length - 1];
}

const rateAbove = (values, threshold) =>
  (values.length ? values.filter((v) => v >= threshold).length / values.length : 0);

module.exports = { auc, thresholdAtFpr, rateAbove };

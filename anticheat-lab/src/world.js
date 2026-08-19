'use strict';

const MAP_SIZE = 500;

// Static cover. Line-of-sight is what makes wallhacks worth detecting: without
// obstacles there is no difference between "knows where you are" and "can see you".
const WALLS = [
  { x: 60, y: 60, w: 90, h: 20 },
  { x: 200, y: 40, w: 20, h: 110 },
  { x: 330, y: 90, w: 110, h: 20 },
  { x: 90, y: 200, w: 20, h: 120 },
  { x: 230, y: 240, w: 100, h: 20 },
  { x: 390, y: 220, w: 20, h: 120 },
  { x: 120, y: 380, w: 120, h: 20 },
  { x: 300, y: 380, w: 20, h: 90 },
];

// Liang-Barsky segment/AABB clip: true when the sight line crosses the box.
function segHitsRect(x0, y0, x1, y1, r) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  let t0 = 0;
  let t1 = 1;
  const p = [-dx, dx, -dy, dy];
  const q = [x0 - r.x, r.x + r.w - x0, y0 - r.y, r.y + r.h - y0];

  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return false;
      continue;
    }
    const t = q[i] / p[i];
    if (p[i] < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
  }
  return true;
}

function hasLineOfSight(ax, ay, bx, by) {
  for (const w of WALLS) {
    if (segHitsRect(ax, ay, bx, by, w)) return false;
  }
  return true;
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

const angleTo = (from, to) => Math.atan2(to.y - from.y, to.x - from.x);

module.exports = { MAP_SIZE, WALLS, hasLineOfSight, dist, angleTo };

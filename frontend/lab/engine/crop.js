// @ts-check
// The crop: what the Crop board sets and how it becomes geometry (warp.js). The model is the board's own
// (docs/design/EDITOR.md). The upright picture sits in a box. It is turned by quarter turns and the straighten
// angle about the box's middle, tilted for perspective (Vertical, Horizontal) as seen from a fixed distance,
// flipped, and enlarged just enough that the crop frame, a rectangle of the box, is always covered. The board
// shows this with a CSS transform and the engine draws it from the same numbers, so they agree.

/** @typedef {{ quarter: number, flipH: boolean, flipV: boolean, angle: number, vertical: number, horizontal: number, scale: number,
 *   rect: { x: number, y: number, w: number, h: number } | null, aspect?: string, portrait?: boolean }} Crop
 * angle in degrees (±45); vertical, horizontal and scale −100..100; rect in shares of the box (null: all of it) */
/** @type {Crop} */
export const NONE = { quarter: 0, flipH: false, flipV: false, angle: 0, vertical: 0, horizontal: 0, scale: 0, rect: null, aspect: 'Original', portrait: false };
export const isNone = (/** @type {Crop | null | undefined} */ c) => !c || (!c.quarter && !c.flipH && !c.flipV && !c.angle && !c.vertical && !c.horizontal && !c.scale && !c.rect);
const TILT = 0.18, EYE = 900, STAGE = [372, 500];   // degrees of tilt a step; the eye's distance and the stage, in the board's pixels

const mul = (/** @type {number[]} */ a, /** @type {number[]} */ b) => [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]));
function inverse(/** @type {number[]} */ m) {
  const [a, b, c, d, e, f, g, h, i] = m, A = e * i - f * h, B = f * g - d * i, C = d * h - e * g, det = a * A + b * B + c * C;
  return [A, c * h - b * i, b * f - c * e, B, a * i - c * g, c * d - a * f, C, b * g - a * h, a * e - b * d].map((v) => v / det);
}
/** Where a point of the box comes from in the upright picture, as a 3 × 3 (both in the picture's pixels), for
 * an enlargement m. @param {Crop} c @param {number} w @param {number} h the upright picture's size */
function back(c, w, h, m) {
  const odd = c.quarter % 2 === 1, bw = odd ? h : w, bh = odd ? w : h, eye = EYE / Math.min(STAGE[0] / bw, STAGE[1] / bh), rad = Math.PI / 180;
  const ax = c.vertical * TILT * rad, ay = -c.horizontal * TILT * rad, az = (c.quarter * 90 + c.angle) * rad;
  const rx = [1, 0, 0, 0, Math.cos(ax), -Math.sin(ax), 0, Math.sin(ax), Math.cos(ax)], ry = [Math.cos(ay), 0, Math.sin(ay), 0, 1, 0, -Math.sin(ay), 0, Math.cos(ay)];
  const rz = [Math.cos(az), -Math.sin(az), 0, Math.sin(az), Math.cos(az), 0, 0, 0, 1], L = mul(mul(mul(rx, ry), rz), [(c.flipH ? -1 : 1) * m, 0, 0, 0, (c.flipV ? -1 : 1) * m, 0, 0, 0, 1]);
  // a picture point p (from its middle) lands at L·p, seen from the eye: x, y scaled by eye / (eye − z)
  const fwd = [L[0], L[1], 0, L[3], L[4], 0, -L[6] / eye, -L[7] / eye, 1];
  return mul(mul([1, 0, w / 2, 0, 1, h / 2, 0, 0, 1], inverse(fwd)), [1, 0, -bw / 2, 0, 1, -bh / 2, 0, 0, 1]);
}
/** The crop laid out for a picture of w × h: the box, the frame in it, the enlargement that keeps the frame
 * covered (`cover`, without Scale; `mag` with it), the output's size, and the 3 × 3 from box to picture.
 * @param {Crop} c @param {number} w @param {number} h */
export function frame(c, w, h) {
  const odd = c.quarter % 2 === 1, bw = odd ? h : w, bh = odd ? w : h, r = c.rect || { x: 0, y: 0, w: 1, h: 1 };
  const rect = { x: r.x * bw, y: r.y * bh, w: r.w * bw, h: r.h * bh }, extra = 1 + c.scale / 200;
  const inside = (/** @type {number} */ m) => { const b = back(c, w, h, m); return [[rect.x, rect.y], [rect.x + rect.w, rect.y], [rect.x, rect.y + rect.h], [rect.x + rect.w, rect.y + rect.h]].every(([x, y]) => { const q = b[6] * x + b[7] * y + b[8], px = (b[0] * x + b[1] * y + b[2]) / q, py = (b[3] * x + b[4] * y + b[5]) / q; return q > 0 && px >= -0.5 && px <= w + 0.5 && py >= -0.5 && py <= h + 0.5; }); };
  let need = 1;   // the least enlargement that keeps the frame covered
  if (!inside(1)) { let lo = 1; need = 8; for (let k = 0; k < 24; k++) { const mid = (lo + need) / 2; if (inside(mid)) need = mid; else lo = mid; } }
  const mag = need * Math.max(1, extra), cover = mag / extra;   // Scale enlarges further; it never uncovers
  return { bw, bh, rect, cover, mag, ow: Math.max(16, Math.round(rect.w / mag)), oh: Math.max(16, Math.round(rect.h / mag)), h: back(c, w, h, mag) };
}

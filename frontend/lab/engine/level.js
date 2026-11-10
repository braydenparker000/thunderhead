// @ts-check
// Auto level: how far the picture's lines lean. Every strong edge votes for the angle its line makes with the
// nearer of level and upright; buildings and horizons agree with each other, clutter does not, so the tallest
// peak within 15° is the lean (a Hough vote on edge directions).

/** The lean in degrees, clockwise positive (0 when nothing agrees). Turn the picture by its opposite to level it.
 * @param {ImageData} im */
export function tilt(im) {
  const s = Math.max(1, Math.round(im.width / 640)), w = Math.floor(im.width / s), h = Math.floor(im.height / s), L = new Float32Array(w * h), d = im.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let b = 0; b < s; b++) for (let a = 0; a < s; a++) { const i = ((y * s + b) * im.width + x * s + a) * 4; sum += d[i] * 0.3 + d[i + 1] * 0.6 + d[i + 2] * 0.1; }
    L[y * w + x] = sum / (s * s);
  }
  const BIN = 0.25, HALF = 15, n = Math.round((2 * HALF) / BIN) + 1, votes = new Float64Array(n);
  let all = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x, gx = L[i - w + 1] + 2 * L[i + 1] + L[i + w + 1] - L[i - w - 1] - 2 * L[i - 1] - L[i + w - 1], gy = L[i + w - 1] + 2 * L[i + w] + L[i + w + 1] - L[i - w - 1] - 2 * L[i - w] - L[i - w + 1];
    const m = gx * gx + gy * gy;
    if (m < 40 * 40) continue;
    // the line runs at right angles to the gradient; from the nearer of level and upright it is off by this
    const a = ((((Math.atan2(gy, gx) * 180) / Math.PI) % 90) + 135) % 90 - 45;
    all += m;
    if (Math.abs(a) <= HALF) votes[Math.round((a + HALF) / BIN)] += m;
  }
  let best = 0, top = 0;
  const soft = (/** @type {number} */ k) => { let v = 0; for (let j = -2; j <= 2; j++) v += votes[Math.max(0, Math.min(n - 1, k + j))] * (3 - Math.abs(j)); return v; };
  for (let k = 0; k < n; k++) { const v = soft(k); if (v > top) { top = v; best = k; } }
  if (!all || top / 9 < all * 0.004) return 0;   // no direction stands out
  const l = soft(best - 1), r = soft(best + 1), fine = l + r - 2 * top ? (0.5 * (l - r)) / (l + r - 2 * top) : 0;
  return (best + fine) * BIN - HALF;
}

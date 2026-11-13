// @ts-check
// Auto white balance: the light a photo was taken in, estimated from its own pixels (the editing copy's camera
// colours, before any white balance). Each bright, unclipped pixel is asked "if this were grey, what light would
// it be under?". Most answers are nonsense (a leaf answers a green light no lamp gives), so only answers on or near
// the daylight and lamp locus count, nearer counting more, and brighter pixels count more than dim ones. The most
// voted light wins, read from the pixels that agree with it, not from a mean of everything (grey world's mistake:
// a field of grass or a sunset is not grey on average). The camera's own white is a strong prior: a far answer
// needs more votes, and the move is only part of the way unless many pixels agree. With too few agreeing, it keeps
// the camera's white and says so. white.js has the measurement that made the prior this strong.
import { neutralFor, whiteOf } from './dcp.js';

/** @typedef {import('./dcp.js').Profile} Profile */
/** @typedef {{ kelvin: number, tint: number, neutral: number[], weak: boolean, share: number, found: null | { kelvin: number, tint: number } }} AutoWhite */

const LOW = 100, HIGH = 400;       // the answer's range in mired: 10 000 K down to 2 500 K
const TINT = 40;                   // and its tint, either side of the locus
const VOTE = [80, 440];            // the lights a pixel may vote for, a little wider than the answer's range
const NEAR = 12;                   // tint from the locus at which a vote counts 0.6
const WARMER = 80, BLUER = 70;     // mired from the camera's white (brought inside the range) at which a vote counts
//                                    0.6: a warm surface (an orange sky) looks like grey under a lamp, and sky like
//                                    grey under a bluer light, the miss white.js measured
const CELL = 4;                    // the vote map's cells: 4 mired by 4 tint
const AROUND = [15, 10];           // what agrees with the winner: within 15 mired and 10 tint of it
const WEAK = 0.06, SURE = 0.15;    // the agreeing share of the photo's pixels (weighed as the votes are) at which it
//                                    moves at all, and at which it moves the whole way
const DARK = 0.03;                 // pixels darker than this share of the bright end are noise more than colour
export const CLIP = 0.97 * 65535;  // where the editing copy marks a colour clipped (known.js, the decoder)

/** The locus in the camera's own colours, a mired at a time: each light's log(R/G), log(B/G), and the step one
 * unit of tint makes there. @param {Profile} p */
function locus(p) {
  const out = [];
  for (let m = VOTE[0]; m <= VOTE[1]; m++) {
    const k = 1e6 / m, a = neutralFor(p, k, 0), b = neutralFor(p, k, 10);
    const x = Math.log(a[0]), y = Math.log(a[2]);
    out.push([m, x, y, (Math.log(b[0]) - x) / 10, (Math.log(b[2]) - y) / 10]);
  }
  return out;
}

/** The light a colour would be under if it were grey, as mired and tint: the locus's nearest point, and the
 * distance across it. @param {number[][]} line from locus() @param {number} x log(R/G) @param {number} y log(B/G) */
function lightOf(line, x, y) {
  let best = 0, d = Infinity;
  for (let i = 0; i < line.length; i += 8) { const e = (line[i][1] - x) ** 2 + (line[i][2] - y) ** 2; if (e < d) { d = e; best = i; } }
  for (let i = Math.max(0, best - 8); i <= Math.min(line.length - 1, best + 8); i++) { const e = (line[i][1] - x) ** 2 + (line[i][2] - y) ** 2; if (e < d) { d = e; best = i; } }
  const [m, lx, ly, tx, ty] = line[best];
  return [m, ((x - lx) * tx + (y - ly) * ty) / (tx * tx + ty * ty)];
}

/** Auto white balance. `rgb` holds the samples' linear camera colours, three to a sample (the editing copy's, as
 * samples() takes them, or any made up); `asShot` is the camera's neutral (camera RGB of a white thing, G = 1).
 * Answers the white to use as Temp (K) and Tint, inside 2 500–10 000 K and ±40 tint; `weak` when too little in the
 * photo is neutral to go by (it then answers the camera's white, brought inside that range); `share` is how much
 * of the photo agreed; `found` what the votes said before the prior held it back (null when weak).
 * @param {ArrayLike<number>} rgb @param {number[]} asShot @param {Profile} p @param {{ clip?: number }} [o] @returns {AutoWhite} */
export function autoWhite(rgb, asShot, p, o = {}) {
  const clip = o.clip ?? CLIP, line = locus(p), shot = whiteOf(p, asShot), m0 = Math.min(HIGH, Math.max(LOW, 1e6 / shot.kelvin)), n = Math.floor(rgb.length / 3);
  // brightness first: the bright end, to leave out the dark noise under it
  const lum = new Float32Array(n); let kept = 0;
  for (let i = 0; i < n; i++) {
    const r = rgb[i * 3], g = rgb[i * 3 + 1], b = rgb[i * 3 + 2];
    lum[i] = r > 0 && g > 0 && b > 0 && r < clip && g < clip && b < clip ? (r + 2 * g + b) / 4 : 0;
    if (lum[i] > 0) kept++;
  }
  const sorted = lum.filter((v) => v > 0).sort(), top = sorted[Math.floor(sorted.length * 0.99)] || 0;
  const cols = Math.ceil((VOTE[1] - VOTE[0]) / CELL) + 1, rows = Math.ceil((2 * TINT) / CELL) + 1, map = new Float64Array(cols * rows);
  const votes = /** @type {number[][]} */ ([]); let all = 0;
  for (let i = 0; i < n && top > 0; i++) {
    if (lum[i] < top * DARK || lum[i] < 16) continue;
    const bright = Math.min(1, lum[i] / top); all += bright;
    const x = Math.log(rgb[i * 3] / rgb[i * 3 + 1]), y = Math.log(rgb[i * 3 + 2] / rgb[i * 3 + 1]), [m1, t1] = lightOf(line, x, y);
    if (m1 <= VOTE[0] - 20 || m1 >= VOTE[1] + 20 || Math.abs(t1) > 2 * TINT) continue;   // far off: no need to read it exactly
    const own = whiteOf(p, [Math.exp(x), 1, Math.exp(y)]), m = 1e6 / own.kelvin, t = own.tint;
    if (m <= VOTE[0] || m >= VOTE[1] || Math.abs(t) > TINT) continue;
    const dm = (m - m0) / (m > m0 ? WARMER : BLUER), w = bright * Math.exp(-0.5 * (t / NEAR) ** 2) * Math.exp(-0.5 * dm * dm);
    votes.push([m, t, x, y, bright, w]);
    map[Math.round((t + TINT) / CELL) * cols + Math.round((m - VOTE[0]) / CELL)] += w;
  }
  // the winner: the cell with the most votes around it
  let at = -1, most = 0;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    let s = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const jj = j + dj, ii = i + di; if (jj >= 0 && jj < rows && ii >= 0 && ii < cols) s += map[jj * cols + ii]; }
    if (s > most) { most = s; at = j * cols + i; }
  }
  // what agrees with it, its own colour averaged: the light it stands for
  // (where it lies from the brightness alone; how sure, from the votes as weighed, prior and all)
  const pm = VOTE[0] + (at % cols) * CELL, pt = Math.floor(at / cols) * CELL - TINT, sum = [0, 0, 0, 0];
  for (const [m, t, x, y, b, w] of votes) if (at >= 0 && Math.abs(m - pm) <= AROUND[0] && Math.abs(t - pt) <= AROUND[1]) { sum[0] += x * b; sum[1] += y * b; sum[2] += b; sum[3] += w; }
  const share = all > 0 ? sum[3] / all : 0, weak = share < WEAK || kept < 50;
  const found = weak ? null : whiteOf(p, [Math.exp(sum[0] / sum[2]), 1, Math.exp(sum[1] / sum[2])]);
  // held back by the camera's white: the whole way only when much of the photo agrees
  const k = found ? Math.min(1, (share - WEAK) / (SURE - WEAK)) : 0, fm = found ? 1e6 / found.kelvin : m0;
  const m = Math.min(HIGH, Math.max(LOW, m0 + k * (fm - m0))), tint = Math.min(TINT, Math.max(-TINT, shot.tint + k * ((found ? found.tint : shot.tint) - shot.tint)));
  return { kelvin: 1e6 / m, tint, neutral: neutralFor(p, 1e6 / m, tint), weak, share, found };
}

/** The editing copy's colours for autoWhite(): a sample every few pixels each way (about `most` of them), each the
 * mean of the 3 × 3 around it, leaving out any with a colour the sensor clipped.
 * @param {{ width: number, height: number, proxy: Uint16Array }} img @param {number} [most] */
export function samples(img, most = 40000) {
  const { width: w, height: h, proxy: px } = img, step = Math.max(3, Math.ceil(Math.sqrt((w * h) / most))), out = [];
  for (let y = 1; y < h - 1; y += step) {
    for (let x = 1; x < w - 1; x += step) {
      const s = [0, 0, 0]; let bad = false;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const k = ((y + j) * w + x + i) * 4; if (px[k + 3]) bad = true; s[0] += px[k]; s[1] += px[k + 1]; s[2] += px[k + 2]; }
      if (!bad) out.push(s[0] / 9, s[1] / 9, s[2] / 9);
    }
  }
  return out;
}

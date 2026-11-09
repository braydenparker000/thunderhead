// @ts-check
// Auto for the Light controls: a starting point read from how the photo's brightness is spread. The method
// is plain and ours: Exposure brings an unusually dark or bright photo towards a normal middle, Highlights
// and Shadows bring a top over white and a deep bottom back into sight, Whites and Blacks set the two ends.
// Contrast is left alone: Highlights and Shadows work by area (mask.js), so they don't flatten the detail.

const LUM = [0.288, 0.712, 0];                 // luminance of linear ProPhoto (wgsl.js)
const WHITE = Math.log2(1 / 0.18);             // where white sits, in stops over middle grey (wgsl.js)
const STEP = 5;                                // every fifth pixel each way: 177 000 of the editing copy's
const LOW = -16, PER = 16, BINS = 24 * PER;    // the count: sixteenths of a stop from 16 under middle grey to 8 over
const AT = [0.001, 0.05, 0.5, 0.99, 0.999];

const MIDDLE = -1;      // where a camera-metered photo's median sits, in stops from middle grey (the middle of ten test photos)
const OWN = 0.4;        // how far from that a photo may sit before Exposure moves: the scene's own brightness
const ROOM = 0.3;       // Highlights brings the brightest hundredth this far under white
const OVER = 0.75;      // Exposure may put it this far over white: Highlights brings that back with detail
const DEEP = -3.75;     // Shadows brings the darkest twentieth up to here
const FOOT = -5.5;      // darker than this, the darkest thousandth needs no help from Blacks

/** How bright the photo is before any control moves: the brightness, in stops from middle grey, that each of
 * `at`'s shares of its pixels stay under (0.5: the median). A colour the sensor clipped counts as white.
 * @param {{ width: number, height: number, proxy: Uint16Array }} img the editing copy
 * @param {number[]} m its colours to linear ProPhoto, white balanced (nine, by rows)
 * @param {number} ev the exposure it is shown at with Exposure at 0, in stops
 * @param {number[]} at shares, rising */
export function spread(img, m, ev, at) {
  const { width: w, height: h, proxy: p } = img, k = [0, 1, 2].map((c) => (LUM[0] * m[c] + LUM[1] * m[3 + c]) / 65535);
  const count = new Uint32Array(BINS); let n = 0;
  for (let y = STEP >> 1; y < h; y += STEP) {
    for (let x = STEP >> 1; x < w; x += STEP, n++) {
      const i = (y * w + x) * 4, s = Math.log2(Math.max(k[0] * p[i] + k[1] * p[i + 1] + k[2] * p[i + 2], 1 / 16384) / 0.18) + ev;
      count[Math.min(BINS - 1, Math.max(0, Math.round(((p[i + 3] & 7 ? Math.min(s, WHITE + ev) : s) - LOW) * PER)))]++;
    }
  }
  const out = []; let seen = 0, b = 0;
  for (const share of at) { while (b < BINS - 1 && seen + count[b] < share * n) seen += count[b++]; out.push(LOW + b / PER); }
  return out;
}

const clamp = (/** @type {number} */ x, /** @type {number} */ a, /** @type {number} */ b) => Math.min(b, Math.max(a, x));
const step = (/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
/** The stops Highlights at `hl` and Shadows at `sh` (−1..1) add where the photo is `x` stops from middle grey
 * (wgsl.js relight()). @param {number} x @param {number} hl @param {number} sh */
const relight = (x, hl, sh) => hl * (hl > 0 ? 1 : 2) * step(0, 3.5, x) + sh * (sh > 0 ? 2 : 1) * step(0, 4, -x) * (1 - 0.5 * step(6, 10, -x));

/** Auto's values for the Light controls, as the editor's sliders count them.
 * @param {{ width: number, height: number, proxy: Uint16Array }} img @param {number[]} m @param {number} ev as spread()'s */
export function autoTone(img, m, ev) {
  const [q001, q05, q50, q99, q999] = spread(img, m, ev, AT);
  // Exposure: only past the scene's own brightness, half as fast past a stop, and never so far that the top
  // goes beyond what Highlights brings back, or that a top already short of white turns grey.
  const off = MIDDLE - q50, far = Math.max(0, Math.abs(off) - OWN);
  let e = Math.sign(off) * Math.min(2, far > 1 ? 1 + (far - 1) / 2 : far);
  e = e > 0 ? Math.min(e, Math.max(0, WHITE + OVER - q99)) : Math.max(e, Math.min(0, WHITE - 0.5 - q99));
  e = Math.round(e * 20) / 20;
  const top = q99 + e, low = q05 + e;
  const hl = top > WHITE - ROOM ? -Math.min(1, (top - (WHITE - ROOM)) / (2 * step(0, 3.5, top))) : 0;
  const sh = low < DEEP ? Math.min(0.7, (DEEP - low) / (2 * step(0, 4, -low))) : 0;
  // The ends, after those: the brightest thousandth lands on white, and a dull darkest thousandth is deepened.
  const peak = q999 + e, foot = q001 + e;
  const whites = clamp(WHITE - (peak + relight(peak, hl, 0)), -0.2, 0.4), blacks = clamp((FOOT - (foot + relight(foot, 0, sh))) / 4, -0.3, 0);
  const n = (/** @type {number} */ x) => Math.round(x * 100) || 0;
  return { Exposure: e || 0, Contrast: 0, Highlights: n(hl), Shadows: n(sh), Whites: n(whites), Blacks: n(blacks) };
}

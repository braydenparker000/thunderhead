// @ts-check
// The histogram and the clipping overlay of the open photo as it now looks (the View board's). Read from the
// fitted photo's pixels, once each time it has changed and a board asks.
import * as photo from './session.js';

/** @typedef {{ r: string, g: string, b: string, lo: string, hi: string, clip: string }} Scope */
let of = /** @type {unknown} */ (null), at = -1, busy = false, got = /** @type {Scope | null} */ (null);

/** One colour's counts as the area under a curve, in the design's 168 × 70 box. @param {Float64Array} n @param {number} top */
function path(n, top) {
  let d = 'M8 66';
  for (let i = 0; i < 256; i += 2) { let s = 0, c = 0; for (let k = Math.max(0, i - 3); k <= Math.min(255, i + 3); k++) { s += n[k]; c++; } d += ` L${(8 + (i / 255) * 152).toFixed(1)} ${(66 - Math.min(1, s / c / top) * 60).toFixed(1)}`; }
  return `${d} L160 66Z`;
}
/** @param {ImageData} im @returns {Promise<Scope>} */
async function read(im) {
  const { data, width: w, height: h } = im, n = [new Float64Array(256), new Float64Array(256), new Float64Array(256)], Q = 4, cw = Math.ceil(w / Q), ch = Math.ceil(h / Q);
  const over = new ImageData(cw, ch), o = new Uint32Array(over.data.buffer);
  let lo = 0, hi = 0, all = 0;
  for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
    const i = (y * w + x) * 4, r = data[i], g = data[i + 1], b = data[i + 2], dark = Math.max(r, g, b) <= 1, bright = Math.max(r, g, b) >= 254;
    n[0][r]++; n[1][g]++; n[2][b]++; all++;
    if (dark) lo++; else if (bright) hi++;
    if ((dark || bright) && x % Q === 0 && y % Q === 0) o[(y / Q) * cw + x / Q] = dark ? 0xe0ff6e3c : 0xe02a20e8;   // blue where black, red where a colour has run out (ABGR)
  }
  let top = 1;   // the tallest column inside the ends, so a clipped spike doesn't flatten the rest
  for (const c of n) for (let i = 4; i < 252; i++) top = Math.max(top, c[i]);
  const cv = new OffscreenCanvas(cw, ch); /** @type {OffscreenCanvasRenderingContext2D} */ (cv.getContext('2d')).putImageData(over, 0, 0);
  const pct = (/** @type {number} */ v) => `${((v / all) * 100).toFixed(1)}%`;
  return { r: path(n[0], top * 1.05), g: path(n[1], top * 1.05), b: path(n[2], top * 1.05), lo: pct(lo), hi: pct(hi), clip: URL.createObjectURL(await cv.convertToBlob()) };
}
/** The scope of the photo as it is now: the last one made (null at first) until the new one is ready, when a change follows. */
export function scope() {
  const p = photo.current(), s = photo.stamp();
  if (p !== of) { of = p; at = -1; if (got) URL.revokeObjectURL(got.clip); got = null; }
  if (p && !busy && at !== s) {
    busy = true;
    photo.pixels().then((im) => (im && photo.current() === p ? read(im) : null)).then((sc) => {
      busy = false;
      if (!sc || photo.current() !== p) return;
      if (got) URL.revokeObjectURL(got.clip);
      got = sc; at = s; photo.events.dispatchEvent(new Event('change'));
    }, () => { busy = false; at = s; });
  }
  return got;
}

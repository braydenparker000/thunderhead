// @ts-check
// An export's work on the processor, after the GPU (export.js develops the photo and reads it back): each band of
// the full-size photo brought to a file's size by averaging in linear light, sharpened for its use if asked, and
// handed to the file's writer (files.js). It runs on the export's own thread (export-worker.js), or on the page
// where that thread cannot start: the same code either way, so the files are the same to the byte.
import { reseed, writer } from './files.js';

const decode = (/** @type {number} */ s) => (s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4);
const encode = (/** @type {number} */ v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
// A half float's bits to its value held to 0..1: as 16 bits (SAME), and as light (LIGHT). ENC turns light back
// into 16 bits of sRGB, looked up by its square root, which spreads the dark end out.
const SAME = new Uint16Array(65536), LIGHT = new Float32Array(65536), ENC = new Uint16Array(65536);
for (let i = 0; i < 65536; i++) {
  const e = (i >> 10) & 31, m = i & 1023, x = i & 32768 ? 0 : e === 0 ? m * 2 ** -24 : e === 31 ? (m ? 0 : 1) : Math.min(1, (1 + m / 1024) * 2 ** (e - 15));
  SAME[i] = Math.round(x * 65535); LIGHT[i] = decode(x); ENC[i] = Math.round(encode((i / 65535) ** 2) * 65535);
}

/** Takes bands of sw-wide half-float pixels and gives the writer the photo at ow × oh.
 * @param {number} sw @param {number} sh @param {number} ow @param {number} oh @param {import('./files.js').Writer} out */
function reducer(sw, sh, ow, oh, out) {
  if (sw === ow && sh === oh) return async (/** @type {Uint16Array} */ half, /** @type {number} */ n) => {
    const px = new Uint16Array(n * sw * 3);
    for (let i = 0, o = 0; o < px.length; i += 4, o += 3) { px[o] = SAME[half[i]]; px[o + 1] = SAME[half[i + 1]]; px[o + 2] = SAME[half[i + 2]]; }
    await out.rows(px, n);
  };
  // each sensor pixel's light goes to the output pixel it falls in, split with the next where it straddles two
  const rx = sw / ow, ry = sh / oh, norm = 1 / (rx * ry), line = ow * 3, to = new Uint32Array(sw), share = new Float32Array(sw);
  for (let x = 0; x < sw; x++) { const o = Math.min(ow - 1, Math.floor(x / rx)); to[x] = o * 3; share[x] = o + 1 < ow ? Math.max(0, Math.min(1, (o + 1) * rx - x)) : 1; }
  let acc = new Float32Array(line), next = new Float32Array(line), row = 0, y = 0;   // the output row being gathered, and the one after
  const one = new Float32Array(line + 3);
  return async (/** @type {Uint16Array} */ half, /** @type {number} */ n) => {
    const px = new Uint16Array((Math.ceil(n / ry) + 2) * line);
    let made = 0;
    const emit = () => { for (let k = 0, o = made++ * line; k < line; k++) px[o + k] = ENC[Math.min(65535, Math.round(Math.sqrt(acc[k] * norm) * 65535))]; [acc, next] = [next, acc]; next.fill(0); row++; };
    for (let r = 0; r < n; r++, y++) {
      one.fill(0);
      for (let x = 0, i = r * sw * 4; x < sw; x++, i += 4) {
        const o = to[x], a = share[x], R = LIGHT[half[i]], G = LIGHT[half[i + 1]], B = LIGHT[half[i + 2]];
        one[o] += R * a; one[o + 1] += G * a; one[o + 2] += B * a;
        if (a < 1) { one[o + 3] += R * (1 - a); one[o + 4] += G * (1 - a); one[o + 5] += B * (1 - a); }
      }
      const o = Math.min(oh - 1, Math.floor(y / ry)), a = o + 1 < oh ? Math.max(0, Math.min(1, (o + 1) * ry - y)) : 1;
      while (row < o) emit();
      for (let k = 0; k < line; k++) { acc[k] += one[k] * a; next[k] += one[k] * (1 - a); }
    }
    if (y === sh) emit();
    if (made) await out.rows(px, made);
  };
}

/** Output sharpening: a writer that sharpens what passes through it on the way to `out`. It is the same unsharp
 * mask as the engine's (finish.js) at its smallest, on the finished picture at its final size: each pixel moves
 * away from the mean of the nine around it, by `amount`, and never past the brightest or darkest of them by more
 * than a little. A row waits for the row after it. @param {import('./files.js').Writer} out @param {number} ow @param {number} amount */
export function crisp(out, ow, amount) {
  const line = ow * 3, OVER = 0.03 * 65535;
  /** @typedef {{ px: Uint16Array, l: Float32Array }} Row a row and its brightness */
  const row = (/** @type {Uint16Array} */ px) => { const l = new Float32Array(ow); for (let x = 0, i = 0; x < ow; x++, i += 3) l[x] = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]; return { px, l }; };
  let above = /** @type {Row | null} */ (null), here = /** @type {Row | null} */ (null);
  const sharp = (/** @type {Row} */ a, /** @type {Row} */ b, /** @type {Row} */ c, /** @type {Uint16Array} */ to, /** @type {number} */ at) => {
    for (let x = 0; x < ow; x++) {
      const x0 = x ? x - 1 : 0, x1 = x + 1 < ow ? x + 1 : x, l = b.l[x];
      const n = [a.l[x0], a.l[x], a.l[x1], b.l[x0], b.l[x1], c.l[x0], c.l[x], c.l[x1]];
      const blur = (4 * l + 2 * (n[1] + n[3] + n[4] + n[6]) + n[0] + n[2] + n[5] + n[7]) / 16, lo = Math.min(l, ...n) - OVER, hi = Math.max(l, ...n) + OVER;
      const d = Math.min(hi, Math.max(lo, l + amount * (l - blur))) - l, i = x * 3, o = at + i;
      to[o] = Math.min(65535, Math.max(0, Math.round(b.px[i] + d))); to[o + 1] = Math.min(65535, Math.max(0, Math.round(b.px[i + 1] + d))); to[o + 2] = Math.min(65535, Math.max(0, Math.round(b.px[i + 2] + d)));
    }
  };
  return {
    rows: async (/** @type {Uint16Array} */ px, /** @type {number} */ n) => {
      const to = new Uint16Array(n * line); let made = 0;
      for (let r = 0; r < n; r++) {
        const next = row(px.slice(r * line, (r + 1) * line));
        if (here) sharp(above || here, here, next, to, made++ * line);
        above = here; here = next;
      }
      if (made) await out.rows(made === n ? to : to.slice(0, made * line), made);   // a writer may take the whole buffer
    },
    done: async () => { if (here) { const to = new Uint16Array(line); sharp(above || here, here, here, to, 0); await out.rows(to, 1); } return out.done(); },
  };
}
/** How strong output sharpening is, by what the picture is for and how much was asked. */
export const OUTPUT = /** @type {Record<string, Record<string, number>>} */ ({ Screen: { Low: 0.3, Standard: 0.5, High: 0.8 }, Print: { Low: 0.5, Standard: 0.8, High: 1.3 } });

/** A file an export makes: its size, output sharpening's strength (0 for none), and its writer, or what the writer
 * is to be (files.js `Spec`), which is what crosses to the export's thread.
 * @typedef {{ ow: number, oh: number, sharpen: number, file: import('./files.js').Writer | import('./files.js').Spec }} Out */
/** Everything after the GPU for every file of one export: `push` takes the next band of sw-wide half-float pixels,
 * n rows of it, and `done` gives the files. @param {number} sw @param {number} sh @param {Out[]} list
 * @param {import('./files.js').Band | null} band the JPEG encoder */
export function sink(sw, sh, list, band) {
  reseed();   // each export's dither starts the same, so the same photo makes the same file wherever it is made
  const outs = list.map((j) => {
    const file = 'rows' in j.file ? j.file : writer(j.file, j.ow, j.oh, band), out = j.sharpen > 0 ? crisp(file, j.ow, j.sharpen) : file;
    return { out, push: reducer(sw, sh, j.ow, j.oh, out) };
  });
  return {
    // each file takes the band down to its own size, one after another (none keeps the band itself)
    push: async (/** @type {Uint16Array} */ half, /** @type {number} */ n) => { for (const o of outs) await o.push(half, n); },
    done: () => Promise.all(outs.map((o) => o.out.done())),
  };
}

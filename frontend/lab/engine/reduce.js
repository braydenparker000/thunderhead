// @ts-check
// An export's work on the processor, after the GPU (export.js develops the photo and reads it back): each band of
// the full-size photo brought to a file's size by a Lanczos filter in linear light, sharpened for its use if asked, and
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
  // Lanczos-3 in linear light, rows then columns (AUDIT.md 1.4: an area average kept 78 % of the contrast just under the
  // small picture's limit and left twice the moire past it; this keeps all of it, as darktable's export does). Each
  // result is held between the least and most of what it was made from, so a bright edge cannot ring dark beside it.
  // each output pixel's K taps, flat: where each reads, its weight, and the taps within a source pixel of its middle,
  // whose least and most it is held between
  const taps = (/** @type {number} */ n, /** @type {number} */ o) => {
    const r = n / o, s = Math.max(1, r), K = Math.ceil(6 * s) + 2, at = new Int32Array(o * K), w = new Float32Array(o * K), mid = new Int32Array(o * 2), last = new Int32Array(o);
    for (let X = 0; X < o; X++) {
      const c = (X + 0.5) * r - 0.5, a = Math.ceil(c - 3 * s);
      let sum = 0, m0 = K, m1 = 0;
      for (let k = 0; k < K; k++) {
        const x = a + k, t = Math.abs(x - c) / s, v = t < 1e-6 ? 1 : t >= 3 ? 0 : (3 * Math.sin(Math.PI * t) * Math.sin((Math.PI * t) / 3)) / (Math.PI * Math.PI * t * t);
        at[X * K + k] = Math.min(n - 1, Math.max(0, x)); w[X * K + k] = v; sum += v;
        if (Math.abs(x - c) <= Math.max(1, r / 2)) { m0 = Math.min(m0, k); m1 = k; }
      }
      for (let k = 0; k < K; k++) w[X * K + k] /= sum;
      mid[X * 2] = m0; mid[X * 2 + 1] = m1; last[X] = Math.min(n - 1, a + K - 1);
    }
    return { K, at, w, mid, last };
  };
  const tx = taps(sw, ow), ty = taps(sh, oh), line = ow * 3, keep = new Map(), one = new Float32Array(sw * 3), K = tx.K;
  let got = 0, Y = 0;   // the input rows seen, the output row next made
  const across = (/** @type {Uint16Array} */ half, /** @type {number} */ r) => {   // an input row taken to ow wide, in light
    for (let x = 0, i = r * sw * 4, o = 0; x < sw; x++, i += 4, o += 3) { one[o] = LIGHT[half[i]]; one[o + 1] = LIGHT[half[i + 1]]; one[o + 2] = LIGHT[half[i + 2]]; }
    const row = new Float32Array(line), { at, w, mid } = tx;
    for (let X = 0, base = 0; X < ow; X++, base += K) {
      let r = 0, g = 0, b = 0;
      for (let k = base; k < base + K; k++) { const i = at[k] * 3, m = w[k]; r += m * one[i]; g += m * one[i + 1]; b += m * one[i + 2]; }
      let rl = 1, gl = 1, bl = 1, rh = 0, gh = 0, bh = 0;
      for (let k = base + mid[X * 2]; k <= base + mid[X * 2 + 1]; k++) { const i = at[k] * 3, R = one[i], G = one[i + 1], B = one[i + 2]; if (R < rl) rl = R; if (R > rh) rh = R; if (G < gl) gl = G; if (G > gh) gh = G; if (B < bl) bl = B; if (B > bh) bh = B; }
      row[X * 3] = r < rl ? rl : r > rh ? rh : r; row[X * 3 + 1] = g < gl ? gl : g > gh ? gh : g; row[X * 3 + 2] = b < bl ? bl : b > bh ? bh : b;
    }
    return row;
  };
  return async (/** @type {Uint16Array} */ half, /** @type {number} */ n) => {
    for (let r = 0; r < n; r++) keep.set(got++, across(half, r));
    const ready = [];
    const KY = ty.K;
    while (Y < oh && (ty.last[Y] < got || got === sh)) {
      const px = new Uint16Array(line), acc = new Float32Array(line), lo = new Float32Array(line).fill(1), hi = new Float32Array(line), m0 = ty.mid[Y * 2], m1 = ty.mid[Y * 2 + 1];
      for (let j = 0; j < KY; j++) {
        const src = /** @type {Float32Array} */ (keep.get(ty.at[Y * KY + j])), m = ty.w[Y * KY + j];
        for (let k = 0; k < line; k++) acc[k] += m * src[k];
        if (j >= m0 && j <= m1) for (let k = 0; k < line; k++) { const v = src[k]; if (v < lo[k]) lo[k] = v; if (v > hi[k]) hi[k] = v; }
      }
      for (let k = 0; k < line; k++) { const v = acc[k] < lo[k] ? lo[k] : acc[k] > hi[k] ? hi[k] : acc[k]; px[k] = ENC[Math.round(Math.sqrt(v) * 65535)]; }
      ready.push(px); Y++;
      const first = Y < oh ? ty.at[Y * KY] : got;   // rows no later output row reads are let go
      for (const k of keep.keys()) if (k < first) keep.delete(k);
    }
    if (!ready.length) return;
    const all = new Uint16Array(ready.length * line); ready.forEach((p, i) => all.set(p, i * line));
    await out.rows(all, ready.length);
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
    // output sharpening was tuned on the area average's softer picture: a reduced file is sharpened by what makes up the same at half its limit
    const amt = j.ow < sw ? Math.max(0, 0.892 * j.sharpen - 0.216) : j.sharpen, file = 'rows' in j.file ? j.file : writer(j.file, j.ow, j.oh, band), out = amt > 0 ? crisp(file, j.ow, amt) : file;
    return { out, push: reducer(sw, sh, j.ow, j.oh, out) };
  });
  return {
    // each file takes the band down to its own size, one after another (none keeps the band itself)
    push: async (/** @type {Uint16Array} */ half, /** @type {number} */ n) => { for (const o of outs) await o.push(half, n); },
    done: () => Promise.all(outs.map((o) => o.out.done())),
  };
}

// A reference to measure the engine's noise reduction against: non-local means (Buades, Coll and Morel) on a
// demosaiced, noisy result, in the scale where the sensor's noise is the same size everywhere (the transform the
// engine uses too), as a brightness and two colour differences. Slow and plain; not the editor's code.
//   node nlm.mjs <crop.bin> <iso> <in.f32> <out.f32> [strength for brightness, default 1] [for colour, default 2]
import fs from 'node:fs';
import { noiseAt } from '../../../frontend/lab/engine/noise.js';
const [bin, iso, inp, outp, hy = '1', hc = '2'] = process.argv.slice(2), j = JSON.parse(fs.readFileSync(bin + '.json')), K = +(process.env.K || 6), w = j.w / K, h = j.h / K;
const f = new Float32Array(fs.readFileSync(inp).buffer.slice(0)), { a, b } = noiseAt(+iso), n = w * h;
const off = a.map((v, c) => 0.375 + (b[c] / v) ** 2), steady = (x, c) => 2 * Math.sqrt(Math.max(x / a[c] + off[c], 0)), back = (y, c) => Math.max(a[c] * ((y / 2) ** 2 - off[c]), 0);
const Y = new Float32Array(n), U = new Float32Array(n), V = new Float32Array(n);
for (let i = 0; i < n; i++) { const r = steady(f[i * 3], 0), g = steady(f[i * 3 + 1], 1), bl = steady(f[i * 3 + 2], 2); Y[i] = 0.25 * (r + 2 * g + bl); U[i] = r - g; V[i] = bl - g; }
// one plane, with weights from patches of the guide (brightness for all three: colour follows its edges). In this
// scale a single value's noise is about 1; a demosaiced one's is less and its neighbours share it, so strengths are found by trying.
function nlm(src, guide, P, S, hh) {
  const out = new Float32Array(n), at = (x, y) => Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let sum = 0, ws = 0;
    for (let dy = -S; dy <= S; dy++) for (let dx = -S; dx <= S; dx++) {
      let d = 0;
      for (let py = -P; py <= P; py++) for (let px = -P; px <= P; px++) { const e = guide[at(x + px, y + py)] - guide[at(x + dx + px, y + dy + py)]; d += e * e; }
      const wt = Math.exp(-Math.max(d / ((2 * P + 1) ** 2) - 2 * hh.s2, 0) / (hh.h * hh.h));
      sum += wt * src[at(x + dx, y + dy)]; ws += wt;
    }
    out[y * w + x] = sum / ws;
  }
  return out;
}
const s2 = 0.375;   // about what a demosaiced brightness's noise variance is in this scale (0.25² (1 + 4 + 1) for three independent sites; fewer are)
const Y2 = nlm(Y, Y, 2, 7, { h: +hy * 0.6, s2 }), U2 = nlm(U, Y2, 2, 7, { h: +hc * 0.6, s2: 0 }), V2 = nlm(V, Y2, 2, 7, { h: +hc * 0.6, s2: 0 });
const out = new Float32Array(n * 3);
for (let i = 0; i < n; i++) { const g = Y2[i] - 0.25 * (U2[i] + V2[i]); out[i * 3] = back(g + U2[i], 0); out[i * 3 + 1] = back(g, 1); out[i * 3 + 2] = back(g + V2[i], 2); }
fs.writeFileSync(outp, Buffer.from(out.buffer));

// Brightness-only noise reduction, tried in plain code before it goes into the engine's shader: the colour is kept
// as the input has it (run the engine with NOISE=0 first, so its colour step has been done), brightness is redone.
//   node luma.mjs <crop.bin> <iso> <in.f32> <out.f32> <method> [strength]
// Methods: nlm (non-local means, 5 x 5 patches, 15 x 15 search: the reference), mean (a neighbour counts by how near
// its 3 x 3 mean is), feat (by its 3 x 3 mean and the slope of that mean: a patch told by three numbers, one read each).
import fs from 'node:fs';
import { noiseAt } from '../../../frontend/lab/engine/noise.js';
const [bin, iso, inp, outp, method, hs = '1'] = process.argv.slice(2), j = JSON.parse(fs.readFileSync(bin + '.json')), K = +(process.env.K || 6), w = j.w / K, h = j.h / K, S = +(process.env.S || 7);
const f = new Float32Array(fs.readFileSync(inp).buffer.slice(0)), { a, b } = noiseAt(+iso), n = w * h, H = +hs;
const off = a.map((v, c) => 0.375 + (b[c] / v) ** 2), steady = (x, c) => 2 * Math.sqrt(Math.max(x / a[c] + off[c], 0)), back = (y, c) => Math.max(a[c] * ((y / 2) ** 2 - off[c]), 0);
const Y = new Float32Array(n), U = new Float32Array(n), V = new Float32Array(n), at = (x, y) => Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x));
for (let i = 0; i < n; i++) { const r = steady(f[i * 3], 0), g = steady(f[i * 3 + 1], 1), bl = steady(f[i * 3 + 2], 2); Y[i] = 0.25 * (r + 2 * g + bl); U[i] = r - g; V[i] = bl - g; }
const box = (src, r) => { const o = new Float32Array(n); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0; for (let v = -r; v <= r; v++) for (let u = -r; u <= r; u++) s += src[at(x + u, y + v)]; o[y * w + x] = s / (2 * r + 1) ** 2; } return o; };
function run(src) {
  const out = new Float32Array(n);
  if (method === 'nlm') {
    const P = 2;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let sum = 0, ws = 0;
      for (let dy = -S; dy <= S; dy++) for (let dx = -S; dx <= S; dx++) { let d = 0; for (let py = -P; py <= P; py++) for (let px = -P; px <= P; px++) { const e = src[at(x + px, y + py)] - src[at(x + dx + px, y + dy + py)]; d += e * e; }
        const wt = Math.exp(-Math.max(d / 25 - 2 * 0.375, 0) / (H * H * 0.36)); sum += wt * src[at(x + dx, y + dy)]; ws += wt; }
      out[y * w + x] = sum / ws; }
    return out;
  }
  if (method === 'steps') {   // the engine's two widening steps, but a neighbour counts by how alike the 3 x 3 patches round it and round the pixel are
    const w1 = [0.375, 0.25, 0.0625], T = +(process.env.T || 0.375); let cur = src;
    for (const hole of (process.env.HOLES || '1,2').split(',').map(Number)) { const nx = new Float32Array(n);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let sum = 0, ws = 0;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { let d = 0; for (let py = -1; py <= 1; py++) for (let px = -1; px <= 1; px++) { const e = cur[at(x + px, y + py)] - cur[at(x + dx * hole + px, y + dy * hole + py)]; d += e * e; }
          const wt = w1[Math.abs(dx)] * w1[Math.abs(dy)] * Math.exp(-Math.max(d / 9 - 2 * T, 0) / (H * H * 0.36)); sum += wt * cur[at(x + dx * hole, y + dy * hole)]; ws += wt; }
        nx[y * w + x] = sum / ws; }
      cur = nx; }
    return cur;
  }
  const m = box(src, 1), gx = new Float32Array(n), gy = new Float32Array(n), G = +(process.env.G || 1);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { gx[y * w + x] = (m[at(x + 1, y)] - m[at(x - 1, y)]) / 2; gy[y * w + x] = (m[at(x, y + 1)] - m[at(x, y - 1)]) / 2; }
  // a 3 x 3 mean of demosaiced brightness has a noise variance of about 0.1 in this scale; a difference of two, twice that
  const k = 1 / (H * H * 0.2);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const p = y * w + x; let sum = 0, ws = 0;
    for (let dy = -S; dy <= S; dy++) for (let dx = -S; dx <= S; dx++) { const q = at(x + dx, y + dy); let d = (m[q] - m[p]) ** 2; if (method === 'feat') d += G * ((gx[q] - gx[p]) ** 2 + (gy[q] - gy[p]) ** 2);
      const wt = Math.exp(-d * k); sum += wt * src[q]; ws += wt; }
    out[p] = sum / ws; }
  return out;
}
let Y2 = run(Y); if (process.env.TWICE) Y2 = run(Y2);
const out = new Float32Array(n * 3);
for (let i = 0; i < n; i++) { const g = Y2[i] - 0.25 * (U[i] + V[i]); out[i * 3] = back(g + U[i], 0); out[i * 3 + 1] = back(g, 1); out[i * 3 + 2] = back(g + V[i], 2); }
fs.writeFileSync(outp, Buffer.from(out.buffer));

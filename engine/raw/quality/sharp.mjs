// Sharpening, tried in plain code before it goes into the engine: node sharp.mjs <crop.bin> <in.f32> <out.f32> <method> [args]
//   usm <amount> <radius>     the engine's unsharp mask as it stands, on gamma-encoded brightness (finish.js, Detail 25)
//   rl <sigma> <rounds> [damp] Richardson and Lucy's deconvolution on linear brightness, for a Gaussian blur of that sigma;
//                             colour follows brightness as a ratio. `damp` holds back changes smaller than it (noise).
import fs from 'node:fs';
const [bin, inp, outp, method, a1 = '1', a2 = '1', a3 = '0'] = process.argv.slice(2), j = JSON.parse(fs.readFileSync(bin + '.json')), K = +(process.env.K || 6), w = j.w / K, h = j.h / K, wb = j.meta.wb, n = w * h;
const f = new Float32Array(fs.readFileSync(inp).buffer.slice(0)), at = (x, y) => Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x));
const gauss = (src, sg) => { const r = Math.max(1, Math.ceil(sg * 3)), k = Array.from({ length: 2 * r + 1 }, (_, i) => Math.exp(-0.5 * ((i - r) / sg) ** 2)), ks = k.reduce((a, b) => a + b), t = new Float32Array(n), o = new Float32Array(n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let v = 0; for (let i = -r; i <= r; i++) v += k[i + r] * src[at(x + i, y)]; t[y * w + x] = v / ks; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let v = 0; for (let i = -r; i <= r; i++) v += k[i + r] * t[at(x, y + i)]; o[y * w + x] = v / ks; } return o; };
const Y = new Float32Array(n); for (let i = 0; i < n; i++) Y[i] = Math.max(1e-6, 0.25 * (f[i * 3] * wb[0] + 2 * f[i * 3 + 1] + f[i * 3 + 2] * wb[2]));
let Y2;
if (method === 'usm') {   // on a display-like scale: 4 x exposure and gamma 2.2, as the scores use
  const g = Y.map((v) => Math.min(1, v * 4) ** (1 / 2.2)), b = gauss(g, +a2), amount = +a1, quiet = 0.75 * 0.012; Y2 = new Float32Array(n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; let d = g[i] - b[i]; const t = Math.min(1, Math.max(0, (Math.abs(d) - quiet * 0.5) / (quiet + 1e-6))); d *= t * t * (3 - 2 * t);
    let lo = g[i], hi = g[i]; for (let v = -1; v <= 1; v++) for (let u = -1; u <= 1; u++) { const q = g[at(x + u, y + v)]; lo = Math.min(lo, q); hi = Math.max(hi, q); }
    const o = Math.min(hi + 0.045, Math.max(lo - 0.045, g[i] + amount * d)); Y2[i] = Math.max(0, o) ** 2.2 / 4; }
} else {
  const sg = +a1, rounds = +a2, damp = +a3; let est = Float32Array.from(Y);
  for (let r = 0; r < rounds; r++) { const b = gauss(est, sg), ratio = new Float32Array(n);
    for (let i = 0; i < n; i++) { let q = Y[i] / Math.max(b[i], 1e-6); if (damp > 0) { const d = Math.abs(q - 1) / damp; q = 1 + (q - 1) * Math.min(1, d * d); } ratio[i] = q; }
    const c = gauss(ratio, sg); for (let i = 0; i < n; i++) est[i] *= c[i]; }
  Y2 = est;
}
const out = new Float32Array(n * 3); for (let i = 0; i < n; i++) { const k = Y2[i] / Y[i]; out[i * 3] = f[i * 3] * k; out[i * 3 + 1] = f[i * 3 + 1] * k; out[i * 3 + 2] = f[i * 3 + 2] * k; }
fs.writeFileSync(outp, Buffer.from(out.buffer));

// Colour fringing on a harness mosaic: what it costs, and what undoing it in the demosaic wins back.
//   node fringe.mjs <crop.bin> <px> lay    red moved +px and blue -px across the known picture, laid out as a mosaic:
//                                          writes fr.bin (+ .json) and fr.remade.f32 beside the crop (run score.mjs on the crop first)
//   node fringe.mjs <crop.bin> <px> undo   fr.gpu.f32 (engine.cjs's demosaic of it, not told of the fringing) with red
//                                          and blue moved back afterwards, as the warp used to: writes fr.fixed.f32
// Then: FRINGE=<px> node engine.cjs fr.bin   (the demosaic told of it: its fr.gpu.f32 is aligned as it comes)
//       node score.mjs fr.bin fr.fixed.f32 fr.gpu.f32
// K as in the other scripts (3: softer, more like a photo at 100 %).
import fs from 'node:fs';
import path from 'node:path';
const [bin, S, what] = process.argv.slice(2), s = +S, dir = path.dirname(path.resolve(bin)) + '/', scene = path.basename(bin, '.bin');
const j = JSON.parse(fs.readFileSync(`${dir}${scene}.bin.json`)), K = +(process.env.K || 6), w = j.w / K, h = j.h / K, cfa = j.meta.cfa;
const load = (p) => new Float32Array(fs.readFileSync(p).buffer.slice(0));
const cub = (t) => [-0.5 * t ** 3 + t * t - 0.5 * t, 1.5 * t ** 3 - 2.5 * t * t + 1, -1.5 * t ** 3 + 2 * t * t + 0.5 * t, 0.5 * t ** 3 - 0.5 * t * t];
/** channel c of a 3-a-pixel picture, read at x + dx (cubic along the row) */
function moved(src, c, dx) { const out = new Float32Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const fx = x + dx, i = Math.floor(fx), k = cub(fx - i); let v = 0; for (let t = 0; t < 4; t++) v += k[t] * src[(y * w + Math.min(w - 1, Math.max(0, i - 1 + t))) * 3 + c]; out[y * w + x] = v; } return out; }
if (what === 'lay') {
  fs.copyFileSync(`${dir}${scene}.bin`, `${dir}fr.bin`); fs.copyFileSync(`${dir}${scene}.bin.json`, `${dir}fr.bin.json`);
  const T = load(`${dir}${scene}.truth.f32`), R = moved(T, 0, -s), B = moved(T, 2, s), m = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = +cfa[(y % 6) * 6 + (x % 6)]; m[y * w + x] = Math.max(0, c === 0 ? R[y * w + x] : c === 2 ? B[y * w + x] : T[(y * w + x) * 3 + 1]); }
  fs.writeFileSync(`${dir}fr.remade.f32`, Buffer.from(m.buffer));
} else {
  const G = load(`${dir}fr.gpu.f32`), R = moved(G, 0, s), B = moved(G, 2, -s), out = new Float32Array(w * h * 3);
  for (let i = 0; i < w * h; i++) { out[i * 3] = R[i]; out[i * 3 + 1] = G[i * 3 + 1]; out[i * 3 + 2] = B[i]; }
  fs.writeFileSync(`${dir}fr.fixed.f32`, Buffer.from(out.buffer));
}

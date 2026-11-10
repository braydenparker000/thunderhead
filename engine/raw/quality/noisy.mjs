// The harness mosaic with the sensor's own noise laid on, as it would be at an ISO: node noisy.mjs <crop.bin> <iso>
// Reads <crop>.remade.f32 (score.mjs writes it), writes <crop>.iso<iso>.f32. The noise is the engine's own profile
// (frontend/lab/engine/noise.js: a value x has variance a·x + b), the same numbers each run.
import fs from 'node:fs';
import { noiseAt } from '../../../frontend/lab/engine/noise.js';
const [bin, iso] = process.argv.slice(2), j = JSON.parse(fs.readFileSync(bin + '.json')), cfa = j.meta.cfa, K = +(process.env.K || 6), w = j.w / K, h = j.h / K;
const m = new Float32Array(fs.readFileSync(bin.replace(/\.bin$/, '.remade.f32')).buffer.slice(0)), { a, b } = noiseAt(+iso);
let s = 12345; const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return (s + 0.5) / 4294967296; }, gauss = () => Math.sqrt(-2 * Math.log(rnd())) * Math.cos(2 * Math.PI * rnd());
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = +cfa[(y % 6) * 6 + (x % 6)], v = m[y * w + x]; m[y * w + x] = Math.max(0, v + Math.sqrt(Math.max(0, a[c] * v + b[c])) * gauss()); }
fs.writeFileSync(bin.replace(/\.bin$/, `.iso${iso}.f32`), Buffer.from(m.buffer)); console.log('noise at ISO', iso, 'a', a.map((v) => v.toExponential(2)).join(' '), 'b', b.map((v) => v.toExponential(2)).join(' '));

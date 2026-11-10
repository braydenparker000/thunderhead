// Where a demosaic's error lies, by the kind of site: node sites.mjs <crop.bin> <result.f32>
import fs from 'node:fs';
const bin = process.argv[2], j = JSON.parse(fs.readFileSync(bin + '.json')), cfa = j.meta.cfa, wb = j.meta.wb, K = +(process.env.K || 6), w = j.w / K, h = j.h / K;
const truth = new Float32Array(fs.readFileSync(bin.replace(/\.bin$/, '.truth.f32')).buffer.slice(0)), got = new Float32Array(fs.readFileSync(process.argv[3]).buffer.slice(0));
const fc = (r, c) => +cfa[(r % 6) * 6 + (c % 6)], tone = (v, c) => Math.min(1, Math.max(0, v * wb[c] * 4)) ** (1 / 2.2);
const kind = (y, x) => { const f = fc(y, x); if (f !== 1) return 'RGB'[f] + ' site'; const n = [[0, 1], [0, -1], [1, 0], [-1, 0]].filter(([a, b]) => fc(y + a + 6, x + b + 6) !== 1).length; return n === 4 ? 'lone green' : 'green in 2x2'; };
const acc = {};
for (let y = 24; y < h - 24; y++) for (let x = 24; x < w - 24; x++) { const k = kind(y, x), a = acc[k] || (acc[k] = { n: 0, e: [0, 0, 0], bias: [0, 0, 0] }); a.n++; for (let c = 0; c < 3; c++) { const e = tone(got[(y * w + x) * 3 + c], c) - tone(truth[(y * w + x) * 3 + c], c); a.e[c] += e * e; a.bias[c] += e; } }
for (const [k, a] of Object.entries(acc)) console.log(k.padEnd(14), 'n', String(a.n).padStart(6), ' PSNR R G B', a.e.map((s) => (-10 * Math.log10(s / a.n + 1e-12)).toFixed(1).padStart(6)).join(' '), '  bias', a.bias.map((s) => (s / a.n).toFixed(4).padStart(8)).join(' '));

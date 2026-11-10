// How well a demosaic recovers a known picture: node score.mjs <crop.bin> [result.f32 ...]   (see README.md)
// The truth (below) is laid out as an X-Trans mosaic again, demosaiced, and compared (PSNR on white-balanced, gamma 2.2
// values, 24 pixels in).
import fs from 'node:fs';
import { markesteijn as plain } from './markesteijn.mjs';
// as darktable and dcraw run it: on white-balanced values (it works on colour differences, which only mean something once the colours are on one scale)
function markesteijn(m, w, h, cfa, passes, wb, go = false) { const b = new Float32Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) b[y * w + x] = m[y * w + x] * wb[+cfa[(y % 6) * 6 + (x % 6)]]; const o = plain(b, w, h, cfa, passes, go); for (let i = 0; i < w * h; i++) for (let c = 0; c < 3; c++) o[i * 3 + c] /= wb[c]; return o; }
const bin = process.argv[2], j = JSON.parse(fs.readFileSync(bin + '.json')), raw = new Uint16Array(fs.readFileSync(bin).buffer.slice(0)), W = j.w, H = j.h, cfa = j.meta.cfa, black = j.meta.black, white = j.meta.white, wb = j.meta.wb;
const fc = (r, c) => +cfa[(r % 6) * 6 + (c % 6)], K = +(process.env.K || 6), w = W / K, h = H / K, truth = new Float32Array(w * h * 3);
// Truth: the real mosaic demosaiced at full size (Markesteijn, 3 passes, or the file named by TRUTH), then every
// K x K pixels averaged: each colour centred on the same place, and the demosaic's own errors mostly averaged away.
{ const full = new Float32Array(W * H); for (let i = 0; i < W * H; i++) full[i] = (raw[i] - black) / (white - black);
  const big = process.env.TRUTH ? new Float32Array(fs.readFileSync(process.env.TRUTH).buffer.slice(0)) : markesteijn(full, W, H, cfa, 3, wb);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) { let s = 0; for (let v = 0; v < K; v++) for (let u = 0; u < K; u++) s += big[((y * K + v) * W + x * K + u) * 3 + c]; truth[(y * w + x) * 3 + c] = s / (K * K); } }
if (process.env.GREY) for (let i = 0; i < w * h; i++) { const g = truth[i * 3 + 1]; truth[i * 3] = g / wb[0]; truth[i * 3 + 2] = g / wb[2]; }   // a grey picture: red and blue must then do equally well
const mosaic = new Float32Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) mosaic[y * w + x] = truth[(y * w + x) * 3 + fc(y, x)];
fs.writeFileSync(bin.replace(/\.bin$/, '.truth.f32'), Buffer.from(truth.buffer)); fs.writeFileSync(bin.replace(/\.bin$/, '.remade.f32'), Buffer.from(mosaic.buffer));
const tone = (v, c) => Math.min(1, Math.max(0, v * wb[c] * 4)) ** (1 / 2.2);
function score(name, got) {
  const se = [0, 0, 0]; let n = 0, zip = 0;
  for (let y = 24; y < h - 24; y++) for (let x = 24; x < w - 24; x++) { n++; for (let c = 0; c < 3; c++) { const e = tone(got[(y * w + x) * 3 + c], c) - tone(truth[(y * w + x) * 3 + c], c); se[c] += e * e; } }
  const ps = se.map((s) => -10 * Math.log10(s / n)), all = -10 * Math.log10((se[0] + se[1] + se[2]) / (3 * n));
  // colour error alone: how far red minus green and blue minus green are from the truth's (false colour shows here)
  let ce = 0; for (let y = 24; y < h - 24; y++) for (let x = 24; x < w - 24; x++) { const o = (y * w + x) * 3; for (const c of [0, 2]) { const e = (tone(got[o + c], c) - tone(got[o + 1], 1)) - (tone(truth[o + c], c) - tone(truth[o + 1], 1)); ce += e * e; } }
  console.log(`${name.padEnd(22)} PSNR ${all.toFixed(2)} dB   R ${ps[0].toFixed(2)}  G ${ps[1].toFixed(2)}  B ${ps[2].toFixed(2)}   colour ${(-10 * Math.log10(ce / (2 * n))).toFixed(2)} dB`);
}
// a plain baseline: each missing colour is the mean of that colour's sites in the 3 x 3 around
const lin = new Float32Array(w * h * 3);
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) { if (fc(y, x) === c) { lin[(y * w + x) * 3 + c] = mosaic[y * w + x]; continue; } let s = 0, n = 0; for (let v = -1; v <= 1; v++) for (let u = -1; u <= 1; u++) { const yy = Math.min(h - 1, Math.max(0, y + v)), xx = Math.min(w - 1, Math.max(0, x + u)); if (fc(yy, xx) === c) { s += mosaic[yy * w + xx]; n++; } } lin[(y * w + x) * 3 + c] = n ? s / n : 0; }
score('3 x 3 mean (baseline)', lin);
for (const passes of [1, 3]) { const t = Date.now(), got = markesteijn(mosaic, w, h, cfa, passes, wb); score(`Markesteijn ${passes}-pass`, got); fs.writeFileSync(bin.replace(/\.bin$/, `.mk${passes}.f32`), Buffer.from(got.buffer)); console.log('   ', Date.now() - t, 'ms'); }
{ const got = markesteijn(mosaic, w, h, cfa, 1, wb, true); fs.writeFileSync(bin.replace(/\.bin$/, '.mkg.f32'), Buffer.from(got.buffer)); }
for (const f of process.argv.slice(3)) score(f.split('/').pop(), new Float32Array(fs.readFileSync(f).buffer.slice(0)));

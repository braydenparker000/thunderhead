// @ts-check
// A made-up photo whose every colour is known at every pixel, laid out as an X-Trans sensor would record it. The
// test bench (bench.js) develops it on this phone's graphics chip and compares what comes out with the picture
// itself and with the numbers a reference GPU gave (bench-ref.json): a driver that computes a slightly wrong
// picture shows up as a difference. No photograph is involved, so it runs anywhere and holds nothing of anyone's.
// The same numbers come out on every run: there is no randomness that is not seeded here.
import { noiseAt } from './noise.js';

/** The X-Trans pattern as the decoder reports it (0 red, 1 green, 2 blue), from the first sensel on. */
export const CFA = '101121212010101121121101010212121101';
/** A made-up camera: its white balance, levels and matrix are plausible, not any real body's. */
export const CAMERA = { wb: [1.96, 1, 1.82], black: 1022, white: 16383, xyzToCamD65: [1.3426, -0.6334, -0.1177, -0.4244, 1.2136, 0.2371, -0.058, 0.1303, 0.598] };
const EXPOSE = 0.2;   // how much of the sensor's range a white thing fills, as a real exposure leaves headroom

const hash = (/** @type {number} */ x, /** @type {number} */ y) => { let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
/** Smooth made-up texture, 0..1: random values at every `s` pixels, blended between. */
function blobs(/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ s) {
  const gx = Math.floor(x / s), gy = Math.floor(y / s), fx = x / s - gx, fy = y / s - gy, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  return (hash(gx, gy) * (1 - u) + hash(gx + 1, gy) * u) * (1 - v) + (hash(gx, gy + 1) * (1 - u) + hash(gx + 1, gy + 1) * u) * v;
}
const PATCHES = [[0.9, 0.1, 0.1], [0.1, 0.8, 0.15], [0.1, 0.15, 0.9], [0.9, 0.85, 0.1], [0.85, 0.1, 0.8], [0.1, 0.8, 0.85], [0.9, 0.9, 0.9], [0.05, 0.05, 0.05], [0.8, 0.45, 0.3]];

/** The scene at a point (0..1 each way), white-balanced, 1 = white; the sun goes far over. Four quarters:
 * rings that tighten outwards (detail in every direction), tilted colour patches (hard coloured edges), thin
 * lines over leafy texture, and a smooth sky with a sun that blows out. */
function scene(/** @type {number} */ u, /** @type {number} */ v, /** @type {number} */ n) {
  const x = u * n, y = v * n, h = n / 2;
  if (u < 0.5 && v < 0.5) { const dx = x - h / 2, dy = y - h / 2, g = 0.5 + 0.42 * Math.cos((Math.PI * 0.4 * (dx * dx + dy * dy)) / h); return [g, g, g]; }
  if (u >= 0.5 && v < 0.5) {
    const a = 0.09, px = (x - h) * Math.cos(a) + y * Math.sin(a), py = y * Math.cos(a) - (x - h) * Math.sin(a), s = h / 3.2;
    return PATCHES[(((Math.floor(px / s) % 3) + 3) % 3) + 3 * (((Math.floor(py / s) % 3) + 3) % 3)];
  }
  if (u < 0.5) {
    const t = blobs(x, y, 5) * 0.6 + blobs(x, y, 17) * 0.4, c = [0.12 + 0.25 * t, 0.2 + 0.5 * t, 0.08 + 0.15 * t];
    for (const [a, k] of [[0.35, 23], [1.1, 31], [2.0, 19]]) { const d = Math.abs((((x * Math.cos(a) + y * Math.sin(a)) % k) + k) % k - k / 2); if (d < 0.8) return [0.03, 0.03, 0.04]; }
    return c;
  }
  const dx = x - n * 0.8, dy = y - n * 0.72, sun = 6 * Math.exp(-(dx * dx + dy * dy) / (n * n * 0.004)), k = (v - 0.5) * 2;
  return [0.25 + 0.3 * k + sun, 0.45 + 0.25 * k + sun, 0.85 - 0.1 * k + sun];
}

/** The photo, `n` pixels square (a multiple of 6). `truth` is what the sensor would have recorded of each colour
 * at each pixel, three a pixel, 0..1 of its range (`crisp`: the same before the lens blurred it); `mosaic` keeps one colour a pixel, as 16-bit sensor values;
 * `proxy` is the editing copy the decoder would make of it (3 × 3 cells, RGBA, the clipped colours flagged).
 * With `iso`, the sensor's own noise at that ISO is laid on the mosaic (seeded: the same every run).
 * @param {number} [n] @param {number} [iso] */
export function known(n = 480, iso = 0) {
  const { wb, black, white } = CAMERA, range = white - black, truth = new Float32Array(n * n * 3), mosaic = new Uint16Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const s = [0, 0, 0];
    for (const oy of [0.25, 0.75]) for (const ox of [0.25, 0.75]) { const c = scene((x + ox) / n, (y + oy) / n, n); for (let k = 0; k < 3; k++) s[k] += c[k] / 4; }
    for (let k = 0; k < 3; k++) truth[(y * n + x) * 3 + k] = (s[k] * EXPOSE) / wb[k];
  }
  const crisp = Float32Array.from(truth, (v) => Math.min(1, v));   // the scene itself, before the lens: what sharpening aims back at
  // what a lens does before the sensor: each point spread a little (a Gaussian, 0.7 of a pixel), then the sensor clips
  const K = [0.0113, 0.1953, 0.5868, 0.1953, 0.0113], tmp = new Float32Array(truth.length), at = (/** @type {number} */ i) => Math.min(n - 1, Math.max(0, i));
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) for (let k = 0; k < 3; k++) { let v = 0; for (let i = -2; i <= 2; i++) v += K[i + 2] * truth[(y * n + at(x + i)) * 3 + k]; tmp[(y * n + x) * 3 + k] = v; }
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) for (let k = 0; k < 3; k++) { let v = 0; for (let i = -2; i <= 2; i++) v += K[i + 2] * tmp[(at(y + i) * n + x) * 3 + k]; truth[(y * n + x) * 3 + k] = Math.min(1, v); }
  const noise = iso ? noiseAt(iso) : null;
  let seed = 12345;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed + 0.5) / 4294967296; }, gauss = () => Math.sqrt(-2 * Math.log(rnd())) * Math.cos(2 * Math.PI * rnd());
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const c = +CFA[(y % 6) * 6 + (x % 6)];
    let v = truth[(y * n + x) * 3 + c];
    if (noise) v = Math.min(1, Math.max(0, v + Math.sqrt(Math.max(0, noise.a[c] * v + noise.b[c])) * gauss()));
    mosaic[y * n + x] = Math.round(black + v * range);
  }
  const pw = n / 3, proxy = new Uint16Array(pw * pw * 4), clip = black + 0.97 * range;
  for (let py = 0; py < pw; py++) for (let px = 0; px < pw; px++) {
    const s = [0, 0, 0], k = [0, 0, 0];
    let flags = 0;
    for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) { const x = px * 3 + i, y = py * 3 + j, c = +CFA[(y % 6) * 6 + (x % 6)], v = mosaic[y * n + x]; s[c] += v; k[c]++; if (v >= clip) flags |= 1 << c; }
    for (let c = 0; c < 3; c++) proxy[(py * pw + px) * 4 + c] = Math.max(0, Math.min(65535, Math.floor(((s[c] / k[c] - black) * 65535) / range)));
    proxy[(py * pw + px) * 4 + 3] = flags;
  }
  const meta = { make: 'Made-up', model: 'Known', width: n, height: n, proxyWidth: pw, proxyHeight: pw, wb: [...wb, 0], xyzToCamD65: CAMERA.xyzToCamD65, orientation: 'Normal', chroma: [0, 0, 0],
    fullWidth: n, fullHeight: n, black, white, cfa: CFA, cfaWidth: 6, hot: 0, iso: iso || 160, lens: null };
  return { n, truth, crisp, mosaic, proxy, meta, width: pw, height: pw };
}

const tone = (/** @type {number} */ v, /** @type {number} */ c) => Math.min(1, Math.max(0, (v * CAMERA.wb[c]) / EXPOSE / 1.25)) ** (1 / 2.2);
/** How close a developed picture (three floats a pixel, 0..1 of the sensor's range) is to the truth, in dB on
 * white-balanced, gamma 2.2 values, 24 pixels in from the edge: overall, each colour, and colour alone (red and
 * blue against green: false colour shows there). And `grid`: the mean of each colour in each of 8 × 8 squares,
 * which is what two GPUs' results are compared by.
 * @param {Float32Array} got @param {Float32Array} truth @param {number} n */
export function score(got, truth, n) {
  const se = [0, 0, 0], E = 24;
  let ce = 0, count = 0;
  const G = 8, grid = new Float64Array(G * G * 3), per = n / G;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const o = (y * n + x) * 3, t = [0, 1, 2].map((c) => tone(got[o + c], c)), w = [0, 1, 2].map((c) => tone(truth[o + c], c));
    const g = (Math.floor(y / per) * G + Math.floor(x / per)) * 3;
    for (let c = 0; c < 3; c++) grid[g + c] += t[c] / (per * per);
    if (x < E || y < E || x >= n - E || y >= n - E) continue;
    count++;
    for (let c = 0; c < 3; c++) se[c] += (t[c] - w[c]) ** 2;
    for (const c of [0, 2]) ce += (t[c] - t[1] - (w[c] - w[1])) ** 2;
  }
  const db = (/** @type {number} */ e) => Math.round(-1000 * Math.log10(Math.max(e, 1e-12))) / 100;
  return { psnr: db((se[0] + se[1] + se[2]) / (3 * count)), green: db(se[1] / count), colour: db(ce / (2 * count)), grid: Array.from(grid, (v) => Math.round(v * 1e4) / 1e4) };
}

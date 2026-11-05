// @ts-check
// The camera matrix fitted from the camera's own JPEG (PHOTOS.md, the colour pipeline), for a body the
// engine has no matrix for (LightCraft's tables stop at the X-Trans 4 bodies; the X-E5 is X-Trans 5 HR).
// The working copy and the embedded JPEG are reduced to the same grid; smooth, unclipped mid-tone cells
// are paired and the JPEG linearised (the sRGB curve). The camera's own tone curve is undone on luminance
// only, by a free scale per cell: a 3×3 from white-balanced camera RGB to linear sRGB is fitted by least
// squares on chromaticity, white kept white (undoing the curve per channel, as if the camera applied it so,
// gave 1.66× the camera's colourfulness on the X-E5 sample, luminance only 0.93×). A third of the cells
// are held out: the fit is kept only when it is 30 % closer to the camera there than the neutral fallback.
// Each photo's baseline exposure then puts the median of those cells where the camera put it (its metering
// and any Dynamic Range push), and rides in the matrix the engine is given.

export const GRID = [192, 128];
const Y709 = [0.2126, 0.7152, 0.0722];
const eotf = (/** @type {number} */ v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const lum = (/** @type {number[]} */ v) => Y709[0] * v[0] + Y709[1] * v[1] + Y709[2] * v[2];
/** @param {number[][]} m @param {number[]} v */
const apply = (m, v) => m.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
/** @param {number[][]} a @param {number[][]} b */
export const mul = (a, b) => a.map((r) => [0, 1, 2].map((j) => r[0] * b[0][j] + r[1] * b[1][j] + r[2] * b[2][j]));
/** @param {number[][]} m */
export function inverse(m) {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const A = e * i - f * h, B = f * g - d * i, C = d * h - e * g, det = a * A + b * B + c * C;
  return [[A, c * h - b * i, b * f - c * e], [B, a * i - c * g, c * d - a * f], [C, b * g - a * h, a * e - b * d]].map((r) => r.map((v) => v / det));
}

/** The width and height in a JPEG's first frame header, or null. @param {Uint8Array} j */
export function jpegSize(j) {
  for (let i = 2; i + 8 < j.length;) {
    if (j[i] !== 0xff) { i++; continue; }
    const m = j[i + 1], len = (j[i + 2] << 8) | j[i + 3];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return [(j[i + 7] << 8) | j[i + 8], (j[i + 5] << 8) | j[i + 6]];
    i += 2 + len;
  }
  return null;
}

/** The working copy (planar f16 linear Rec.2020, `w × h`) reduced to `gw × gh` cells of white-balanced camera
 * RGB through `toCam` (Rec.2020 → camera), with each cell's brightest camera channel (clipping shows there);
 * every `step`th row and column is read (a cell still holds ~100 of them).
 * @param {Uint16Array} planes @param {number} w @param {number} h @param {number[][]} toCam @param {number} gw @param {number} gh */
export function reduceWorking(planes, w, h, toCam, gw, gh, step = 2) {
  const f16 = new Float32Array(65536);
  for (let i = 0; i < 65536; i++) {
    const e = (i >> 10) & 31, m = i & 1023, v = e === 0 ? m * 2 ** -24 : e === 31 ? 65504 : 2 ** (e - 15) * (1 + m / 1024);
    f16[i] = i & 0x8000 ? -v : v;
  }
  const cam = new Float64Array(gw * gh * 3), max = new Float32Array(gw * gh), n = new Uint32Array(gw * gh);
  const cx = Uint32Array.from({ length: w }, (_, x) => Math.min(gw - 1, Math.floor((x * gw) / w)));
  const k = toCam.flat(), P = w * h;
  for (let y = 0; y < h; y += step) {
    const row = Math.min(gh - 1, Math.floor((y * gh) / h)) * gw;
    for (let x = 0, i = y * w; x < w; x += step, i += step) {
      const r = f16[planes[i]], g = f16[planes[P + i]], b = f16[planes[2 * P + i]];
      const c0 = k[0] * r + k[1] * g + k[2] * b, c1 = k[3] * r + k[4] * g + k[5] * b, c2 = k[6] * r + k[7] * g + k[8] * b;
      const j = row + cx[x];
      cam[3 * j] += c0; cam[3 * j + 1] += c1; cam[3 * j + 2] += c2; n[j]++;
      const mx = c0 > c1 ? (c0 > c2 ? c0 : c2) : c1 > c2 ? c1 : c2;
      if (mx > max[j]) max[j] = mx;
    }
  }
  for (let j = 0; j < gw * gh; j++) for (let c = 0; c < 3; c++) cam[3 * j + c] /= Math.max(1, n[j]);
  return { cam, max };
}

/** Pairs of [camera RGB, linear JPEG RGB] from cells that are smooth on both sides, unclipped and mid-tone.
 * @param {Float64Array} cam @param {Float32Array} max @param {ArrayLike<number>} rgba the JPEG at `gw × gh`
 * @param {number} gw @param {number} gh */
export function pairs(cam, max, rgba, gw, gh) {
  const yj = new Float64Array(gw * gh), yc = new Float64Array(gw * gh);
  for (let j = 0; j < gw * gh; j++) {
    yj[j] = lum([eotf(rgba[4 * j] / 255), eotf(rgba[4 * j + 1] / 255), eotf(rgba[4 * j + 2] / 255)]);
    yc[j] = lum([cam[3 * j], cam[3 * j + 1], cam[3 * j + 2]]);
  }
  const smooth = (/** @type {Float64Array} */ y, /** @type {number} */ j) => [j - 1, j + 1, j - gw, j + gw].every((q) => Math.abs(Math.log2(y[q] / y[j])) < 0.35);
  /** @type {number[][]} */ const c = [];
  /** @type {number[][]} */ const l = [];
  for (let y = 1; y < gh - 1; y++) for (let x = 1; x < gw - 1; x++) {
    const j = y * gw + x, px = [rgba[4 * j], rgba[4 * j + 1], rgba[4 * j + 2]];
    if (max[j] >= 0.97 || Math.min(...px) < 6 || Math.max(...px) > 250 || yj[j] < 0.005 || yj[j] > 0.85 || yc[j] < 1e-4) continue;
    if (!smooth(yj, j) || !smooth(yc, j)) continue;
    c.push([cam[3 * j], cam[3 * j + 1], cam[3 * j + 2]]);
    l.push(px.map((v) => eotf(v / 255)));
  }
  return { c, l };
}

const chroma = (/** @type {number[]} */ v) => { const s = v[0] + v[1] + v[2]; return s > 0 ? v.map((x) => x / s) : [1 / 3, 1 / 3, 1 / 3]; };
/** Mean chromaticity distance of `m · c` to `t` over the given indices. @param {number[][]} m @param {number[][]} c @param {number[][]} t @param {number[]} idx */
const err = (m, c, t, idx) => idx.reduce((s, i) => { const p = chroma(apply(m, c[i])), q = chroma(t[i]); return s + Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); }, 0) / Math.max(1, idx.length);

/** Solves `a x = b` (small, dense) by elimination with partial pivoting. @param {number[][]} a @param {number[]} b */
function gauss(a, b) {
  const n = b.length, m = a.map((r, i) => [...r, b[i]]);
  for (let k = 0; k < n; k++) {
    let p = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(m[i][k]) > Math.abs(m[p][k])) p = i;
    [m[k], m[p]] = [m[p], m[k]];
    for (let i = k + 1; i < n; i++) { const f = m[i][k] / m[k][k]; for (let j = k; j <= n; j++) m[i][j] -= f * m[k][j]; }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) { let v = m[i][n]; for (let j = i + 1; j < n; j++) v -= m[i][j] * x[j]; x[i] = v / m[i][i]; }
  return x;
}

/** M minimising Σ min over s of ‖M c − s t‖², i.e. Σ ‖P M c‖² with P the projection away from t (the scale
 * eliminated, so it is linear in M), with M·[1 1 1] = [1 1 1] and a whisper of ridge toward the identity:
 * one 12 × 12 system (M's nine entries and three multipliers). @param {number[][]} c @param {number[][]} t @param {number[]} idx */
function solve(c, t, idx) {
  const A = Array.from({ length: 9 }, () => new Array(9).fill(0));
  for (const i of idx) {
    const tt = t[i], n2 = tt[0] ** 2 + tt[1] ** 2 + tt[2] ** 2;
    if (!(n2 > 0)) continue;
    for (let k = 0; k < 3; k++) for (let l = 0; l < 3; l++) {
      const P = (k === l ? 1 : 0) - (tt[k] * tt[l]) / n2;
      for (let j = 0; j < 3; j++) for (let q = 0; q < 3; q++) A[k * 3 + j][l * 3 + q] += P * c[i][j] * c[i][q];
    }
  }
  const ridge = ((A[0][0] + A[4][4] + A[8][8]) / 3) * 1e-6, K = Array.from({ length: 12 }, () => new Array(12).fill(0)), rhs = new Array(12).fill(0);
  for (let a = 0; a < 9; a++) {
    for (let b = 0; b < 9; b++) K[a][b] = 2 * A[a][b];
    K[a][a] += 2 * ridge;
    rhs[a] = a % 4 === 0 ? 2 * ridge : 0;
    K[a][9 + Math.floor(a / 3)] = K[9 + Math.floor(a / 3)][a] = 1;
  }
  for (let k = 0; k < 3; k++) rhs[9 + k] = 1;
  const x = gauss(K, rhs);
  return [0, 1, 2].map((k) => x.slice(k * 3, k * 3 + 3));
}

const median = (/** @type {number[]} */ a) => [...a].sort((x, y) => x - y)[a.length >> 1] ?? 1;
/** The photo's baseline exposure (EV) through matrix `m`: the median mid-tone cell lands where the camera's
 * JPEG has it. @param {number[][]} m @param {number[][]} c @param {number[][]} l */
export function baseline(m, c, l) {
  const ev = Math.log2(median(l.map(lum)) / Math.max(1e-9, median(c.map((v) => lum(apply(m, v))))));
  return Number.isFinite(ev) ? Math.min(3, Math.max(-1, ev)) : 0;
}

/**
 * The fit: camera RGB → linear sRGB (`matrix`, white kept white) and the held-out chromaticity errors of the
 * fallback (`before`) and the fit (`after`); `ok` false with `why` when a gate fails.
 * @param {number[][]} c camera RGB per pair @param {number[][]} l the JPEG's linear RGB per pair
 */
export function fitMatrix(c, l) {
  const n = c.length, train = /** @type {number[]} */ ([]), held = /** @type {number[]} */ ([]), every = Math.max(1, Math.floor(n / 6000));
  for (let i = 0; i < n; i += every) (i % 3 === 2 ? held : train).push(i);
  const coloured = l.filter((v) => (Math.max(...v) - Math.min(...v)) / Math.max(...v, 1e-9) > 0.1).length / Math.max(1, n);
  const I = [[1, 0, 0], [0, 1, 0], [0, 0, 1]], out = { ok: false, why: '', samples: n, coloured, matrix: I, before: 0, after: 0 };
  if (train.length < 300) return { ...out, why: `${n} usable cells` };
  if (coloured < 0.05) return { ...out, why: 'too little colour (a black-and-white look?)' };
  const unit = c.map((v) => { const s = v[0] + v[1] + v[2]; return v.map((x) => x / s); });
  const m = solve(unit, l, train);
  const before = err(I, unit, l, held), after = err(m, unit, l, held);
  const flat = m.flat(), det = m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const res = { ...out, matrix: m, before, after };
  if (!flat.every((v) => Number.isFinite(v) && Math.abs(v) <= 4) || det < 0.05) return { ...res, why: 'the matrix came out implausible' };
  if (after > before * 0.7) return { ...res, why: `not closer than the fallback (${after.toFixed(4)} against ${before.toFixed(4)})` };
  return { ...res, ok: true };
}

/** The cells for a fit or a baseline from the working copy and the camera's JPEG, in the engine's worker; null
 * when the two do not frame the same picture. @param {Uint16Array} planes @param {number} w @param {number} h
 * @param {number[][]} toCam @param {Uint8Array} jpeg */
export async function cells(planes, w, h, toCam, jpeg) {
  const size = jpegSize(jpeg), [gw, gh] = GRID;
  if (!size || Math.abs(size[0] / size[1] / (w / h) - 1) > 0.02) return null;
  const blob = new Blob([/** @type {BlobPart} */ (jpeg)], { type: 'image/jpeg' }), o = { resizeWidth: gw, resizeHeight: gh, resizeQuality: /** @type {const} */ ('high') };
  // the JPEG as stored, like the sensor (no EXIF turn); a browser without 'none' turns it, and a portrait then fails the aspect check
  const bmp = await createImageBitmap(blob, /** @type {any} */ ({ ...o, imageOrientation: 'none' })).catch(() => createImageBitmap(blob, o));
  const g = /** @type {OffscreenCanvasRenderingContext2D} */ (new OffscreenCanvas(gw, gh).getContext('2d'));
  g.drawImage(bmp, 0, 0);
  bmp.close();
  const { cam, max } = reduceWorking(planes, w, h, toCam, gw, gh);
  return pairs(cam, max, g.getImageData(0, 0, gw, gh).data, gw, gh);
}

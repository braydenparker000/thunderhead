// @ts-check
// Camera profiles for the engine (docs/engineering/ENGINE-RESEARCH.md): reads a DCP (DNG camera profile)
// and Adobe's binary RGB table (the looks Camera Raw keeps beside a profile), and works out the matrices
// the DNG specification prescribes for a shot's white balance. The GPU applies the rest (gpu.js).

import { ACR3 } from './acr3.js';

/** The ACR3 default curve as (x, y) pairs. */
const acr3Pairs = () => { const a = new Float32Array(ACR3.length * 2); ACR3.forEach((y, i) => { a[i * 2] = i / (ACR3.length - 1); a[i * 2 + 1] = y; }); return a; };
const T = { model: 50708, cm1: 50721, cm2: 50722, ill1: 50778, ill2: 50779, name: 50936, hsmDims: 50937, hsm1: 50938, hsm2: 50939,
  tone: 50940, fm1: 50964, fm2: 50965, lookDims: 50981, look: 50982, hsmEnc: 51107, lookEnc: 51108, expOffset: 51109 };
/** The light each calibration illuminant stands for, in kelvin (EXIF LightSource codes). */
const KELVIN = /** @type {Record<number, number>} */ ({ 1: 5500, 2: 4200, 3: 2850, 4: 5500, 9: 5500, 10: 6500, 11: 7500, 12: 6400, 13: 5000, 14: 4150, 15: 3450, 17: 2856, 18: 4874, 19: 6774, 20: 5503, 21: 6504, 22: 7504, 23: 5003, 24: 3200 });

/** @typedef {{ name: string, model: string, cm1: number[], cm2: number[] | null, fm1: number[] | null, fm2: number[] | null, t1: number, t2: number,
 *   hsm: null | { dims: number[], d1: Float32Array, d2: Float32Array | null, srgb: boolean }, look: null | { dims: number[], d: Float32Array, srgb: boolean },
 *   tone: Float32Array | null, expOffset: number }} Profile */

/** Reads the tags of a DCP's single IFD. @param {ArrayBuffer} buf @returns {Profile} */
export function parseDcp(buf) {
  const v = new DataView(buf), le = v.getUint16(0) === 0x4949;
  const u16 = (o) => v.getUint16(o, le), u32 = (o) => v.getUint32(o, le);
  const ifd = u32(4), n = u16(ifd), tags = /** @type {Map<number, any>} */ (new Map());
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12, tag = u16(e), type = u16(e + 2), count = u32(e + 4);
    const size = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8, 11: 4, 12: 8 }[type] || 1;
    const at = count * size <= 4 ? e + 8 : u32(e + 8);
    let val;
    if (type === 2 || type === 1 || type === 7) val = new TextDecoder().decode(new Uint8Array(buf, at, count)).replace(/\0+$/, '');
    else if (type === 3) val = Array.from({ length: count }, (_, k) => u16(at + k * 2));
    else if (type === 4) val = Array.from({ length: count }, (_, k) => u32(at + k * 4));
    else if (type === 10 || type === 5) val = Array.from({ length: count }, (_, k) => (type === 10 ? v.getInt32(at + k * 8, le) : u32(at + k * 8)) / (type === 10 ? v.getInt32(at + k * 8 + 4, le) : u32(at + k * 8 + 4)));
    else if (type === 11) { val = new Float32Array(count); for (let k = 0; k < count; k++) val[k] = v.getFloat32(at + k * 4, le); }
    else continue;
    tags.set(tag, val);
  }
  const num = (t, d) => (tags.has(t) ? tags.get(t)[0] : d);
  const hsmDims = tags.get(T.hsmDims), lookDims = tags.get(T.lookDims);
  return {
    name: tags.get(T.name) || 'Profile', model: tags.get(T.model) || '',
    cm1: tags.get(T.cm1), cm2: tags.get(T.cm2) || null, fm1: tags.get(T.fm1) || null, fm2: tags.get(T.fm2) || null,
    t1: KELVIN[num(T.ill1, 17)] || 2856, t2: KELVIN[num(T.ill2, 21)] || 6504,
    hsm: hsmDims && tags.get(T.hsm1) ? { dims: hsmDims, d1: tags.get(T.hsm1), d2: tags.get(T.hsm2) || null, srgb: num(T.hsmEnc, 0) === 1 } : null,
    look: lookDims && tags.get(T.look) ? { dims: lookDims, d: tags.get(T.look), srgb: num(T.lookEnc, 0) === 1 } : null,
    // an Adobe profile without a tone curve gets Camera Raw's default curve (ACR3), as Camera Raw does
    tone: tags.get(T.tone) || (/Adobe/.test(String(tags.get(50942) || '')) ? acr3Pairs() : null), expOffset: num(T.expOffset, 0),
  };
}

/** Adobe's binary RGB table: samples are uint16 offsets from the identity ramp, in a stated colour space.
 * @param {ArrayBuffer} buf @returns {{ n: number, d: Float32Array, primaries: number, gamma: number }} */
export function parseRgbTable(buf) {
  const v = new DataView(buf), n = v.getUint32(12, true), cells = n * n * n, out = new Float32Array(cells * 3);
  for (let r = 0, k = 0; r < n; r++) for (let g = 0; g < n; g++) for (let b = 0; b < n; b++) {
    const nom = [r, g, b].map((i) => Math.round((i * 65535) / (n - 1)));
    for (let c = 0; c < 3; c++, k++) out[k] = ((nom[c] + v.getUint16(16 + k * 2, true)) % 65536) / 65535;
  }
  const tail = 16 + cells * 6;
  return { n, d: out, primaries: v.getUint32(tail, true), gamma: v.getUint32(tail + 4, true) };
}

/* 3 x 3 helpers, row-major */
export const mul = (/** @type {number[]} */ a, /** @type {number[]} */ b) => [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]));
export const inv = (/** @type {number[]} */ m) => {
  const [a, b, c, d, e, f, g, h, i] = m, A = e * i - f * h, B = f * g - d * i, C = d * h - e * g, det = a * A + b * B + c * C;
  return [A, c * h - b * i, b * f - c * e, B, a * i - c * g, c * d - a * f, C, b * g - a * h, a * e - b * d].map((x) => x / det);
};
const apply = (/** @type {number[]} */ m, /** @type {number[]} */ v) => [0, 1, 2].map((r) => m[r * 3] * v[0] + m[r * 3 + 1] * v[1] + m[r * 3 + 2] * v[2]);
export const XYZ_TO_PROPHOTO = [1.3459433, -0.2556075, -0.0511118, -0.5445989, 1.5081673, 0.0205351, 0, 0, 1.2118128];
const PROPHOTO_TO_XYZ = [0.7976749, 0.1351917, 0.0313534, 0.2880402, 0.7118741, 0.0000857, 0, 0, 0.82521];
const D50_TO_D65 = [0.9555766, -0.0230393, 0.0631636, -0.0282895, 1.0099416, 0.0210077, 0.0122982, -0.020483, 1.3299098];
const XYZ_TO_SRGB = [3.2404542, -1.5371385, -0.4985314, -0.969266, 1.8760108, 0.041556, 0.0556434, -0.2040259, 1.0572252];
const ADOBE_TO_XYZ = [0.5767309, 0.185554, 0.1881852, 0.2973769, 0.6273491, 0.0752741, 0.0270343, 0.0706872, 0.9911085];
export const PROPHOTO_TO_SRGB = mul(XYZ_TO_SRGB, mul(D50_TO_D65, PROPHOTO_TO_XYZ));
export const PROPHOTO_TO_ADOBE = mul(inv(ADOBE_TO_XYZ), mul(D50_TO_D65, PROPHOTO_TO_XYZ));
const D50 = [0.9642, 1, 0.8249];

/** The shot's colour temperature from its camera neutral (DNG spec: iterate on the interpolated ColorMatrix),
 * then the weight that blends the two calibrations, and the matrix from white-balanced camera RGB to linear
 * ProPhoto. @param {Profile} p @param {number[]} neutral camera RGB of a white object (1/WB multipliers, G = 1) */
const blend = (/** @type {number[]} */ a, /** @type {number[] | null} */ b, /** @type {number} */ w) => (b ? a.map((x, k) => x * w + b[k] * (1 - w)) : a);
const weightOf = (/** @type {Profile} */ p, /** @type {number} */ t) => (p.cm2 ? Math.min(1, Math.max(0, (1 / t - 1 / p.t2) / (1 / p.t1 - 1 / p.t2))) : 1);
export function cameraToProPhoto(p, neutral) {
  const weight = (/** @type {number} */ t) => weightOf(p, t);
  let t = 5000;
  for (let k = 0; k < 8; k++) {
    const xyz = apply(inv(blend(p.cm1, p.cm2, weight(t))), neutral), s = xyz[0] + xyz[1] + xyz[2], x = xyz[0] / s, y = xyz[1] / s;
    const nn = (x - 0.332) / (0.1858 - y);                        // McCamy's approximation
    t = Math.min(50000, Math.max(2000, 449 * nn ** 3 + 3525 * nn ** 2 + 6823.3 * nn + 5520.33));
  }
  const w = weight(t), d = [1 / neutral[0], 0, 0, 0, 1 / neutral[1], 0, 0, 0, 1 / neutral[2]];
  let camToXyz;
  if (p.fm1) camToXyz = mul(blend(p.fm1, p.fm2, w), d);           // ForwardMatrix maps white-balanced camera RGB to XYZ D50
  else { const m = inv(blend(p.cm1, p.cm2, w)), white = apply(m, neutral); camToXyz = mul([D50[0] / white[0], 0, 0, 0, D50[1] / white[1], 0, 0, 0, D50[2] / white[2]], m); }
  return { kelvin: t, weight: w, matrix: mul(XYZ_TO_PROPHOTO, camToXyz) };
}

/* White balance as Temp and Tint (DNG SDK's convention): a colour temperature on the Planckian locus (CIE 1960
   uv, Krystek's fit) and Tint as the offset across it, −3000 per unit of uv distance. */
const planck = (/** @type {number} */ t) => [(0.860117757 + 1.54118254e-4 * t + 1.28641212e-7 * t * t) / (1 + 8.42420235e-4 * t + 7.08145163e-7 * t * t),
  (0.317398726 + 4.22806245e-5 * t + 4.20481691e-8 * t * t) / (1 - 2.89741816e-5 * t + 1.61456053e-7 * t * t)];
const across = (/** @type {number} */ t) => { const a = planck(t - 1), b = planck(t + 1), du = b[0] - a[0], dv = b[1] - a[1], l = Math.hypot(du, dv); return [-dv / l, du / l]; };
/** The shot's white as Temp (K) and Tint. @param {Profile} p @param {number[]} neutral */
export function whiteOf(p, neutral) {
  const { kelvin } = cameraToProPhoto(p, neutral), xyz = apply(inv(blend(p.cm1, p.cm2, weightOf(p, kelvin))), neutral);
  const d = xyz[0] + 15 * xyz[1] + 3 * xyz[2], u = (4 * xyz[0]) / d, v = (6 * xyz[1]) / d, [pu, pv] = planck(kelvin), [nu, nv] = across(kelvin);
  return { kelvin, tint: ((u - pu) * nu + (v - pv) * nv) * -3000 };
}
/** The camera neutral for a Temp and Tint (G = 1). @param {Profile} p @param {number} kelvin @param {number} tint */
export function neutralFor(p, kelvin, tint) {
  const t = Math.min(15000, Math.max(2000, kelvin)), [pu, pv] = planck(t), [nu, nv] = across(t), u = pu + (nu * tint) / -3000, v = pv + (nv * tint) / -3000;
  const x = (3 * u) / (2 * u - 8 * v + 4), y = (2 * v) / (2 * u - 8 * v + 4), n = apply(blend(p.cm1, p.cm2, weightOf(p, t)), [x / y, 1, (1 - x - y) / y]);
  return [n[0] / n[1], 1, n[2] / n[1]];
}

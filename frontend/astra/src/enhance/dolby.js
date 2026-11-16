// Dolby Vision profile 5 colours. Such a film is HEVC whose three planes carry IPTPQc2 (I, P, T: an
// opponent space made from PQ-coded cone responses) instead of Y'CbCr, with no ordinary picture under
// it. The browser does not know that: it turns the planes into R'G'B' with an ordinary Y'CbCr matrix,
// so the picture comes out purple and green. This undoes that step and converts the planes the right
// way: planes -> I, P, T -> L'M'S' (the "nonlinear" matrix) -> PQ EOTF per channel -> LMS -> BT.2020
// light (the "linear" matrix), which the tone-mapping pass then shows as it shows any PQ film.
//
// What the browser hands WebGL (measured in this repository's Chromium, both test browsers, with VP9
// clips of chosen code values; see tests/astra-dolby-browser.test.mjs):
// - flagged BT.2020 PQ: R'G'B' from the planes by the frame's own matrix and range, CLIPPED to 0..1,
//   then the PQ EOTF, the canvas's primaries and the sRGB curve, as for any HDR film (picture.js).
//   Out-of-range R'G'B' does not survive: the clip comes before the PQ curve.
// - flagged as nothing (no colour fields): R'G'B' by the BT.601 matrix at limited range, clipped and
//   in 8 bits, with no curve applied.
// So the inversion is exact wherever the browser's R'G'B' stayed inside 0..1, which holds for greys
// from about 0.1 to 6000 nits and for most natural colours (skin, foliage, sky); strongly saturated
// blues and the deepest BT.2020 greens, very dark saturated colours, and anything under about
// 0.1 nits were clipped by the browser and come out approximately, not exactly.
//
// Constants, and where each comes from:
// - PQ (SMPTE ST 2084): tonemap.js.
// - The profile 5 nonlinear matrix (IPT -> L'M'S', the RPU's ycc_to_rgb, in 1/8192) and its offsets
//   (0, 1/2, 1/2), and the linear matrix (in 1/16384, which takes the 2 % crosstalk back out of LMS):
//   dovi_tool's dolby_vision/src/rpu/profiles/profile5.rs, the defaults it writes for profile 5 (MIT,
//   see LICENSES.md). The nonlinear one is the inverse of Ebner and Fairchild's IPT matrix (1998).
// - HPE LMS -> BT.2020 RGB: libplacebo, src/shaders/colorspace.c ("Dolby Vision always outputs
//   BT.2020-referred HPE LMS"), checked in the tests against Hunt-Pointer-Estevez XYZ->LMS (D65) times
//   BT.2020's RGB->XYZ.
// - Primaries: ITU-R BT.709, BT.2020, SMPTE EG 432-1 (Display P3), all D65.
// - Planes are taken as code / 1024, as libplacebo feeds the RPU's matrices (reshaping maps code / 2^bits).

const M1 = 2610 / 16384, M2 = 2523 / 4096 * 128, C1 = 3424 / 4096, C2 = 2413 / 4096 * 32, C3 = 2392 / 4096 * 32;
export const pq = n => { const y = Math.pow(Math.max(0, n) / 10000, M1); return Math.pow((C1 + C2 * y) / (1 + C3 * y), M2); };
export const pqNits = e => { const p = Math.pow(Math.max(0, e), 1 / M2); return 10000 * Math.pow(Math.max(p - C1, 0) / (C2 - C3 * p), 1 / M1); };

export const NONLINEAR = [[8192, 799, 1681], [8192, -933, 1091], [8192, 267, -5545]].map(r => r.map(x => x / 8192));
export const OFFSET = [0, 0.5, 0.5];
export const LINEAR = [[17081, -349, -349], [-349, 17081, -349], [-349, -349, 17081]].map(r => r.map(x => x / 16384));
export const LMS_TO_2020 = [
  [3.064396767855625, -2.165961226711146, 0.1015574148869036],
  [-0.65613130540261551, 1.7855694129834121, -0.12943951030147041],
  [0.017360633500538487, -0.047244531564539943, 1.0298894699757705]];
const PRIMARIES = {srgb: [0.64, 0.33, 0.30, 0.60, 0.15, 0.06], bt2020: [0.708, 0.292, 0.170, 0.797, 0.131, 0.046], 'display-p3': [0.680, 0.320, 0.265, 0.690, 0.150, 0.060]};
const D65 = [0.3127, 0.3290];
// Y'CbCr matrices by the frame's colorSpace.matrix: [Kr, Kb]. No matrix named: Chrome used BT.601 (measured).
const KRB = {bt709: [0.2126, 0.0722], bt470bg: [0.299, 0.114], smpte170m: [0.299, 0.114], 'bt2020-ncl': [0.2627, 0.0593]};

export const mul = (a, b) => a.map(r => b[0].map((_, j) => r.reduce((s, x, k) => s + x * b[k][j], 0)));
export const apply = (m, v) => m.map(r => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
export function invert(m) {
  const [[a, b, c], [d, e, f], [g, h, i]] = m, A = e * i - f * h, B = f * g - d * i, C = d * h - e * g, det = a * A + b * B + c * C;
  return [[A, c * h - b * i, b * f - c * e], [B, a * i - c * g, c * d - a * f], [C, b * g - a * h, a * e - b * d]].map(r => r.map(x => x / det));
}

/** RGB -> XYZ for a set of primaries (xy of red, green, blue) and D65 white. */
export function rgbToXyz(name) {
  const p = PRIMARIES[name], xyz = (x, y) => [x / y, 1, (1 - x - y) / y];
  const m = [0, 1, 2].map(i => xyz(p[2 * i], p[2 * i + 1])), cols = [[m[0][0], m[1][0], m[2][0]], [m[0][1], m[1][1], m[2][1]], [m[0][2], m[1][2], m[2][2]]];
  const s = apply(invert(cols), xyz(...D65));
  return cols.map(r => r.map((x, j) => x * s[j]));
}
/** Linear light from one set of primaries to another. */
export const convert = (from, to) => from === to ? [[1, 0, 0], [0, 1, 0], [0, 0, 1]] : mul(invert(rgbToXyz(to)), rgbToXyz(from));

/** LMS (as the RPU's matrices leave it) to BT.2020 light: the crosstalk out, then HPE LMS to RGB. */
const LMS_LIGHT = mul(LMS_TO_2020, LINEAR);

/** Plane values (code / 1024: I, P, T) to BT.2020 light in nits. */
export function planesToLight(planes) {
  const lmsP = apply(NONLINEAR, planes.map((v, i) => v - OFFSET[i]));
  return apply(LMS_LIGHT, lmsP.map(pqNits));
}

/** BT.2020 light in nits to plane values (code / 1024): what a profile 5 encoder writes, with no reshaping. */
export function lightToPlanes(rgb) {
  const lmsP = apply(invert(LMS_LIGHT), rgb).map(pq);
  return apply(invert(NONLINEAR), lmsP).map((v, i) => v + OFFSET[i]);
}

/** The browser's step, for 10-bit codes [Y, Cb, Cr]: R'G'B' as it computes them before its clip. */
export function browserRGB(codes, {matrix = null, fullRange = false} = {}) {
  return apply(invert(ycc(matrix)), norm(fullRange).map(([s, o], i) => (codes[i] - o) / s));
}

/** R'G'B' -> Y'CbCr for a matrix name. */
function ycc(matrix) {
  const [kr, kb] = KRB[matrix] || KRB.smpte170m, kg = 1 - kr - kb;
  return [[kr, kg, kb], [-kr / (2 - 2 * kb), -kg / (2 - 2 * kb), 0.5], [0.5, -kg / (2 - 2 * kr), -kb / (2 - 2 * kr)]];
}
// Per channel: [code steps for a unit, code of zero], 10 bits.
const norm = full => full ? [[1023, 0], [1023, 512], [1023, 512]] : [[876, 64], [896, 512], [896, 512]];

/**
 * The correction for one film as the shader's constants (rows; filter.js passes them column-major):
 * pq: whether the frame came up as HDR (sRGB-encoded light in the canvas's primaries, 1.0 = 203 nits)
 * or as plain R'G'B'; toRGB: the canvas's linear light to BT.2020 (PQ uploads only); a, b: R'G'B' to
 * L'M'S' (the browser's matrix undone, the planes' offsets, the nonlinear matrix, all in one);
 * light: LMS to the canvas's linear light.
 * @param {{matrix?: string|null, fullRange?: boolean|null, transfer?: string|null}} colorSpace  the frame's, as VideoFrame reports it
 * @param {string} space  the canvas's colour space: 'srgb' or 'display-p3'
 */
export function correction(colorSpace = {}, space = 'srgb') {
  const n = norm(!!colorSpace.fullRange), toCodes = ycc(colorSpace.matrix ?? null);
  // R'G'B' -> plane values: Y'CbCr, then codes (scale and zero), then / 1024, then less the IPT offsets.
  const toPlanes = toCodes.map((r, i) => r.map(x => x * n[i][0] / 1024)), shift = n.map(([, o], i) => o / 1024 - OFFSET[i]);
  return {pq: colorSpace.transfer === 'pq', toRGB: convert(space, 'bt2020'), a: mul(NONLINEAR, toPlanes), b: apply(NONLINEAR, shift), light: mul(convert('bt2020', space), LMS_LIGHT)};
}

/** The same correction in plain numbers: what the shader computes for one uploaded texel (for the tests). */
export function correct(texel, c, white = 203) {
  const dec = e => Math.sign(e) * (Math.abs(e) <= 0.04045 ? Math.abs(e) / 12.92 : Math.pow((Math.abs(e) + 0.055) / 1.055, 2.4));
  const rgbP = c.pq ? apply(c.toRGB, texel.map(e => dec(e) * white)).map(pq) : texel;
  const lmsP = apply(c.a, rgbP.map(v => Math.min(1, Math.max(0, v)))).map((v, i) => v + c.b[i]);
  return apply(c.light, lmsP.map(pqNits));
}

/** A row-major 3x3 as WebGL wants it (column-major). */
export const cols = m => new Float32Array([m[0][0], m[1][0], m[2][0], m[0][1], m[1][1], m[2][1], m[0][2], m[1][2], m[2][2]]);

/**
 * The tone-mapping pass's source for a profile 5 film (tonemap.js): the uploaded texel back to the
 * browser's R'G'B', then to the film's light in the canvas's primaries, in nits. Same maths as correct().
 */
export const DOLBY_FILM = `
uniform float dvPQ; uniform mat3 dvToRGB, dvA, dvLight; uniform vec3 dvB;
vec3 pq3(vec3 n) { vec3 y = pow(max(n, 0.0) / 10000.0, vec3(M1)); return pow((C1 + C2 * y) / (1.0 + C3 * y), vec3(M2)); }
vec3 pqNits3(vec3 e) { vec3 p = pow(max(e, 0.0), vec3(1.0 / M2)); return 10000.0 * pow(max(p - C1, 0.0) / (C2 - C3 * p), vec3(1.0 / M1)); }
vec3 film(vec3 e) {
  vec3 rgb = dvPQ > 0.5 ? pq3(dvToRGB * (decode(e) * white)) : e;
  return max(dvLight * pqNits3(dvA * clamp(rgb, 0.0, 1.0) + dvB), 0.0);
}`;

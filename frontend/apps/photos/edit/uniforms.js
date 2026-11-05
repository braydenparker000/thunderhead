// @ts-check
// A recipe as the GPU reads it (shaders/develop.*): 32 vec4s of controls, geometry and the view, and the tone
// curve as a 1024-entry lookup (RGBA half floats). The lookup holds, per channel, what the sliders
// that act on tone globally do in order: the base curve (RAW only, fields.js BASE_TONE; the shoulder
// before it is in the develop pass, on the brightest channel), Contrast (an S around mid-grey), Whites and
// Blacks, then the point curves (master, then the channel's), to sRGB-encoded output. Its input is log2
// of linear light from 2^-12 to 4.
import { BASE_TONE, CURVES, HUES, NUMBERS, val } from './fields.js';
import { gainsFor, REC2020_TO_SRGB } from './color.js';
import { frameSize, geometry } from './geometry.js';

export const LUT_SIZE = 1024;
export const UNIFORMS = 32;

/** @param {number} f */
export function half(f) {
  const v = new Float32Array([f]), i = new Uint32Array(v.buffer)[0];
  const s = (i >>> 16) & 0x8000, e = ((i >>> 23) & 0xff) - 112, m = i & 0x7fffff;
  if (e <= 0) return s;
  if (e >= 31) return s | 0x7c00;
  return s | (e << 10) | ((m + 0x1000) >>> 13);
}

/** A monotone cubic through the curve's points (0–255), as a function on 0–1. @param {[number, number][] | undefined} pts */
export function spline(pts) {
  if (!pts || pts.length < 2) return (/** @type {number} */ x) => x;
  const xs = pts.map((p) => p[0] / 255), ys = pts.map((p) => p[1] / 255), n = xs.length;
  const d = xs.slice(1).map((x, i) => (ys[i + 1] - ys[i]) / (x - xs[i]));
  const m = xs.map((_, i) => (i === 0 ? d[0] : i === n - 1 ? d[n - 2] : d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2));
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], h = Math.hypot(a, b);
    if (h > 3) { m[i] = (3 * a * d[i]) / h; m[i + 1] = (3 * b * d[i]) / h; }
  }
  return (/** @type {number} */ x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let k = 0;
    while (x > xs[k + 1]) k++;
    const h = xs[k + 1] - xs[k], t = (x - xs[k]) / h;
    return (2 * t ** 3 - 3 * t ** 2 + 1) * ys[k] + (t ** 3 - 2 * t ** 2 + t) * h * m[k] + (-2 * t ** 3 + 3 * t ** 2) * ys[k + 1] + (t ** 3 - t ** 2) * h * m[k + 1];
  };
}

const oetf = (/** @type {number} */ v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
const clamp01 = (/** @type {number} */ v) => Math.min(1, Math.max(0, v));

/** @param {import('./fields.js').Recipe} r @param {boolean} raw @returns {Uint16Array} */
export function toneLut(r, raw) {
  const out = new Uint16Array(LUT_SIZE * 4);
  const k = (val(r, 'Contrast2012') / 100) * 0.45, base = raw ? spline(/** @type {any} */ (BASE_TONE.curve)) : (/** @type {number} */ x) => x;
  const g = Math.log(0.5) / Math.log(oetf(BASE_TONE.midGrey));
  const wh = 2 ** (-(val(r, 'Whites2012') / 100) * 0.9), bl = 2 ** (-(val(r, 'Blacks2012') / 100) * 0.9);
  const [m, cr, cg, cb] = CURVES.map((c) => spline(/** @type {any} */ (r)[c]));
  for (let i = 0; i < LUT_SIZE; i++) {
    const x = 2 ** ((i / (LUT_SIZE - 1)) * 14 - 12);
    let e = base(oetf(clamp01(x)));
    const u = e ** g;
    e = clamp01(u + 2 * k * u * (1 - u) * (2 * u - 1)) ** (1 / g);
    e = 1 - (1 - clamp01(e)) ** (1 / wh);
    e = clamp01(e) ** bl;
    const t = m(clamp01(e));
    [cr, cg, cb].forEach((c, j) => { out[i * 4 + j] = half(clamp01(c(t))); });
    out[i * 4 + 3] = half(1);
  }
  return out;
}

/** A grading wheel's colour push in display RGB: the hue at full chroma less its own luma, times saturation. */
function tint(/** @type {number} */ hue, /** @type {number} */ sat) {
  const h = ((hue % 360) + 360) % 360 / 60, x = 1 - Math.abs((h % 2) - 1);
  const rgb = h < 1 ? [1, x, 0] : h < 2 ? [x, 1, 0] : h < 3 ? [0, 1, x] : h < 4 ? [0, x, 1] : h < 5 ? [x, 0, 1] : [1, 0, x];
  const y = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  return rgb.map((c) => (c - y) * (sat / 100) * 0.35);
}

/**
 * @param {import('./fields.js').Recipe} r
 * @param {{ raw: boolean, rawPhoto?: boolean, asShot: number[], shot: { temperature: number, tint: number }, auto?: { temperature: number, tint: number } | null, width: number, height: number, ca?: number[] }} img
 * @param {{ scale: number[], offset: number[], size: number[], flip: number, p0: number[], tile: null | { u0: number, v0: number, u1: number, v1: number, texel: number[] } }} view
 */
export function pack(r, img, view) {
  const u = new Float32Array(UNIFORMS * 4);
  const put = (/** @type {number} */ i, /** @type {number[]} */ v) => u.set(v, i * 4);
  const v = (/** @type {string} */ k) => val(r, k, img.rawPhoto ?? img.raw);
  const wb = r.WhiteBalance === 'Custom' ? { temperature: v('Temperature'), tint: v('Tint') } : r.WhiteBalance === 'Auto' && img.auto ? img.auto : null;
  const g = wb ? gainsFor(img.asShot, wb.temperature, wb.tint) : [1, 1, 1];
  put(0, [...g, 2 ** v('Exposure2012')]);
  put(1, [v('Contrast2012') / 100, v('Highlights2012') / 100, v('Shadows2012') / 100, v('Whites2012') / 100]);
  put(2, [v('Blacks2012') / 100, v('Vibrance') / 100, v('Saturation') / 100, r.ConvertToGrayscale ? 1 : 0]);
  put(3, [v('Texture') / 100, v('Clarity2012') / 100, v('Dehaze') / 100, img.raw ? 1 : Math.min(1, Math.max(0, v('Exposure2012')))]);
  put(4, [v('Sharpness') / 100, v('SharpenRadius'), v('SharpenDetail') / 100, v('SharpenEdgeMasking') / 100]);
  put(5, [v('LuminanceSmoothing') / 100, v('LuminanceNoiseReductionDetail') / 100, v('ColorNoiseReduction') / 100, v('ColorNoiseReductionDetail') / 100]);
  put(6, [v('PostCropVignetteAmount') / 100, v('PostCropVignetteMidpoint') / 100, v('PostCropVignetteFeather') / 100, v('PostCropVignetteRoundness') / 100]);
  const geo = geometry(r, img.width, img.height), [fw, fh] = frameSize(geo);
  put(7, [v('GrainAmount') / 100, v('GrainSize') / 100, v('GrainFrequency') / 100, fw]);
  put(8, [...tint(v('SplitToningShadowHue'), v('SplitToningShadowSaturation')), v('ColorGradeShadowLum') / 100]);
  put(9, [...tint(v('ColorGradeMidtoneHue'), v('ColorGradeMidtoneSat')), v('ColorGradeMidtoneLum') / 100]);
  put(10, [...tint(v('SplitToningHighlightHue'), v('SplitToningHighlightSaturation')), v('ColorGradeHighlightLum') / 100]);
  put(11, [v('ColorGradeBlending') / 100, v('SplitToningBalance') / 100, fw / fh, 0]);
  HUES.forEach((h, i) => {
    u[48 + i] = v(`HueAdjustment${h}`) / 100;
    u[56 + i] = v(`SaturationAdjustment${h}`) / 100;
    u[64 + i] = v(`LuminanceAdjustment${h}`) / 100;
  });
  put(18, [...view.scale, ...view.offset]);
  put(19, [...view.p0, view.tile?.u0 ?? 0, view.tile?.v0 ?? 0]);
  put(20, [view.tile?.u1 ?? 0, view.tile?.v1 ?? 0, view.tile ? 1 : 0, 0]);
  put(21, [...view.size, view.flip, 0]);
  put(22, [...(view.tile?.texel ?? [0, 0]), 0, 0]);
  REC2020_TO_SRGB.forEach((row, i) => put(23 + i, [...row, 0]));
  put(26, geo.crop);
  put(27, [geo.cos, geo.sin, geo.z, geo.a]);
  put(28, [geo.kv, geo.kh, geo.kd, geo.rmax]);
  put(29, [...geo.flip, v('VignetteAmount') / 100, 0]);
  put(30, [...(r.AutoLateralCA && img.ca ? img.ca : [0, 0]), 0, 0]);
  return u;
}

export { NUMBERS };

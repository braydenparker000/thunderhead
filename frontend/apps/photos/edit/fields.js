// @ts-check
// The recipe on the phone (shared/contract/photos-recipe.ts, which tests/photos-edit.test.mjs checks
// this against): each control's range and default, and the four panels as the editor shows them, one
// slider at a time, in the order of the study: a name, the recipe key, a step, and the value in words.

/** @typedef {import('../../../../shared/contract/photos-recipe.ts').PhotoRecipe} Recipe */
/** @typedef {{ key: string, label: string, step: number, unit?: string, up?: string, down?: string, zero?: string, raw?: number }} Control */
/** @typedef {{ id: 'light'|'color'|'effects'|'detail'|'optics'|'crop'|'versions', label: string, icon: string, tools: (Control | { tool: string, label: string })[] }} Panel */

const pm = (/** @type {number} */ n) => [-n, n, 0];
/** [min, max, default], the contract's RECIPE_NUMBERS. */
export const NUMBERS = /** @type {Record<string, number[]>} */ ({
  Exposure2012: [-5, 5, 0], Contrast2012: pm(100), Highlights2012: pm(100), Shadows2012: pm(100), Whites2012: pm(100), Blacks2012: pm(100),
  Vibrance: pm(100), Saturation: pm(100),
  ...Object.fromEntries(['Hue', 'Saturation', 'Luminance'].flatMap((p) => ['Red', 'Orange', 'Yellow', 'Green', 'Aqua', 'Blue', 'Purple', 'Magenta'].map((c) => [`${p}Adjustment${c}`, pm(100)]))),
  SplitToningShadowHue: [0, 359, 0], SplitToningShadowSaturation: [0, 100, 0], ColorGradeShadowLum: pm(100),
  ColorGradeMidtoneHue: [0, 359, 0], ColorGradeMidtoneSat: [0, 100, 0], ColorGradeMidtoneLum: pm(100),
  SplitToningHighlightHue: [0, 359, 0], SplitToningHighlightSaturation: [0, 100, 0], ColorGradeHighlightLum: pm(100),
  ColorGradeBlending: [0, 100, 50], SplitToningBalance: pm(100),
  Texture: pm(100), Clarity2012: pm(100), Dehaze: pm(100),
  PostCropVignetteAmount: pm(100), PostCropVignetteMidpoint: [0, 100, 50], PostCropVignetteFeather: [0, 100, 50], PostCropVignetteRoundness: pm(100),
  GrainAmount: [0, 100, 0], GrainSize: [0, 100, 25], GrainFrequency: [0, 100, 50],
  Sharpness: [0, 150, 40], SharpenRadius: [0.5, 3, 1], SharpenDetail: [0, 100, 25], SharpenEdgeMasking: [0, 100, 0],
  LuminanceSmoothing: [0, 100, 0], LuminanceNoiseReductionDetail: [0, 100, 50], ColorNoiseReduction: [0, 100, 25], ColorNoiseReductionDetail: [0, 100, 50],
  Temperature: [2000, 50000, 5500], Tint: [-150, 150, 0],
  LensManualDistortionAmount: pm(100), VignetteAmount: pm(100),
  CropTop: [0, 1, 0], CropLeft: [0, 1, 0], CropBottom: [0, 1, 1], CropRight: [0, 1, 1], CropAngle: [-45, 45, 0],
  PerspectiveVertical: pm(100), PerspectiveHorizontal: pm(100),
});
export const CURVES = ['ToneCurvePV2012', 'ToneCurvePV2012Red', 'ToneCurvePV2012Green', 'ToneCurvePV2012Blue'];
export const HUES = ['Red', 'Orange', 'Yellow', 'Green', 'Aqua', 'Blue', 'Purple', 'Magenta'];
/** A JPEG has been sharpened and cleaned by its camera already: its as-shot Detail starts at zero. */
const JPEG_ZERO = ['Sharpness', 'ColorNoiseReduction'];

/** A control's value in `r` (its default when left out). @param {Recipe} r @param {string} key @param {boolean} [raw] */
export function val(r, key, raw = true) {
  const v = /** @type {Record<string, unknown>} */ (r)[key];
  if (typeof v === 'number') return v;
  return !raw && JPEG_ZERO.includes(key) ? 0 : (NUMBERS[key]?.[2] ?? 0);
}

/** The value in words and its number, as the slider shows it. @param {Control} c @param {number} v @param {number} [def] */
export function words(c, v, def = NUMBERS[c.key]?.[2] ?? 0) {
  const n = c.unit === '°' && c.step < 1 ? `${v > 0 ? '+' : ''}${v.toFixed(1)}°` : c.step < 1 ? (v > 0 ? `+${v.toFixed(2)}` : v.toFixed(2)) : c.unit === 'K' ? `${Math.round(v)} K` : c.unit === '°' ? `${Math.round(v)}°` : v > 0 && NUMBERS[c.key]?.[0] < 0 ? `+${Math.round(v)}` : String(Math.round(v));
  const w = v > def ? c.up : v < def ? c.down : (c.zero ?? 'as shot');
  return { number: n, words: w ?? '' };
}

const b = (/** @type {string} */ key, /** @type {string} */ label, /** @type {string} */ up, /** @type {string} */ down, step = 1) => ({ key, label, step, up, down, zero: 'as shot' });
/** @type {Panel[]} */
export const PANELS = [
  { id: 'light', label: 'Light', icon: 'sun', tools: [
    { tool: 'auto', label: 'Auto' },
    b('Exposure2012', 'Exposure', 'brighter', 'darker', 0.01),
    b('Contrast2012', 'Contrast', 'more contrast', 'flatter'),
    b('Highlights2012', 'Highlights', 'brighter highlights', 'highlights held back'),
    b('Shadows2012', 'Shadows', 'shadows opened', 'deeper shadows'),
    b('Whites2012', 'Whites', 'brighter whites', 'dimmer whites'),
    b('Blacks2012', 'Blacks', 'lifted blacks', 'deeper blacks'),
    { tool: 'curve', label: 'Curve' },
  ] },
  { id: 'color', label: 'Color', icon: 'palette', tools: [
    { tool: 'wb', label: 'White balance' },
    { key: 'Temperature', label: 'Temp', step: 50, unit: 'K', up: 'warmer', down: 'cooler' },
    { key: 'Tint', label: 'Tint', step: 1, up: 'more magenta', down: 'more green' },
    b('Vibrance', 'Vibrance', 'richer muted colours', 'muted'),
    b('Saturation', 'Saturation', 'more colour', 'less colour'),
    { tool: 'mix', label: 'Mix' },
    { tool: 'grading', label: 'Grading' },
    { tool: 'bw', label: 'B&W' },
  ] },
  { id: 'effects', label: 'Effects', icon: 'sparkle', tools: [
    b('Texture', 'Texture', 'more fine detail', 'smoother'),
    b('Clarity2012', 'Clarity', 'more punch', 'softer'),
    b('Dehaze', 'Dehaze', 'haze cut', 'hazier'),
    b('PostCropVignetteAmount', 'Vignette', 'lighter edges', 'darker edges'),
    { key: 'PostCropVignetteMidpoint', label: 'Midpoint', step: 1, up: 'toward the corners', down: 'toward the middle', zero: 'middle' },
    { key: 'PostCropVignetteFeather', label: 'Feather', step: 1, up: 'softer edge', down: 'harder edge', zero: 'middle' },
    { key: 'PostCropVignetteRoundness', label: 'Roundness', step: 1, up: 'rounder', down: 'squarer', zero: 'the frame’s shape' },
    { key: 'GrainAmount', label: 'Grain', step: 1, up: 'grain', zero: 'none' },
    { key: 'GrainSize', label: 'Size', step: 1, up: 'coarser', down: 'finer', zero: 'standard' },
    { key: 'GrainFrequency', label: 'Roughness', step: 1, up: 'rougher', down: 'smoother', zero: 'standard' },
  ] },
  { id: 'detail', label: 'Detail', icon: 'triangle', tools: [
    { key: 'Sharpness', label: 'Sharpening', step: 1, up: 'sharper', down: 'less sharp', zero: 'as shot' },
    { key: 'SharpenRadius', label: 'Radius', step: 0.1, up: 'wider', down: 'finer', zero: 'as shot' },
    { key: 'SharpenDetail', label: 'Detail', step: 1, up: 'more detail', down: 'smoother', zero: 'as shot' },
    { key: 'SharpenEdgeMasking', label: 'Masking', step: 1, up: 'edges only', zero: 'whole photo' },
    { key: 'LuminanceSmoothing', label: 'Noise', step: 1, up: 'smoother', zero: 'none' },
    { key: 'LuminanceNoiseReductionDetail', label: 'Noise detail', step: 1, up: 'more detail kept', down: 'smoother', zero: 'as shot' },
    { key: 'ColorNoiseReduction', label: 'Color noise', step: 1, up: 'cleaner colour', down: 'less cleaning', zero: 'as shot' },
    { key: 'ColorNoiseReductionDetail', label: 'Color detail', step: 1, up: 'more colour detail', down: 'smoother', zero: 'as shot' },
  ] },
  { id: 'optics', label: 'Optics', icon: 'aperture', tools: [
    { tool: 'ca', label: 'Chromatic aberration' },
    b('LensManualDistortionAmount', 'Distortion', 'barrel corrected', 'pincushion corrected'),
    b('VignetteAmount', 'Lens vignetting', 'lighter corners', 'darker corners'),
  ] },
  { id: 'crop', label: 'Crop', icon: 'crop', tools: [
    { tool: 'aspect', label: 'Aspect' },
    { key: 'CropAngle', label: 'Rotate', step: 0.1, unit: '°', up: 'turned clockwise', down: 'turned anticlockwise', zero: 'level' },
    { tool: 'level', label: 'Level' },
    { tool: 'flip', label: 'Flip' },
    b('PerspectiveVertical', 'Vertical', 'top wider', 'bottom wider'),
    b('PerspectiveHorizontal', 'Horizontal', 'left wider', 'right wider'),
    { tool: 'constrain', label: 'Constrain' },
    { tool: 'reset', label: 'Reset' },
  ] },
  { id: 'versions', label: 'Versions', icon: 'stack', tools: [
    { tool: 'all', label: 'All' },
    { tool: 'named', label: 'Named' },
    { tool: 'auto', label: 'Automatic' },
  ] },
];

/** The grading wheels: each one's hue, saturation and luminance keys. */
export const WHEELS = [
  { id: 'shadows', label: 'Shadows', hue: 'SplitToningShadowHue', sat: 'SplitToningShadowSaturation', lum: 'ColorGradeShadowLum' },
  { id: 'midtones', label: 'Midtones', hue: 'ColorGradeMidtoneHue', sat: 'ColorGradeMidtoneSat', lum: 'ColorGradeMidtoneLum' },
  { id: 'highlights', label: 'Highlights', hue: 'SplitToningHighlightHue', sat: 'SplitToningHighlightSaturation', lum: 'ColorGradeHighlightLum' },
];

/** A recipe with `key` set (the default removes it), never changed in place. @param {Recipe} r @param {string} key @param {unknown} v */
export function withValue(r, key, v) {
  const out = /** @type {Record<string, unknown>} */ ({ ...r });
  if (v === undefined || v === null || (NUMBERS[key] && key !== 'Temperature' && key !== 'Tint' && v === NUMBERS[key][2])) delete out[key];
  else out[key] = v;
  return /** @type {Recipe} */ (out);
}

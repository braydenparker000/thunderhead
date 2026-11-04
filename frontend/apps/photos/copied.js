// @ts-check
// The copied edit (PHOTOS.md, Copy and paste): the panels the editor's Copy chose and the photo's keys
// in them, held in memory and in this tab's session storage (a reload keeps it, closing the tab lets
// it go). Each panel owns its keys (shared/contract/photos-paste.ts, which tests/photos-edit.test.mjs
// checks this copy against), so a key left out is pasted as that panel's default.

/** @typedef {import('../../../shared/contract/photos.ts').PastePanel} Panel */
/** @typedef {import('../../../shared/contract/photos.ts').PhotoRecipe} Recipe */
/** @typedef {{ panels: Panel[], recipe: Recipe, at: number }} Copy */

const KEY = 'th.photos.copy';
const HUES = ['Red', 'Orange', 'Yellow', 'Green', 'Aqua', 'Blue', 'Purple', 'Magenta'];
/** @type {Record<Panel, string[]>} */
export const PANEL_KEYS = {
  light: ['Exposure2012', 'Contrast2012', 'Highlights2012', 'Shadows2012', 'Whites2012', 'Blacks2012', 'ToneCurvePV2012', 'ToneCurvePV2012Red', 'ToneCurvePV2012Green', 'ToneCurvePV2012Blue'],
  color: ['WhiteBalance', 'Temperature', 'Tint', 'Vibrance', 'Saturation', ...['Hue', 'Saturation', 'Luminance'].flatMap((p) => HUES.map((h) => `${p}Adjustment${h}`)),
    'SplitToningShadowHue', 'SplitToningShadowSaturation', 'ColorGradeShadowLum', 'ColorGradeMidtoneHue', 'ColorGradeMidtoneSat', 'ColorGradeMidtoneLum',
    'SplitToningHighlightHue', 'SplitToningHighlightSaturation', 'ColorGradeHighlightLum', 'ColorGradeBlending', 'SplitToningBalance', 'ConvertToGrayscale'],
  effects: ['Texture', 'Clarity2012', 'Dehaze', 'PostCropVignetteAmount', 'PostCropVignetteMidpoint', 'PostCropVignetteFeather', 'PostCropVignetteRoundness', 'GrainAmount', 'GrainSize', 'GrainFrequency'],
  detail: ['Sharpness', 'SharpenRadius', 'SharpenDetail', 'SharpenEdgeMasking', 'LuminanceSmoothing', 'LuminanceNoiseReductionDetail', 'ColorNoiseReduction', 'ColorNoiseReductionDetail'],
  optics: ['AutoLateralCA', 'LensProfileEnable', 'LensManualDistortionAmount', 'VignetteAmount'],
  crop: ['CropTop', 'CropLeft', 'CropBottom', 'CropRight', 'CropAngle', 'PerspectiveVertical', 'PerspectiveHorizontal', 'CropConstrainToWarp', 'FlipHorizontal', 'FlipVertical'],
};
/** @type {[Panel, string][]} */
export const PANEL_NAMES = [['light', 'Light'], ['color', 'Color'], ['effects', 'Effects'], ['detail', 'Detail'], ['optics', 'Optics'], ['crop', 'Crop and geometry']];
/** At most this many photos take one paste or one export from the shelf (the contract's PASTE_LIMITS). */
export const MAX_PHOTOS = 20;

/** The keys of `recipe` in `panels`. @param {Recipe} recipe @param {Panel[]} panels @returns {Recipe} */
export function pick(recipe, panels) {
  const keys = new Set(panels.flatMap((p) => PANEL_KEYS[p]));
  return /** @type {Recipe} */ (Object.fromEntries(Object.entries(recipe).filter(([k]) => keys.has(k))));
}

/** "Light, Color and Effects". @param {Panel[]} panels */
export function named(panels) {
  const n = PANEL_NAMES.filter(([p]) => panels.includes(p)).map(([, s]) => s);
  return n.length > 1 ? `${n.slice(0, -1).join(', ')} and ${n.at(-1)}` : (n[0] ?? '');
}

/** @type {Copy | null} */
let mem = null;
/** The copy held, if any. @returns {Copy | null} */
export function held() {
  if (mem) return mem;
  try { mem = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch { mem = null; }
  return mem;
}
/** @param {Copy} c */
export function hold(c) {
  mem = c;
  try { sessionStorage.setItem(KEY, JSON.stringify(c)); } catch {}
}
export function drop() {
  mem = null;
  try { sessionStorage.removeItem(KEY); } catch {}
}

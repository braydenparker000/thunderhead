// @ts-check
// A Lightroom preset (`.xmp`) as a look of the owner's own (engine/raw/ROADMAP.md stage 4). The file is read by the
// reader the editor before has (apps/photos/edit/xmp-import.js: only develop settings it knows, each held inside
// its range, a Look block's parameters scaled by its Amount; no author, no thumbnail), and what it holds is laid on
// this editor's own controls, which carry Lightroom's names and scales: the Light and Color sliders, Texture,
// Clarity, Dehaze, the colour mixer's eight colours, grading's three ranges, the point curves, Sharpening and the
// two Noise sliders, Vignette and Grain. A preset says nothing of a photo's exposure, white balance, crop or
// profile here: wearing it leaves those the photo's own. The strengths are not yet matched to Lightroom's
// (ROADMAP.md stage 4), so a preset lands near what it does there, not on it.
import { XMP_MAX_BYTES, presetOfXmp } from '../../../apps/photos/edit/xmp-import.js';
import { COLOURS } from '../../engine/grade.js';

export { XMP_MAX_BYTES };
/** Lightroom's name for a setting, and this editor's. */
const PLAIN = /** @type {Record<string, string>} */ ({ Contrast2012: 'Contrast', Highlights2012: 'Highlights', Shadows2012: 'Shadows', Whites2012: 'Whites', Blacks2012: 'Blacks', Vibrance: 'Vibrance',
  Saturation: 'Saturation', Texture: 'Texture', Clarity2012: 'Clarity', Dehaze: 'Dehaze', PostCropVignetteAmount: 'Vignette', GrainAmount: 'Grain', Sharpness: 'Sharpening', SharpenRadius: 'Radius',
  SharpenDetail: 'Detail', LuminanceSmoothing: 'Noise', ColorNoiseReduction: 'Color noise', SplitToningShadowHue: 'Grade Shadows Hue', SplitToningShadowSaturation: 'Grade Shadows Sat',
  ColorGradeShadowLum: 'Grade Shadows Lum', ColorGradeMidtoneHue: 'Grade Midtones Hue', ColorGradeMidtoneSat: 'Grade Midtones Sat', ColorGradeMidtoneLum: 'Grade Midtones Lum',
  SplitToningHighlightHue: 'Grade Highlights Hue', SplitToningHighlightSaturation: 'Grade Highlights Sat', ColorGradeHighlightLum: 'Grade Highlights Lum', ColorGradeBlending: 'Blending', SplitToningBalance: 'Balance' });
for (const c of COLOURS) for (const [theirs, ours] of [['Hue', 'Hue'], ['Saturation', 'Sat'], ['Luminance', 'Lum']]) PLAIN[`${theirs}Adjustment${c}`] = `Mix ${c} ${ours}`;
const CURVES = /** @type {const} */ ([['ToneCurvePV2012', 'RGB'], ['ToneCurvePV2012Red', 'R'], ['ToneCurvePV2012Green', 'G'], ['ToneCurvePV2012Blue', 'B']]);

/** The preset as a look: its name, the edit it stands for, how many of its settings were laid on, and how many it
 * holds that this editor has no control for. Null when the file is not a preset or holds nothing known.
 * @param {string} xml @param {string} [file] its name, for a preset that gives none */
export function lookOfXmp(xml, file = '') {
  const p = presetOfXmp(xml, file);
  if (!p) return null;
  const r = /** @type {Record<string, unknown>} */ (p.recipe), values = /** @type {Record<string, number>} */ ({});
  for (const [theirs, ours] of Object.entries(PLAIN)) { const v = r[theirs]; if (typeof v === 'number' && Number.isFinite(v)) values[ours] = v; }
  let curve = /** @type {import('../../engine/grade.js').Curves | null} */ (null), curves = 0;
  for (const [theirs, ours] of CURVES) {
    const pts = r[theirs];
    if (!Array.isArray(pts) || pts.length < 2) continue;
    curve ??= { RGB: [[0, 0], [1, 1]], R: [[0, 0], [1, 1]], G: [[0, 0], [1, 1]], B: [[0, 0], [1, 1]] };
    curve[ours] = pts.map((q) => [Number(q[0]) / 255, Number(q[1]) / 255]);
    curves++;
  }
  const used = Object.keys(values).length + curves;
  if (!used) return null;
  // no profile of its own: wearing it keeps the photo's (session.js `worn`)
  const st = /** @type {import('./past.js').State} */ (/** @type {unknown} */ ({ values, wb: 'As shot', curve }));
  return { name: p.name, st, used, left: Math.max(0, p.used - used) + p.skipped };
}

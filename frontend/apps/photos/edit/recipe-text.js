// @ts-check
// A camera recipe pasted as text (PHOTOS.md, Looks: the recipe table): the usual block of lines
// ("Film Simulation: Classic Chrome", "Highlight: -1", "Grain Effect: Weak, Small", "White Balance:
// Daylight, +2 Red & -4 Blue"), read in any case and order, with the short names (WB, NR, CCE, CCFXB).
// Each setting maps onto our recipe by the table below; the film simulation is kept as a name, not
// rendered (a black and white one sets B&W), until the camera's own looks are learned. Unknown lines
// are counted, never guessed.
import { WB_REF } from './looks-apply.js';

/** @typedef {import('./fields.js').Recipe} Recipe */
/** @typedef {import('../copied.js').Panel} Panel */
/** @typedef {{ recipe: Recipe, panels: Panel[], film: string | null, used: string[], skipped: number }} Parsed */

/** The table (PHOTOS.md): one step of each camera setting in our units. */
export const RECIPE_SCALE = {
  highlight: 15, // Highlights2012 per step (+ harder, brighter highlights)
  shadow: -15, // Shadows2012 per step (+ harder, deeper shadows)
  dr: { 100: 0, 200: -10, 400: -20 }, // Highlights2012 added: a wider range holds the highlights back
  color: 10, // Saturation per step
  sharpness: [40, 10], // Sharpness = 40 + 10 a step
  nr: [20, 5], // LuminanceSmoothing = 20 + 5 a step
  clarity: 10, // Clarity2012 per step
  grain: { off: 0, weak: 25, strong: 50 }, // GrainAmount
  grainSize: { small: 25, large: 50 }, // GrainSize
  wbMired: 2.5, // mired warmer per step of red over blue
  wbTint: 3, // Tint per step of red and blue together (+ magenta)
  kelvin: { daylight: 5500, auto: 5500, shade: 7500 }, // named white balance, read against 5,500 K
};
/** Colour chrome: the deep colours darkened and a touch less saturated, per strength. */
const CHROME = { weak: [-5, -3], strong: [-10, -6] };
const CHROME_HUES = ['Red', 'Orange', 'Yellow', 'Green', 'Magenta'];
const FX_BLUE = { weak: [-6, -3], strong: [-12, -6] };
const MONO = /acros|monochrome|black|b\s*&\s*w|sepia/i;

const KEYS = /** @type {[RegExp, string][]} */ ([
  [/^(film\s*sim(ulation)?|simulation|film|fs)$/, 'film'],
  [/^(dynamic\s*range|dr)$/, 'dr'],
  [/^(highlights?(\s*tone)?|h)$/, 'highlight'],
  [/^(shadows?(\s*tone)?|s)$/, 'shadow'],
  [/^(colou?r|saturation)$/, 'color'],
  [/^(sharpness|sharpening|sharp)$/, 'sharpness'],
  [/^((high\s*iso\s*)?(noise\s*reduction|nr))$/, 'nr'],
  [/^clarity$/, 'clarity'],
  [/^(grain(\s*effect)?)$/, 'grain'],
  [/^(grain\s*size)$/, 'grainSize'],
  [/^(colou?r\s*chrome(\s*effect)?|cce|cc)$/, 'chrome'],
  [/^(colou?r\s*chrome\s*(fx|effect)\s*blue|cc\s*fx\s*b(lue)?|ccfxb|ccb|fx\s*blue)$/, 'fxBlue'],
  [/^(white\s*balance|wb)$/, 'wb'],
  [/^(wb\s*shift|shift)$/, 'shift'],
]);

const num = (/** @type {string} */ s) => { const m = s.replace(/[−–]/g, '-').match(/[+-]?\d+(\.\d+)?/); return m ? Number(m[0]) : null; };
const clamp = (/** @type {number} */ v, /** @type {number} */ lo, /** @type {number} */ hi) => Math.min(hi, Math.max(lo, v));
const strength = (/** @type {string} */ s) => (/strong|high/i.test(s) ? 'strong' : /weak|low/i.test(s) ? 'weak' : 'off');

/** Red and blue shift from "+2 Red & -4 Blue", "R+2 B-4" or "+2R, -4B". @param {string} s */
function shiftOf(s) {
  const t = s.replace(/[−–]/g, '-');
  // The letter first ("R+1 B-3", "Red: +2, Blue: -4") or the number first ("+2 Red & -4 Blue", "+2R -4B").
  const lead = /\b(r|red|b|blue)\s*:?\s*[+-]?\d/i.test(t);
  const of = (/** @type {string} */ c, /** @type {string} */ rest) => t.match(lead ? new RegExp(`\\b${c}(?:${rest})?\\s*:?\\s*([+-]?\\d+)`, 'i') : new RegExp(`([+-]?\\d+)\\s*${c}(?:${rest})?\\b`, 'i'));
  const r = of('r', 'ed'), b = of('b', 'lue');
  if (!r && !b) return null;
  return { r: clamp(Number(r?.[1] ?? 0), -9, 9), b: clamp(Number(b?.[1] ?? 0), -9, 9) };
}

/** The text of a recipe to a look's recipe; null when no line is a setting we read. @param {string} text @returns {Parsed | null} */
export function recipeOfText(text) {
  /** @type {Record<string, any>} */
  const r = {};
  /** @type {string[]} */
  const used = [];
  let skipped = 0, film = /** @type {string | null} */ (null), highlight = 0, dr = 0, kelvin = /** @type {number | null} */ (null), shift = /** @type {{ r: number, b: number } | null} */ (null);
  for (const line of text.split(/\r?\n/)) {
    const m = line.replace(/^[\s•*·-]+/, '').match(/^([^:=]{1,40})[:=]\s*(.+)$/);
    if (!m) { if (line.trim()) skipped++; continue; }
    const label = m[1].trim().toLowerCase().replace(/\s+/g, ' '), v = m[2].trim();
    const key = KEYS.find(([re]) => re.test(label))?.[1];
    const n = num(v);
    if (key === 'film') { film = v.replace(/\s+/g, ' ').slice(0, 40); if (MONO.test(v)) r.ConvertToGrayscale = true; }
    else if (key === 'dr') dr = RECIPE_SCALE.dr[/** @type {100|200|400} */ (n ?? 100)] ?? 0;
    else if (key === 'highlight' && n !== null) highlight = clamp(n, -2, 4) * RECIPE_SCALE.highlight;
    else if (key === 'shadow' && n !== null) r.Shadows2012 = clamp(n, -2, 4) * RECIPE_SCALE.shadow;
    else if (key === 'color' && n !== null) r.Saturation = clamp(n, -4, 4) * RECIPE_SCALE.color;
    else if (key === 'sharpness' && n !== null) r.Sharpness = RECIPE_SCALE.sharpness[0] + clamp(n, -4, 4) * RECIPE_SCALE.sharpness[1];
    else if (key === 'nr' && n !== null) r.LuminanceSmoothing = RECIPE_SCALE.nr[0] + clamp(n, -4, 4) * RECIPE_SCALE.nr[1];
    else if (key === 'clarity' && n !== null) r.Clarity2012 = clamp(n, -5, 5) * RECIPE_SCALE.clarity;
    else if (key === 'grain') {
      r.GrainAmount = RECIPE_SCALE.grain[strength(v)];
      if (/large|big|coarse/i.test(v)) r.GrainSize = RECIPE_SCALE.grainSize.large;
      else if (/small|fine/i.test(v)) r.GrainSize = RECIPE_SCALE.grainSize.small;
    } else if (key === 'grainSize') r.GrainSize = /large|big/i.test(v) ? RECIPE_SCALE.grainSize.large : RECIPE_SCALE.grainSize.small;
    else if (key === 'chrome' || key === 'fxBlue') {
      const s = strength(v);
      if (s === 'off') { used.push(key); continue; }
      const [lum, sat] = (key === 'chrome' ? CHROME : FX_BLUE)[s];
      for (const h of key === 'chrome' ? CHROME_HUES : ['Blue', 'Aqua']) {
        const k = key === 'fxBlue' && h === 'Aqua' ? 0.5 : 1;
        r[`LuminanceAdjustment${h}`] = (r[`LuminanceAdjustment${h}`] ?? 0) + lum * k;
        r[`SaturationAdjustment${h}`] = (r[`SaturationAdjustment${h}`] ?? 0) + sat * k;
      }
    } else if (key === 'wb') {
      const named = Object.entries(RECIPE_SCALE.kelvin).find(([w]) => v.toLowerCase().includes(w))?.[1];
      const k = v.match(/(\d{4,5})\s*k\b/i);
      kelvin = k ? clamp(Number(k[1]), 2500, 10000) : (named ?? null);
      shift = shiftOf(v.replace(/\d{4,5}\s*k\b/i, '')) ?? shift;
      if (kelvin === null && !shift) { skipped++; continue; }
    } else if (key === 'shift') { shift = shiftOf(v); if (!shift) { skipped++; continue; } }
    else { skipped++; continue; }
    used.push(key);
  }
  if (highlight || dr) r.Highlights2012 = clamp(highlight + dr, -100, 100);
  if (kelvin !== null || shift) {
    // Relative to 5,500 K (looks-apply.js): the named or kelvin setting, then red over blue warmer.
    const m = 1e6 / (kelvin ?? WB_REF) - (shift ? (shift.r - shift.b) * RECIPE_SCALE.wbMired : 0);
    r.WhiteBalance = 'Custom';
    r.Temperature = Math.round(clamp(1e6 / m, 2000, 50000));
    r.Tint = shift ? clamp((shift.r + shift.b) * RECIPE_SCALE.wbTint, -150, 150) : 0;
  }
  const lo = (/** @type {string} */ k) => (k === 'Sharpness' || k.startsWith('Grain') || k === 'LuminanceSmoothing' ? 0 : -100);
  for (const k of Object.keys(r)) if (typeof r[k] === 'number' && k !== 'Temperature' && k !== 'Tint') r[k] = Math.round(clamp(r[k], lo(k), k === 'Sharpness' ? 150 : 100) * 100) / 100;
  if (!used.length) return null;
  const panels = /** @type {Panel[]} */ (['light', 'color', 'effects', 'detail']);
  return { recipe: /** @type {Recipe} */ (r), panels, film, used, skipped };
}

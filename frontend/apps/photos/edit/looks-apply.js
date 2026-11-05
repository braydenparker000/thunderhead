// @ts-check
// A look on a photo (PHOTOS.md, Looks): the photo keeps its keys outside the look's panels and takes the
// look's inside them, as a paste does, with two differences. White balance is relative: a look's
// Temperature reads against 5,500 K and its Tint against 0, so the photo's own white balance (as shot,
// or as set) moves by that much in mired; a look with none leaves the photo's. And Amount (0–200 %)
// scales every number's way from the photo's value to the look's: 0 is the photo as it was, 100 % the
// look, 200 % twice its change, held inside each range. A switch, a hue and a white balance mode take
// the look's at any amount above 0; a curve moves point by point.
import { PANEL_KEYS, pick } from '../copied.js';
import { CURVES, NUMBERS, withValue } from './fields.js';

/** The white balance a look's Temperature reads against (shared/contract/photos-looks.ts LOOK_WB_REFERENCE). */
export const WB_REF = 5500;
const WB = ['WhiteBalance', 'Temperature', 'Tint'];
const HUE_KEYS = ['SplitToningShadowHue', 'ColorGradeMidtoneHue', 'SplitToningHighlightHue'];
const mired = (/** @type {number} */ k) => 1e6 / k;
const clamp = (/** @type {number} */ v, /** @type {number} */ lo, /** @type {number} */ hi) => Math.min(hi, Math.max(lo, v));

/** @typedef {import('./fields.js').Recipe} Recipe */
/** @typedef {import('../copied.js').Panel} Panel */
/** @typedef {{ recipe: Recipe, panels: Panel[] }} Look */
/** @typedef {{ temperature: number, tint: number }} Shot */

/** A value rounded as its slider steps: whole numbers on the ±100 scales, hundredths below. @param {string} k @param {number} v */
const stepped = (k, v) => { const [lo, hi] = NUMBERS[k]; return hi - lo >= 100 ? Math.round(v) : Math.round(v * 100) / 100; };

/** A curve's output at `x` (straight between points; the identity when there is none). @param {number[][] | undefined} c @param {number} x */
function at(c, x) {
  if (!c?.length) return x;
  for (let i = 1; i < c.length; i++) {
    const [x0, y0] = c[i - 1], [x1, y1] = c[i];
    if (x <= x1) return x1 === x0 ? y1 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return c[c.length - 1][1];
}

/** Two curves blended at `a`, on the points of both (the look's alone past 16). @param {number[][] | undefined} from @param {number[][] | undefined} to @param {number} a */
function blend(from, to, a) {
  const xs = [...new Set([0, 255, ...(from ?? []).map((p) => p[0]), ...(to ?? []).map((p) => p[0])])].sort((p, q) => p - q);
  const use = xs.length > 16 ? [...new Set([0, 255, ...(to ?? []).map((p) => p[0])])].sort((p, q) => p - q) : xs;
  return use.map((x) => { const b = at(from, x); return [x, Math.round(clamp(b + a * (at(to, x) - b), 0, 255))]; });
}

/** Where `r` stands on white balance: its own when Custom, else the file's. @param {Recipe} r @param {Shot} shot */
const wbOf = (r, shot) => (r.WhiteBalance === 'Custom' ? { t: r.Temperature ?? shot.temperature, tint: r.Tint ?? shot.tint } : { t: shot.temperature, tint: shot.tint });

/** `base` with `look` applied at `amount` (1 is 100 %). @param {Recipe} base @param {Look} look @param {Shot} shot @param {number} [amount] @returns {Recipe} */
export function lookOnto(base, look, shot, amount = 1) {
  const b = /** @type {Record<string, any>} */ (base), l = /** @type {Record<string, any>} */ (look.recipe);
  let out = base;
  for (const k of look.panels.flatMap((p) => PANEL_KEYS[p])) {
    if (WB.includes(k)) continue;
    let v;
    if (amount <= 0) v = b[k];
    else if (CURVES.includes(k)) v = b[k] || l[k] ? blend(b[k], l[k], amount) : undefined;
    else if (NUMBERS[k] && !HUE_KEYS.includes(k)) {
      const [lo, hi, def] = NUMBERS[k], from = b[k] ?? def;
      v = stepped(k, clamp(from + amount * ((l[k] ?? def) - from), lo, hi));
    } else v = l[k];
    out = withValue(out, k, v);
  }
  if (!look.panels.includes('color') || !l.WhiteBalance || amount <= 0) return out;
  if (l.WhiteBalance !== 'Custom') return withValue(withValue(withValue(out, 'WhiteBalance', l.WhiteBalance), 'Temperature', undefined), 'Tint', undefined);
  const now = wbOf(base, shot);
  const m = mired(now.t) - amount * (mired(WB_REF) - mired(l.Temperature ?? WB_REF));
  const t = Math.round(clamp(1e6 / Math.max(m, 20), 2000, 50000)), tint = Math.round(clamp(now.tint + amount * (l.Tint ?? 0), -150, 150));
  return withValue(withValue(withValue(out, 'WhiteBalance', 'Custom'), 'Temperature', t), 'Tint', tint);
}

/** A look from the current edit: its keys in `panels`, white balance made relative to the file's. @param {Recipe} r @param {Panel[]} panels @param {Shot} shot */
export function lookOf(r, panels, shot) {
  let out = pick(r, panels);
  if (!panels.includes('color') || r.WhiteBalance !== 'Custom') return /** @type {Recipe} */ (Object.fromEntries(Object.entries(out).filter(([k]) => k !== 'Temperature' && k !== 'Tint')));
  const now = wbOf(r, shot);
  const t = 1e6 / clamp(mired(WB_REF) - (mired(shot.temperature) - mired(now.t)), 20, 500);
  out = withValue(withValue(out, 'Temperature', Math.round(clamp(t, 2000, 50000))), 'Tint', Math.round(clamp(now.tint - shot.tint, -150, 150)));
  return out;
}

/** A short hash of a look's panels and recipe, for its thumbnail's cache. @param {Look} look */
export function lookHash(look) {
  let h = 0x811c9dc5;
  for (const c of JSON.stringify([look.panels, look.recipe])) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0;
  return h.toString(36);
}

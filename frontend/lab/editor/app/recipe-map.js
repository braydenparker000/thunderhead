// @ts-check
// A Fujifilm film simulation recipe (the camera's own JPEG settings, as Fuji X Weekly publishes them) laid on this
// editor's controls. A recipe is made for the camera's JPEG engine; here it is worn by a RAF, so each setting is
// read as the nearest thing this editor has: the film simulation is the profile of that name, the tone and colour
// settings are the Light and Color dials, and so on. The strengths are first guesses, set where each dial's own
// range puts the camera's steps; they are to be measured against the camera's JPEGs. What has no near thing here
// is handed back in `left`, to be said to the owner and built if it matters. Nothing here touches the page or the
// photo: recipes.js does that.

/** A recipe's film simulation as the site writes it, and the profile's label (engine/profiles.js). */
const FILMS = /** @type {[RegExp, string][]} */ ([
  [/bleach\s*bypass/i, 'BLEACH BYPASS'], [/eterna/i, 'ETERNA'], [/classic\s*chrome/i, 'CLASSIC CHROME'], [/reala/i, 'REALA ACE'],
  [/nostalgic/i, 'NOSTALGIC Neg'], [/classic\s*neg/i, 'CLASSIC Neg'], [/pro\s*neg\.?\s*hi/i, 'Pro Neg Hi'], [/pro\s*neg\.?\s*st/i, 'Pro Neg Std'],
  [/velvia/i, 'Velvia'], [/astia/i, 'ASTIA'], [/acros/i, 'ACROS'], [/monochrome/i, 'Monochrome'], [/sepia/i, 'Sepia'], [/provia/i, 'PROVIA'],
]);
/** The profile label a recipe's film simulation stands for, or '' for one this does not know. @param {string} film */
export const filmLabel = (film) => FILMS.find(([re]) => re.test(film || ''))?.[1] || '';
/** The one black-and-white colour filter a film simulation names ('R', 'Y' or 'G'), or '' for none or a choice of them. @param {string} film */
const filterOf = (film) => { const f = [...(film || '').matchAll(/\+\s*(r|ye?|g)\b/gi)].map((m) => m[1][0].toUpperCase()); return f.length === 1 ? f[0] : ''; };
/** Which of a photo's profiles a recipe's film simulation is: the one of its family (whatever else its label says:
 * "PROVIA/Standard", "ETERNA BLEACH BYPASS"), with the recipe's colour filter where there is such a profile, else
 * the plain one. −1 for none. @param {string} film @param {string[]} labels the profiles' labels */
export function profileFor(film, labels) {
  const want = filmLabel(film), filter = filterOf(film), fam = labels.map((l, i) => ({ l, i })).filter((e) => want && filmLabel(e.l) === want);
  const plain = fam.filter((e) => !/\+/.test(e.l)).sort((a, b) => a.l.length - b.l.length)[0], filtered = filter ? fam.find((e) => filterOf(e.l) === filter) : null;
  return (filtered || plain || fam[0])?.i ?? -1;
}

// One of the camera's steps on each of our dials. First guesses (see the top).
const TONE = 12, EDGE = 4;       // Highlight and Shadow tone: Highlights/Shadows, and a third as much on Whites/Blacks
const DR = { 200: -10, 400: -20 };   // DR200 and DR400 hold the highlights back: a softer shoulder
const DRP = /** @type {Record<string, [number, number]>} */ ({ weak: [-20, 15], auto: [-20, 15], strong: [-35, 25] });   // D-Range Priority: the camera's own highlights and shadows, in place of the two tones
const COLOR = 6, SHARP = 8, NR = 5, CLARITY = 8;
const GRAIN = { Weak: 18, Strong: 36 }, SIZE = { Small: 25, Large: 60 };   // Grain, and Grain size (Small is where it starts)
const CHROME = { Weak: 50, Strong: 100 };   // Color Chrome Effect and FX Blue: Chrome and Chrome Blue
/** Black-and-white toning (Monochromatic Color: warm/cool and magenta/green, −18..18 each) as grading's hue and
 * saturation: warm is 40 degrees on its wheel, green 130, cool 220 and magenta 310, a quarter turn apart, so the
 * setting's direction is the hue; its length 2.5 times is the saturation, to 45 at most. @param {number} wc @param {number} mg */
export const toning = (wc, mg) => ({ hue: Math.round((((40 + (Math.atan2(-mg, wc) * 180) / Math.PI) % 360) + 360) % 360), sat: Math.round(Math.min(45, 2.5 * Math.hypot(wc, mg))) });
const MIRED = 3.5, TINT = 1.5;   // a step of the white balance shift: warmer by red less blue, towards magenta by their sum
/** The camera's white balance settings as a colour temperature and tint here. */
const LIGHT = /** @type {Record<string, [number, number]>} */ ({ daylight: [5500, 10], shade: [7500, 10], incandescent: [2850, 0], 'fluorescent 1': [6300, 25], 'fluorescent 2': [4800, 25], 'fluorescent 3': [4200, 25] });
const clamp = (/** @type {number} */ v, /** @type {number} */ lo, /** @type {number} */ hi) => Math.min(hi, Math.max(lo, v)) || 0;

/** @typedef {{ filmSimulation?: string, dynamicRange?: string | number, grain?: { strength?: string, size?: string | null }, colorChrome?: string, colorChromeBlue?: string,
 *   whiteBalance?: { mode?: string, kelvin?: number | null, red?: number, blue?: number }, highlight?: number, shadow?: number, color?: number, sharpness?: number,
 *   dRangePriority?: string | null, noiseReduction?: number, clarity?: number, exposureCompensation?: { min: number, max: number } | null, monochromatic?: { wc: number, mg: number } | null }} Recipe */

/** A recipe as an edit for a photo: the dials it sets, the white balance, the profile to look for, and what of it
 * is not replicated here.
 * @param {Recipe} r @param {{ shotWb: [number, number], noise0?: number }} shot the photo's white balance as shot
 *   (kelvin, tint) and the noise reduction its ISO starts with
 * @returns {{ values: Record<string, number>, wb: string, film: string, left: string[] }} */
export function edit(r, shot) {
  const values = /** @type {Record<string, number>} */ ({}), left = [], n = (/** @type {unknown} */ v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const dr = DR[/** @type {200 | 400} */ (Number(String(r.dynamicRange ?? '').replace(/\D/g, '')))] || 0;
  const drp = DRP[String(r.dRangePriority || '').toLowerCase().replace(/[^a-z]/g, '')] || null;
  values.Highlights = clamp(drp ? drp[0] : TONE * n(r.highlight) + dr, -100, 100); values.Whites = clamp(drp ? 0 : EDGE * n(r.highlight), -100, 100);
  values.Shadows = clamp(drp ? drp[1] : -TONE * n(r.shadow), -100, 100); values.Blacks = clamp(drp ? 0 : -EDGE * n(r.shadow), -100, 100);
  values.Saturation = clamp(COLOR * n(r.color), -100, 100);
  values.Sharpening = clamp(40 + SHARP * n(r.sharpness), 0, 100);
  values.Noise = clamp((shot.noise0 || 0) + NR * n(r.noiseReduction), 0, 100);
  values.Clarity = clamp(CLARITY * n(r.clarity), -100, 100);
  const g = r.grain || {}, grain = GRAIN[/** @type {'Weak' | 'Strong'} */ (g.strength || '')] || 0;
  values.Grain = grain; values['Grain size'] = grain && g.size === 'Large' ? SIZE.Large : SIZE.Small;
  values.Chrome = CHROME[/** @type {'Weak' | 'Strong'} */ (r.colorChrome || '')] || 0; values['Chrome Blue'] = CHROME[/** @type {'Weak' | 'Strong'} */ (r.colorChromeBlue || '')] || 0;
  const mono = r.monochromatic, tone = mono && (n(mono.wc) || n(mono.mg)) ? toning(n(mono.wc), n(mono.mg)) : null;   // the same tint on every range of grading
  if (tone) for (const z of ['Shadows', 'Midtones', 'Highlights', 'Global']) { values[`Grade ${z} Hue`] = tone.hue; values[`Grade ${z} Sat`] = tone.sat; }
  // white balance: where the recipe sets a light or a temperature, that; else the shot's own; then the shift
  const w = r.whiteBalance || {}, mode = String(w.mode || '').toLowerCase(), red = n(w.red), blue = n(w.blue);
  const base = w.kelvin ? /** @type {[number, number]} */ ([w.kelvin, w.kelvin >= 4000 ? 10 : Math.max(0, (10 * (w.kelvin - 2850)) / 1150)]) : LIGHT[mode] || shot.shotWb;
  const set = base !== shot.shotWb, moved = red !== 0 || blue !== 0;
  if (set || moved) {
    values.Temp = clamp(Math.round(1e6 / (1e6 / base[0] - MIRED * (red - blue)) / 50) * 50, 2000, 15000);
    values.Tint = clamp(Math.round(base[1] + TINT * (red + blue)), -150, 150);
  }
  // said, not hidden: what is only near, and what is not here at all
  if (drp) left.push(`D-Range Priority ${r.dRangePriority}: only as held highlights and lifted shadows`);
  if (dr && !drp) left.push(`Dynamic Range ${r.dynamicRange}: only as gentler highlights (the camera does it at the shot)`);
  if (/\+\s*(r|ye?|g)\b/i.test(r.filmSimulation || '')) left.push('The black-and-white colour filter: only where there is a profile with it');
  if (r.exposureCompensation && (r.exposureCompensation.min || r.exposureCompensation.max)) left.push('Exposure compensation: a shooting note, not applied');
  if (/underwater|ambience|white priority/i.test(mode)) left.push(`White balance ${w.mode}: as the shot's own`);
  return { values, wb: set || moved ? 'Custom' : 'As shot', film: filmLabel(r.filmSimulation || ''), left };
}

/** The list as its file packs it (one row a recipe, in the order of `cols`; tables for the sensors and the film
 * simulations) opened out: each recipe with its own id, its group and its settings.
 * @param {{ sensors: string[], films: string[], cols: string[], rows: unknown[][] }} doc
 * @returns {{ id: string, name: string, sensor: string, camera: string, page: string, set: Recipe }[]} */
export function unpack(doc) {
  const at = /** @type {Record<string, number>} */ (Object.fromEntries(doc.cols.map((c, i) => [c, i]))), seen = new Set();
  return doc.rows.map((row) => {
    const v = (/** @type {string} */ c) => /** @type {any} */ (row[at[c]] ?? null), sensor = doc.sensors[v('sensor')] || 'Other', name = String(v('name'));
    let id = `${sensor} ${name}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    while (seen.has(id)) id += '-2';
    seen.add(id);
    return { id, name, sensor, camera: v('camera') || '', page: v('page') || '', set: { filmSimulation: doc.films[v('film')] || '', dynamicRange: v('dynamicRange') ?? undefined, dRangePriority: v('dRangePriority'),
      grain: v('grain') ? { strength: v('grain'), size: v('grainSize') } : undefined, colorChrome: v('colorChrome') ?? undefined, colorChromeBlue: v('colorChromeBlue') ?? undefined,
      whiteBalance: v('wb') || v('red') !== null ? { mode: v('wb') || '', kelvin: v('kelvin'), red: v('red') || 0, blue: v('blue') || 0 } : undefined,
      highlight: v('highlight') ?? undefined, shadow: v('shadow') ?? undefined, color: v('color') ?? undefined, sharpness: v('sharpness') ?? undefined, noiseReduction: v('noiseReduction') ?? undefined, clarity: v('clarity') ?? undefined,
      exposureCompensation: v('evMin') !== null || v('evMax') !== null ? { min: v('evMin') || 0, max: v('evMax') || 0 } : null, monochromatic: v('wc') !== null || v('mg') !== null ? { wc: v('wc') || 0, mg: v('mg') || 0 } : null } };
  });
}

// @ts-check
// The Weekly Fuji recipes on the Looks board: Fujifilm film simulation recipes as Fuji X Weekly (Ritchie Roesch,
// fujixweekly.com) publishes them, each a set of the camera's own JPEG settings. The list is a file of this site
// (assets/weekly-fuji-recipes.json: each recipe's name, its settings and the page it comes from; none of the
// site's words or pictures), read the first time the card is opened. A recipe is worn the way a look is: it takes
// the place of the photo's look (profile, tone, colour, detail, grain, white balance) and leaves what is the
// photo's own (exposure, crop, lens corrections, masks, spots). recipe-map.js says which dial each setting lands on.
import * as photo from './session.js';
import { edit } from './recipe-map.js';

const FILE = '/lab/editor/assets/weekly-fuji-recipes.json';
/** @typedef {{ id: string, name: string, url: string, sensor: string, camera?: string, set: import('./recipe-map.js').Recipe }} Kept */
let all = /** @type {Kept[]} */ ([]), asked = /** @type {Promise<Kept[]> | null} */ (null);
/** Reads the list once; a failure may be asked again. */
export const load = () => (asked ||= fetch(FILE).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`the list did not come (${r.status})`))))
  .then((d) => (all = /** @type {Kept[]} */ (d.recipes)), (e) => { asked = null; throw e; }));
/** The recipes read so far (none before `load`). */
export const list = () => all;
/** The sensors' groups in the order the card shows them, each with how many it holds. */
export const groups = () => { const n = /** @type {Map<string, number>} */ (new Map()); for (const r of all) n.set(r.sensor, (n.get(r.sensor) || 0) + 1); return [...n].map(([sensor, count]) => ({ sensor, count })); };

// The dials a recipe takes over: each goes back to its start, then the recipe's own are set.
const LOOK = new Set(['Contrast', 'Highlights', 'Shadows', 'Whites', 'Blacks', 'Vibrance', 'Saturation', 'Texture', 'Clarity', 'Dehaze', 'Vignette', 'Grain', 'Sharpening', 'Noise', 'Blending', 'Balance']);

/** The open photo's edit wearing a recipe, and what of the recipe is not replicated here.
 * @param {Kept} r @returns {{ st: import('./past.js').State, film: string, left: string[] }} */
export function worn(r) {
  const now = photo.state(), e = edit(r.set, { shotWb: /** @type {[number, number]} */ (photo.shotWb()), noise0: photo.current()?.noise0 || 0 }), v = { ...now.values };
  for (const k of Object.keys(photo.ZERO)) if (LOOK.has(k) || /^(Mix|Grade) /.test(k)) v[k] = photo.ZERO[k];
  Object.assign(v, e.values);
  const looks = photo.looks(), up = e.film.toUpperCase(), prof = e.film ? looks.find((l) => l.label.toUpperCase() === up) || looks.find((l) => !l.table && l.label.toUpperCase().startsWith(up)) : null;
  const left = e.left.concat(prof ? [] : [`${r.set.filmSimulation || 'The film simulation'}: no profile of that name here, the photo's own is kept`]);
  return { st: { ...now, values: v, wb: e.wb, profile: prof?.id ?? now.profile, curve: null, cube: '' }, film: prof?.label || '', left };
}
/** Puts a recipe on the open photo, a step of its history. @param {Kept} r @returns {string[]} what is not replicated */
export function wear(r) { const w = worn(r); photo.lay(w.st, `Recipe · ${r.name}`); return w.left; }

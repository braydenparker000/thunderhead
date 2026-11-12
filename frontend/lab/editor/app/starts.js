// @ts-check
// A starting look for each camera and lens (engine/raw/ROADMAP.md stage 2): the owner sets a photo as they want
// every photo from that camera with that lens to begin, and keeps it as the start. A photo opened for the first
// time then begins there: its sharpening, colour noise, lens corrections by hand, profile, curve, everything but
// what is each photo's own (its Exposure, its white balance, and Noise, which goes by its ISO). It is where the
// photo starts, not an edit: the photo's history begins with it and Reset goes back to it. Kept on this phone.

const KEY = 'th.editor.starts', OWN = ['Exposure', 'Temp', 'Tint', 'Noise'];
/** @typedef {{ values: Record<string, number>, profile: string, curve: any, cube: string }} Start */
/** @typedef {import('./store.js').Photo['shot']} Shot */

const all = () => { try { const a = JSON.parse(localStorage.getItem(KEY) || '{}'); return a && typeof a === 'object' ? /** @type {Record<string, Start>} */ (a) : {}; } catch { return {}; } };
const keyOf = (/** @type {Shot} */ s) => `${s?.camera || ''}|${s?.lens || ''}`;
/** Whether a start can be kept for this photo (its Exif names its camera), and what it would be kept for. @param {Shot} s */
export const forWhat = (s) => (s?.camera ? [s.camera, s.lens].filter(Boolean).join(' · ') : '');
/** The start kept for a photo's camera and lens, or null. @param {Shot} s */
export const startFor = (s) => (s?.camera && all()[keyOf(s)]) || null;
/** Keeps an edit as the start for the camera and lens of this shot. @param {Shot} s @param {import('./past.js').State} st */
export function keepStart(s, st) {
  if (!s?.camera) return false;
  const values = { ...st.values }; for (const k of OWN) delete values[k];
  try { localStorage.setItem(KEY, JSON.stringify({ ...all(), [keyOf(s)]: { values, profile: st.profile || '', curve: st.curve || null, cube: st.cube || '' } })); return true; } catch { return false; }
}
/** @param {Shot} s */
export function dropStart(s) { const a = all(); delete a[keyOf(s)]; try { localStorage.setItem(KEY, JSON.stringify(a)); } catch { /* nothing was kept */ } }

/** Gives a photo being opened where it starts: one not opened before takes the start kept for its camera and
 * lens, into its values and into every step of its (new) history; one opened before keeps the start it was given
 * then, which its saved edit holds. `me.start` is what Reset goes back to.
 * @param {{ values: Record<string, number>, profile: string, curve: any, cube: string, start?: Record<string, number> }} me
 * @param {import('./past.js').Past | null} past @param {Shot | null} shot the photo's, when it was not opened before @param {any} edit its saved edit */
export function begin(me, past, shot, edit) {
  if (!shot) { if (edit?.start0 && typeof edit.start0 === 'object') me.start = edit.start0; return; }
  const s = startFor(shot);
  if (!s) return;
  const lay = (/** @type {{ values: Record<string, number>, profile: string, curve?: any, cube?: string }} */ to) => { Object.assign(to.values, s.values); if (s.profile) to.profile = s.profile; to.curve = s.curve || null; to.cube = s.cube || ''; };
  lay(me); me.start = s.values;
  for (const st of past?.steps || []) lay(st.st);
}

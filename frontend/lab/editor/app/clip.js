// @ts-check
// An edit copied from one photo and pasted on others (engine/raw/ROADMAP.md stage 4): the way a series shot in
// one light is edited once. Copy takes the open photo's edit; Paste lays it on the open photo as a step of its
// history; the Library pastes it on every photo it is showing. What goes across is what belongs to the look of the
// picture: every adjustment (exposure and white balance too: a series shares them), the profile, the point curve
// and a `.cube` look. What belongs to where the picture is stays the photo's own: its crop, its retouched spots
// and its masks. The copied edit is kept on this phone until another is copied.
import * as hist from './past.js';
import * as photo from './session.js';

const KEY = 'th.editor.clip';
/** @typedef {{ name: string, st: Pick<hist.State, 'values' | 'wb' | 'profile' | 'curve' | 'cube'> }} Clip the photo it came from, and the edit */

/** The copied edit, if there is one. @returns {Clip | null} */
export function held() {
  try { const c = JSON.parse(localStorage.getItem(KEY) || 'null'); return c && typeof c.name === 'string' && c.st?.values && typeof c.st.wb === 'string' ? c : null; } catch { return null; }
}
/** Copies the open photo's edit. */
export function copy() {
  const c = photo.current(), st = photo.state();
  if (!c) return null;
  const clip = /** @type {Clip} */ ({ name: c.name, st: { values: st.values, wb: st.wb, profile: st.profile, curve: st.curve || null, cube: st.cube || '' } });
  try { localStorage.setItem(KEY, JSON.stringify(clip)); } catch { return null; }   // a private window keeps nothing
  photo.changed();
  return clip;
}
/** The edit `now` with a copied one laid on it. @param {hist.State} now @param {Clip} clip @returns {hist.State} */
export const laid = (now, clip) => ({ ...now, values: { ...now.values, ...clip.st.values }, wb: clip.st.wb, profile: clip.st.profile, curve: clip.st.curve || null, cube: clip.st.cube || '' });
/** Pastes the copied edit on the open photo, a step of its history. False when there is nothing to paste, or it
 * would change nothing. */
export function paste() {
  const clip = held();
  if (!clip || !photo.current() || !photo.ready) return false;
  const now = photo.state(), next = laid(now, clip);
  if (hist.same(now, next)) return false;
  photo.lay(next, `Pasted · ${photo.stem(clip.name)}`);
  return true;
}
/** Pastes the copied edit on many photos, one after another: each is opened as it would be from the Library (but
 * for its full-size pixels), given the edit as a step of its own history, and saved with its tile. `step(k, n)`
 * after each. The photo that was open is opened again at the end. Returns how many took it and how many could
 * not be opened. @param {string[]} ids @param {(k: number, n: number) => void} step */
export async function pasteOn(ids, step) {
  const was = photo.current()?.id;
  let done = 0, bad = 0;
  for (const [k, id] of ids.entries()) {
    await photo.open(id, true);
    if (photo.current()?.id === id && photo.ready) { paste(); await photo.saveNow(); done++; } else bad++;
    step(k + 1, ids.length);
  }
  if (was && was !== photo.current()?.id) await photo.open(was);
  return { done, bad };
}

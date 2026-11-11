// @ts-check
// An edit copied from one photo and pasted on others (engine/raw/ROADMAP.md stage 4): the way a series shot in
// one light is edited once. Copy takes the open photo's edit; Paste lays it on the open photo as a step of its
// history; the Library pastes it on every photo it is showing. What goes across is what belongs to the look of the
// picture: every adjustment (exposure and white balance too: a series shares them), the profile, the point curve
// and a `.cube` look. What belongs to where the picture is stays the photo's own: its crop, its retouched spots
// and its masks. The copied edit is kept on this phone until another is copied.
import * as hist from './past.js';
import * as photo from './session.js';
import * as store from './store.js';

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

/** The light a shot gathered, as the camera set it (shutter time × ISO ÷ f-number squared); 0 when its Exif does not say. @param {store.Photo['shot']} s */
const gathered = (s) => (s?.time && s?.iso && s?.f ? (s.time * s.iso) / (s.f * s.f) : 0);
/** Evens a series out against the open photo (engine/raw/ROADMAP.md stage 4, "match a series"): each photo given
 * gets the open photo's white balance, and its Exposure set so that the two were, in all, exposed alike: the open
 * photo's Exposure, moved by the stops between how the camera shot the two. So a scene shot at changing shutter
 * speeds comes out as bright in every frame, and one white holds across it. A photo whose Exif does not say how
 * it was shot gets the white balance alone; one of another kind than the open photo (a JPEG beside a RAF, whose
 * numbers mean other things) is left as it is. A step of each photo's history. `step(k, n)` after each. Returns
 * how many were matched in full, how many in white balance only, and how many were left.
 * @param {string[]} ids @param {(k: number, n: number) => void} step */
export async function matchOn(ids, step) {
  const ref = photo.current(), of = (/** @type {string} */ id) => store.photos().find((p) => p.id === id);
  let done = 0, plain = 0, bad = 0;
  if (!ref || !photo.ready) return { done, plain, bad: ids.length };
  const was = ref.id, kind = of(was)?.kind, light = gathered(of(was)?.shot), ev = ref.values.Exposure, white = { Temp: ref.values.Temp, Tint: ref.values.Tint }, name = `Matched · ${photo.stem(ref.name)}`;
  for (const [k, id] of ids.entries()) {
    const p = of(id), mine = gathered(p?.shot);
    if (id !== was && p && p.kind === kind) {
      await photo.open(id, true);
      if (photo.current()?.id === id && photo.ready) {
        const now = photo.state(), next = { ...now, wb: 'Custom', values: { ...now.values, ...white, ...(light && mine ? { Exposure: Math.max(-5, Math.min(5, Math.round((ev + Math.log2(light / mine)) * 100) / 100)) } : {}) } };
        if (!hist.same(now, next)) photo.lay(next, name);
        await photo.saveNow();
        if (light && mine) done++; else plain++;
      } else bad++;
    } else if (id !== was) bad++;
    step(k + 1, ids.length);
  }
  if (was !== photo.current()?.id) await photo.open(was);
  return { done, plain, bad };
}

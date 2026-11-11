// @ts-check
// Edit, in the new editor (docs/design/EDITOR.md; the owner, 2026-11-10: it replaces the one before).
// The new editor works on RAFs kept on this phone and its page reaches nothing outside this site,
// so Photos, which may read the owner's Drive, fetches the original and hands it over: the RAF is
// copied once into the editor's own store (lab/editor/app/store.js) under `photos:<id>`, and the
// editor opens it straight in Edit. The next Edit on the same photo finds the copy, and the edit
// made on it, already there.
// The editor before (`?edit=`) still opens everything else: a JPEG, a HEIC or a DNG, a photo whose
// original is not in Drive yet, a phone that is offline, and any photo once the owner picks
// Classic (Settings → Photos → Editor).
import { pref } from '/th/pref.js';
import * as data from './data.js';
import { fetchOriginal } from './drive.js';

/** @typedef {import('./data.js').PhotoItem} PhotoItem */

/** Whether Edit on this photo opens the new editor. @param {PhotoItem | undefined} p */
export const inNewEditor = (p) => Boolean(p && p.format === 'raf' && p.drive_id && navigator.onLine !== false && pref('photos.editor') !== 'classic' && navigator.storage?.getDirectory);

/** Hands the photo over and goes to the editor. Throws when the original can't be had; the caller
 * then opens the editor before. @param {PhotoItem} p @param {(line: string) => void} say */
export async function openInEditor(p, say) {
  const store = await import('../../lab/editor/app/store.js');
  const source = `photos:${p.id}`;
  let id = await store.fromSource(source);
  if (!id) {
    say('Getting the original…');
    const token = await data.uploadToken();
    const blob = await fetchOriginal(token.access_token, /** @type {string} */ (p.drive_id));
    id = await store.addFrom(new File([blob], p.name, { lastModified: p.taken_at }), source);
  }
  location.assign(`/lab/editor/?open=${id}&from=photos`);
}

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
import { fetchOriginal, findByName } from './drive.js';

/** @typedef {import('./data.js').PhotoItem} PhotoItem */

/** Whether Edit on this photo opens the new editor. @param {PhotoItem | undefined} p */
export const inNewEditor = (p) => Boolean(p && p.format === 'raf' && p.drive_id && navigator.onLine !== false && pref('photos.editor') !== 'classic' && navigator.storage?.getDirectory);

/** The photo's edit as the editor backed it up to Drive (lab/editor/app/backup.js), or null. @param {string} token @param {string} photosId */
async function backedEdit(token, photosId) {
  const { mark, sideName } = await import('../../lab/editor/app/backup.js'), file = await findByName(token, sideName(photosId));
  if (!file) return null;
  const text = await (await fetchOriginal(token, file)).text(), b = JSON.parse(text);
  if (b?.v !== 1 || !b.edit || typeof b.edit !== 'object' || Array.isArray(b.edit)) return null;
  const flag = /** @type {'none' | 'pick' | 'reject'} */ (['pick', 'reject'].includes(b.flag) ? b.flag : 'none');
  return { edit: b.edit, rating: Math.max(0, Math.min(5, Math.round(Number(b.rating) || 0))), flag, file, mark: mark(text) };
}

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
    // An edit backed up from another phone, or before this one's storage was cleared, comes back with it.
    const side = await backedEdit(token.access_token, p.id).catch(() => null);
    id = await store.addFrom(new File([blob], p.name, { lastModified: p.taken_at }), source, side ? { rating: side.rating, flag: side.flag, editFile: side.file, backed: side.mark } : {});
    if (side && Object.keys(side.edit).length) await store.saveEdit(id, side.edit);
  }
  location.assign(`/lab/editor/?open=${id}&from=photos`);
}

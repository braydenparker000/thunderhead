// @ts-check
// Backup to the owner's Google Drive (engine/raw/ROADMAP.md stage 1; the owner, 2026-11-11: backups go to Drive,
// "but make nothing depend on it"). The editor works whole with no account and no network: this is an extra, asked
// for with a tap. The editor's own page reaches nothing outside the site and stays that way: only Photos' page
// may reach the owner's Drive (SECURITY.md §4.1), so the Library's "Back up to Drive" goes there
// (apps/photos/backup-screen.js), which runs `run` here and comes straight back. `state` (what there is to back
// up) touches no network and is what the Library shows.
//   Originals  A RAF brought straight into the editor is not in Drive. Backing it up is Photos' own import
//              (apps/photos/import.js): registered with the owner's library, uploaded to their Drive, resumed if
//              cut off, in the background where the browser can. The photo then knows itself as `photos:<id>`,
//              as one opened from Photos does.
//   Edits      Each photo's edit (with its rating and flag) is one small file in Drive named for the photo's
//              library id, replaced when the edit changes. apps/photos/to-editor.js reads it back when a photo
//              is opened on a phone that has no edit for it: a new phone, or storage that was cleared.
import * as store from './store.js';

/** The name of a photo's edit in Drive. @param {string} photosId */
export const sideName = (photosId) => `${photosId}.thunderhead-edit.json`;
const idOf = (/** @type {store.Photo} */ p) => (p.source?.startsWith('photos:') ? p.source.slice(7) : null);
/** A short mark of a text: two edits with one mark are the same edit. @param {string} s */
export function mark(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193); return `${s.length}.${(h >>> 0).toString(36)}`; }
/** What is kept of a photo's edit: the edit, and what the Library holds of the photo. @param {store.Photo} p @param {store.Edit | undefined} edit */
const kept = (p, edit) => JSON.stringify({ v: 1, name: p.name, taken: p.taken, rating: p.rating, flag: p.flag, edit: edit || {} });

/** The signed-in session, read without ever leaving the page; null when there is none. */
async function session() {
  try { return /** @type {{ token: string } | null} */ (await (await import('/th/session.js')).store.read()); } catch { return null; }
}
/** What there is to back up, without touching the network.
 * @returns {Promise<{ signedIn: boolean, originals: store.Photo[], bytes: number, edits: store.Photo[] }>} */
export async function state() {
  const all = store.photos(), originals = all.filter((p) => !p.source && p.kind !== 'stack'), edits = await store.edits();   // a stack is made from frames that are themselves backed up; its own file is not sent (Photos has no place for one yet)
  const changed = all.filter((p) => idOf(p) && (edits.has(p.id) || p.rating || p.flag !== 'none' || p.backed) && mark(kept(p, edits.get(p.id))) !== p.backed);
  return { signedIn: Boolean(await session()), originals, bytes: originals.reduce((s, p) => s + p.size, 0), edits: changed };
}

/** Backs up the edits that changed (on Photos' page: see above). Without an account nothing is asked of anyone;
 * a failure leaves things as they were for the next time. Returns how many went.
 * @param {(line: string) => void} [say] */
export async function edits(say = () => {}) {
  const s = await session(), todo = s ? (await state()).edits : [];
  if (!s || !todo.length) return 0;
  const [{ api }, drive, all] = await Promise.all([import('/th/client.js'), import('../../../apps/photos/drive.js'), store.edits()]);
  const token = () => /** @type {Promise<{ access_token: string, folder_id: string }>} */ (api.call('/v1/photos/upload-token', { method: 'POST', token: s.token }));
  let done = 0;
  for (const p of todo) {
    const text = kept(p, all.get(p.id)), blob = new Blob([text], { type: 'application/json' }), name = sideName(/** @type {string} */ (idOf(p)));
    say(`Backing up edits… ${done + 1} of ${todo.length}`);
    let file = p.editFile || null;
    if (file) await drive.replace((await token()).access_token, file, blob).catch((/** @type {any} */ e) => { if (e?.status !== 404) throw e; file = null; });   // gone from Drive: made again
    if (!file) file = (await drive.findByName((await token()).access_token, name)) || null;
    if (file && file !== p.editFile) await drive.replace((await token()).access_token, file, blob);
    if (!file) file = await drive.upload({ file: blob, name, token });
    await store.update(p.id, { editFile: file || undefined, backed: mark(text) });
    done++;
  }
  return done;
}

/** Backs up the originals that are not in Drive yet, then the edits. `say` hears each step. Returns how many
 * originals were handed to Drive and how many failed (their reasons in `why`).
 * @param {(line: string) => void} say */
export async function run(say) {
  const s = await session();
  if (!s) return { originals: 0, edits: 0, failed: 0, why: 'Sign in on the home screen to back up.' };
  const todo = store.photos().filter((p) => !p.source && p.kind !== 'stack');
  let ok = 0, failed = 0, why = '';
  if (todo.length) {
    const { importFiles } = await import('../../../apps/photos/import.js');
    for (const [k, p] of todo.entries()) {
      say(`Backing up originals… ${k + 1} of ${todo.length}`);
      const file = await store.rawFile(p.id);
      let said = false;
      await importFiles([file], (a) => {
        // registered under this id: the photo knows itself by it from here on (an upload still running resumes in Photos)
        store.update(p.id, { source: `photos:${a.id}` });
        return {
          progress: (sent, total) => say(`Backing up originals… ${k + 1} of ${todo.length} · ${Math.round((sent / Math.max(1, total)) * 100)} %`),
          done: (photo) => { said = true; ok++; store.update(p.id, { source: `photos:${photo.id}` }); },
          failed: (reason) => { said = true; failed++; why = reason; store.update(p.id, { source: undefined }); },
        };
      });
      if (!said) ok++;   // handed to the browser to finish in the background
    }
  }
  const sent = await edits(say).catch((e) => { why = why || (navigator.onLine === false ? 'Offline. The edits will go when you are back online.' : `The edits did not go (${e?.status || e?.code || 'no answer'}).`); return 0; });
  return { originals: ok, edits: sent, failed, why };
}

/** How a backup went, in a line. @param {Awaited<ReturnType<typeof run>>} r */
export function said(r) {
  const count = (/** @type {number} */ k, /** @type {string} */ w) => `${k} ${w}${k === 1 ? '' : 's'}`, did = [r.originals ? count(r.originals, 'original') : '', r.edits ? count(r.edits, 'edit') : ''].filter(Boolean).join(' and ');
  if (r.why && !did) return r.why;
  return `${did ? `Backed up · ${did}` : 'Everything here is in your Drive'}${r.failed ? ` · ${r.failed} did not go: ${r.why}` : r.why ? ` · ${r.why}` : ''}`;
}

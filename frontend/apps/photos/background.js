// @ts-check
// Uploads that go on with Photos closed (PHOTOS.md §3.1): where the browser has Background Fetch
// (Chrome on Android) and the service worker runs, an import does the fast part in the page as
// ever, registers the photo pending (no Drive id yet), then hands the original's upload to the
// browser: a new Drive session (drive.js `open`, kept on this phone by the photo's id) and one PUT
// of the whole file to it, the system's notification showing the file's name and progress. The
// session's address is its own credential, so no Drive token rides along to run out. The service
// worker (sw.js) tells the Worker the Drive id when it ends, or keeps the session and says it
// failed. On the next open, `resume` settles what is left: still running (its progress), ended
// (Drive's word on the session gives the id), or not through (picking the file again resumes it by range).
import { toast } from '/th/ui.js';
import * as data from './data.js';
import { ask, open } from './drive.js';

/** Larger files keep the page's chunked upload. */
export const BACKGROUND_MAX = 2 * 1024 ** 3;
/** After this long a pending photo is shown as one that did not upload (the contract's pending_days). */
const PENDING_MS = 7 * 86_400_000;
const ICONS = [{ src: '/ui/app-icon-192.png', sizes: '192x192', type: 'image/png' }];
export const FAILED = 'This one did not upload.';
/** @typedef {{ id: string, session: string, name: string, size: number, at: number, drive_id?: string, failed?: boolean }} Kept */
/** @typedef {{ id: string, result: '' | 'success' | 'failure', uploaded: number, uploadTotal: number, addEventListener: (t: 'progress', f: () => void) => void }} Fetch */
/** @typedef {{ fetch: (id: string, req: Request, o: object) => Promise<Fetch>, get: (id: string) => Promise<Fetch | undefined> }} Manager */
/** @typedef {import('./import.js').Handle} Handle */

/** Rows on screen waiting for the service worker's word, by photo id. @type {Map<string, Handle>} */
const waiting = new Map();
/** Pending photos this phone knows did not upload (the shelf marks them). */
export const failed = new Set();
/** Photos an import on this page is handing over now; `resume` runs once a page and leaves them be. */
const begun = new Set();
let resumed = false;

/** A pending photo's mark on its tile: "Uploading", or that it did not. @param {data.PhotoItem} p */
export const pendingMark = (p) => (failed.has(p.id) || Date.now() - p.created_at > PENDING_MS ? 'Did not upload' : 'Uploading');

/** The browser's Background Fetch on the running service worker, else null (Safari: the page uploads). */
export async function manager() {
  if (!('BackgroundFetchManager' in self) || !navigator.serviceWorker) return null;
  const reg = /** @type {(ServiceWorkerRegistration & { backgroundFetch?: Manager }) | undefined} */ (
    await navigator.serviceWorker.getRegistration('/').catch(() => undefined));
  return reg?.active && reg.backgroundFetch ? reg.backgroundFetch : null;
}

/** A browser with no Background Fetch at all (Safari): the page uploads, and says so once. */
export function sayOnce() {
  if ('BackgroundFetchManager' in self) return;
  try {
    if (localStorage.getItem('th.p.bg-said')) return;
    localStorage.setItem('th.p.bg-said', '1');
  } catch {
    return;
  }
  toast('Keep Photos open while it uploads: this browser cannot upload in the background.');
}

/** A new Drive session for `file`, kept by the photo's id: opened before the photo is registered,
 * so a Drive not linked fails the import with nothing left pending. @param {string} id @param {File} file */
export async function begin(id, file) {
  begun.add(id);
  const t = await data.uploadToken();
  const session = await open(t.access_token, file, file.name, t.folder_id);
  /** @type {Kept} */
  const kept = { id, session, name: file.name, size: file.size, at: Date.now() };
  await data.store.set(`bg:${id}`, kept);
  return session;
}

/** Hands the upload to the browser: one PUT of the whole file to the session. Its fetch, or null
 * when the browser refused (the page's upload goes on in the same session).
 * @param {Manager} bg @param {string} id @param {File} file @param {string} session */
export const handOff = (bg, id, file, session) =>
  bg.fetch(id, new Request(session, { method: 'PUT', body: file }), { title: `Uploading ${file.name}`, downloadTotal: file.size, icons: ICONS }).catch(() => null);

/** A background upload on its row: its progress, then its end (the service worker's word).
 * @param {Fetch} f @param {Handle} h @param {number} size */
export function follow(f, h, size) {
  waiting.set(f.id, h);
  h.progress(f.uploaded, size);
  h.note?.('Uploading in the background');
  f.addEventListener('progress', () => h.progress(f.uploaded, f.uploadTotal || size));
}

/** The kept session of a pending photo `id` (a retry resumes it). @param {string} id */
export const keptFor = async (id) => /** @type {Kept | null} */ ((await data.store.get(`bg:${id}`).catch(() => null)) ?? null);

/** A background upload that ended without the Worker hearing of it: the Drive id the service
 * worker kept, else Drive's word on the session; else it did not upload. @param {Kept} k @param {Handle} h */
async function settle(k, h) {
  try {
    const id = k.drive_id ?? (await ask(k.session, k.size)).id;
    if (id) {
      const p = await data.patch(k.id, { drive_id: id });
      waiting.delete(k.id);
      failed.delete(k.id);
      await data.store.del(`bg:${k.id}`);
      h.done(p);
      return;
    }
    data.store.set(`bg:${k.id}`, { ...k, failed: true }).catch(() => {});
  } catch {}
  failed.add(k.id);
  h.failed(FAILED);
}

/** On the first open of the shelf, each kept session whose photo is still pending: followed while it
 * runs, else settled. One whose photo is in Drive (or gone) is forgotten. @param {(k: Kept) => Promise<Handle>} row */
export async function resume(row) {
  if (resumed) return;
  resumed = true;
  const kept = /** @type {Kept[]} */ (await data.store.list('bg:').catch(() => []));
  if (!kept.length) return;
  const still = await data.pending().then((ps) => new Set(ps.map((p) => p.id)), () => null);
  const bg = await manager();
  for (const k of kept) {
    if (still && !still.has(k.id)) { data.store.del(`bg:${k.id}`).catch(() => {}); continue; }
    if (waiting.has(k.id) || begun.has(k.id)) continue;
    const f = await bg?.get(k.id).catch(() => undefined);
    const h = await row(k);
    if (f && f.result === '') follow(f, h, k.size);
    else if (still) await settle(k, h);
    else h.failed('Offline. Try again when you are back online.');
  }
}

// The service worker's word on a background upload: in Drive (its photo), kept (the page finishes
// it), or failed (the session kept for a retry).
navigator.serviceWorker?.addEventListener('message', async (e) => {
  const m = e.data;
  if (m?.type !== 'photos:upload' || typeof m.id !== 'string') return;
  const h = waiting.get(m.id);
  if (m.state === 'done' && m.photo) {
    waiting.delete(m.id);
    if (h) h.done(m.photo);
    else document.dispatchEvent(new CustomEvent('photos:changed'));
  } else if (m.state === 'kept' && h) {
    const k = await keptFor(m.id);
    if (k) settle(k, h);
  } else if (m.state === 'failed') {
    failed.add(m.id);
    waiting.delete(m.id);
    h?.failed(FAILED);
  }
});
navigator.serviceWorker?.startMessages?.();

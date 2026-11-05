// @ts-check
// An import (PHOTOS.md §3.1): for each picked file, its embedded preview is read and decoded once,
// the thumbnail shown at once (on the shelf in under a second), the original's upload to Drive
// started (drive.js, with its progress) and the working preview made from the same bitmap while it
// runs (preview.js); the photo is registered with what the file says (read.js; its info, info.js) and the preview sent
// right after (a failed preview never fails the import); where the browser can, the upload goes on
// in the background with Photos closed (background.js). `photo.import` says it happened (the id,
// the format and where from, never the name). A photo found in Drive by the daily pass, or picked
// there (from-drive.js), gets its preview from its original in Drive (`previewFromDrive`).
import { uuidv7 } from '/th/chat/model.js';
import { BACKGROUND_MAX, begin, follow, handOff, keptFor, manager, sayOnce } from './background.js';
import { fetchOriginal, upload } from './drive.js';
import * as data from './data.js';
import { decodeOnce } from './preview.js';
import { readInfo } from './info.js';
import { formatOf, readPhoto } from './read.js';

/** @typedef {{ id: string, name: string, thumb: Blob | null, taken_at: number }} Arrival */
/** @typedef {{ progress: (sent: number, total: number) => void, done: (p: data.PhotoItem) => void, failed: (why: string) => void, note?: (t: string) => void }} Handle */

/** @param {Blob} blob */
async function hash(blob) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The words for a failed import. @param {unknown} e */
export function why(e) {
  const code = /** @type {{ code?: string, status?: number }} */ (e)?.code;
  if (code === 'conflict') return 'Connect Google Drive in Settings › Photos first.';
  if (code === 'not_configured') return 'Google Drive is not set up for your Worker yet.';
  return navigator.onLine === false ? 'Offline. Try again when you are back online.' : 'This one did not upload. Try again.';
}

/** Sends the working preview; kept on this phone too. @param {string} id @param {Blob} jpeg */
async function sendPreview(id, jpeg) {
  await data.keepPreview(id, jpeg);
  return data.putPreview(id, jpeg);
}

/** `photo.import`: the id, the format and where from. @param {data.PhotoItem} p @param {'phone' | 'drive'} source */
export const sensed = (p, source) =>
  import('/th/senses/send.js').then((m) => m.sense('photo.import', `photo:${p.id}`, { format: p.format, source })).catch(() => {});

/**
 * Imports the files one after another. `arrive` puts each on the shelf at once and returns how to
 * show its progress and its end. Where the browser uploads in the background (background.js), the
 * photo is registered pending and the upload handed over; else, or for a file over 2 GiB, the page
 * uploads it. A file that is a pending photo's (the same name and size) is that photo again: its
 * kept session resumes by range.
 * @param {File[]} files @param {(a: Arrival) => Handle} arrive
 */
export async function importFiles(files, arrive) {
  const bg = await manager();
  if (!bg) sayOnce();
  const waiting = await data.pending().catch(() => []);
  for (const file of files) {
    const name = file.name.slice(0, 200);
    const was = waiting.find((p) => p.name === name && p.bytes === file.size);
    const id = was?.id ?? uuidv7();
    const kept = was ? await keptFor(was.id) : null;
    const meta = await readPhoto(file);
    if (meta.rating) data.store.set(`camrating:${id}`, meta.rating).catch(() => {}); // the star row offers it (edit/cull.js)
    const once = meta.preview ? await decodeOnce(meta.preview).catch(() => null) : null;
    const thumb = once?.thumb ?? null;
    if (thumb) data.keepThumb(id, thumb);
    const h = arrive({ id, name: file.name, thumb, taken_at: meta.taken_at });
    let preview = /** @type {Promise<{ blob: Blob } | null>} */ (Promise.resolve(null));
    try {
      const sha = hash(file);
      const info = readInfo(file, meta);
      const body = async (/** @type {string | null} */ drive_id) => ({
        drive_id,
        name,
        format: meta.format,
        bytes: file.size,
        sha256: await sha,
        camera: meta.camera?.slice(0, 80) || null,
        film: meta.film,
        width: meta.width,
        height: meta.height,
        taken_at: Math.max(0, Math.round(meta.taken_at)),
        info: await info,
      });
      const key = `session:${file.name}:${file.size}`;
      let session = kept?.session ?? (await data.store.get(key).catch(() => null));
      if (bg && !kept && file.size <= BACKGROUND_MAX) {
        // The fast part here, the upload handed over: pending until the service worker says it is in Drive.
        session = await begin(id, file);
        let photo = await data.register(id, await body(null));
        const job = await handOff(bg, id, file, session);
        if (job) {
          if (once) preview = once.preview(data.previewSide()).catch(() => null);
          const made = await preview;
          if (made) photo = await sendPreview(photo.id, made.blob).catch(() => photo);
          sensed(photo, 'phone');
          follow(job, h, file.size);
          // On the shelf now, with its Uploading mark.
          document.dispatchEvent(new CustomEvent('photos:changed'));
          continue;
        }
      }
      const uploading = upload({
        file,
        name: file.name,
        token: data.uploadToken,
        session,
        keep: (s) => data.store.set(key, s).catch(() => {}),
        onProgress: h.progress,
      });
      // The working preview from the same bitmap, made while the upload runs.
      if (once) preview = once.preview(data.previewSide()).catch(() => null);
      const driveId = await uploading;
      data.store.del(key).catch(() => {});
      data.store.del(`bg:${id}`).catch(() => {});
      // A pending photo's own file takes its Drive id the same way.
      let photo = await data.register(id, await body(driveId));
      // A Drive file the daily pass had already found is that photo: its thumbnail follows it.
      if (photo.id !== id && thumb) data.keepThumb(photo.id, thumb);
      const made = await preview;
      if (made) photo = await sendPreview(photo.id, made.blob).catch(() => photo);
      sensed(photo, 'phone');
      h.done(photo);
    } catch (e) {
      h.failed(why(e));
      // The bitmap goes either way.
      await preview;
    }
  }
}

/** A photo the daily pass found (no preview yet): its original's embedded JPEG from Drive (a RAF's
 * header and preview only), its thumbnail and preview made and sent. @param {data.PhotoItem} p */
export async function previewFromDrive(p) {
  if (!p.drive_id) return null;
  const t = await data.uploadToken();
  let file;
  if (p.format === 'raf') {
    const head = await fetchOriginal(t.access_token, p.drive_id, [0, 92]);
    const v = new DataView(await head.arrayBuffer());
    const off = v.getUint32(84), len = v.getUint32(88);
    const jpeg = await fetchOriginal(t.access_token, p.drive_id, [off, off + len]);
    // The header and the preview, where read.js expects them: a sparse stand-in for the file.
    file = new File([head, new Uint8Array(Math.max(0, off - 92)), jpeg], p.name);
  } else file = new File([await fetchOriginal(t.access_token, p.drive_id)], p.name, { type: p.format === 'jpeg' ? 'image/jpeg' : '' });
  if (formatOf(file) === 'other') return null;
  const meta = await readPhoto(file);
  if (meta.rating) data.store.set(`camrating:${p.id}`, meta.rating).catch(() => {});
  if (!meta.preview) return null;
  const once = await decodeOnce(meta.preview);
  if (once.thumb) await data.keepThumb(p.id, once.thumb);
  return sendPreview(p.id, (await once.preview(data.previewSide())).blob);
}

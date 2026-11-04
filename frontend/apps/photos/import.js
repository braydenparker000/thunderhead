// @ts-check
// An import (PHOTOS.md §3.1): for each picked file, its embedded preview is read and shown at once
// (a thumbnail on the shelf in under a second), the original goes to Drive (drive.js) with its
// progress, the photo is registered with what the file says (read.js), and the working preview is
// made on the phone (preview.js) and sent to the Worker; `photo.import` says it happened (the id
// and the format, never the name). A photo found in Drive by the daily pass gets its preview the
// same way the first time it is opened (`previewFromDrive`).
import { uuidv7 } from '/th/chat/model.js';
import { fetchOriginal, upload } from './drive.js';
import * as data from './data.js';
import { makePreview, makeThumb } from './preview.js';
import { formatOf, readPhoto } from './read.js';

/** @typedef {{ id: string, name: string, thumb: Blob | null, taken_at: number }} Arrival */
/** @typedef {{ progress: (sent: number, total: number) => void, done: (p: data.PhotoItem) => void, failed: (why: string) => void }} Handle */

/** @param {Blob} blob */
async function hash(blob) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The words for a failed import. @param {unknown} e */
function why(e) {
  const code = /** @type {{ code?: string, status?: number }} */ (e)?.code;
  if (code === 'conflict') return 'Connect Google Drive in Settings › Photos first.';
  if (code === 'not_configured') return 'Google Drive is not set up for your Worker yet.';
  return navigator.onLine === false ? 'Offline. Try again when you are back online.' : 'This one did not upload. Try again.';
}

/** Makes and sends the working preview; kept on this phone too. @param {string} id @param {Blob} source */
export async function sendPreview(id, source) {
  const p = await makePreview(source, data.previewSide());
  await data.keepPreview(id, p.blob);
  return data.putPreview(id, p.blob);
}

/**
 * Imports the files one after another. `arrive` puts each on the shelf at once and returns how to
 * show its progress and its end.
 * @param {File[]} files @param {(a: Arrival) => Handle} arrive
 */
export async function importFiles(files, arrive) {
  for (const file of files) {
    const id = uuidv7();
    const meta = await readPhoto(file);
    const thumb = meta.preview ? await makeThumb(meta.preview).catch(() => null) : null;
    if (thumb) data.keepThumb(id, thumb);
    const h = arrive({ id, name: file.name, thumb, taken_at: meta.taken_at });
    try {
      const kept = await data.store.get(`session:${file.name}:${file.size}`).catch(() => null);
      const driveId = await upload({
        file,
        name: file.name,
        token: data.uploadToken,
        session: kept,
        keep: (s) => data.store.set(`session:${file.name}:${file.size}`, s).catch(() => {}),
        onProgress: h.progress,
      });
      data.store.del(`session:${file.name}:${file.size}`).catch(() => {});
      let photo = await data.register(id, {
        drive_id: driveId,
        name: file.name.slice(0, 200),
        format: meta.format,
        bytes: file.size,
        sha256: await hash(file),
        camera: meta.camera?.slice(0, 80) || null,
        film: meta.film,
        width: meta.width,
        height: meta.height,
        taken_at: Math.max(0, Math.round(meta.taken_at)),
      });
      // A Drive file the daily pass had already found is that photo: its thumbnail follows it.
      if (photo.id !== id && thumb) data.keepThumb(photo.id, thumb);
      if (meta.preview) photo = await sendPreview(photo.id, meta.preview).catch(() => photo);
      import('/th/senses/send.js').then((m) => m.sense('photo.import', `photo:${photo.id}`, { format: meta.format })).catch(() => {});
      h.done(photo);
    } catch (e) {
      h.failed(why(e));
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
  if (!meta.preview) return null;
  const thumb = await makeThumb(meta.preview).catch(() => null);
  if (thumb) await data.keepThumb(p.id, thumb);
  return sendPreview(p.id, meta.preview);
}

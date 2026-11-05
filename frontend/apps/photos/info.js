// @ts-check
// A photo's info (PHOTOS.md § Info): read from its file at import (`readInfo`, sent with the
// registration) or, for a photo registered without it, the first time it is opened (`backfill`): from
// its original in Drive, only the bytes that hold it (a RAF's header and the start of its embedded
// JPEG, or the start of a JPEG or DNG), sent by PUT /v1/photos/:id/info with the camera and film the
// photo lacks. Never a place: exif.js reads no GPS tag. The Info button opens the sheet (info-sheet.js).
import { el } from '/th/ui.js';
import * as data from './data.js';
import { fetchOriginal } from './drive.js';
import { jpegInfo, tiffInfo } from './exif.js';
import { blobRead, jpegWords, readPhoto } from './read.js';
import { icon } from './shelf.js';

/** @typedef {import('../../../shared/contract/photos-info.ts').PhotoInfo} PhotoInfo */
/** @typedef {import('./read.js').PhotoMeta} PhotoMeta */

/** The bytes read for it: an APP1 is at most 64 KB, a DNG's IFDs come before its image data. */
const HEAD = 160 * 1024;
const DNG_HEAD = 512 * 1024;

/** The info of a picked file (its embedded JPEG's EXIF, or a DNG's IFDs), with the camera's stars
 * read.js found; `{}` for a file that says nothing (a HEIC), null when it could not be read.
 * @param {Blob} file @param {PhotoMeta} meta @returns {Promise<PhotoInfo | null>} */
export async function readInfo(file, meta) {
  try {
    const stars = meta.rating;
    /** @type {PhotoInfo | null} */
    let info = {};
    if (meta.format === 'dng') info = await tiffInfo(blobRead(file), 0);
    else if ((meta.format === 'raf' || meta.format === 'jpeg') && meta.preview) info = await jpegInfo(new Uint8Array(await meta.preview.slice(0, HEAD).arrayBuffer()));
    return info && stars ? { ...info, rating: stars } : (info ?? {});
  } catch {
    return null;
  }
}

/** What the original in Drive says, from as few bytes as hold it. @param {string} token @param {data.PhotoItem} p */
async function fromDrive(token, p) {
  const id = /** @type {string} */ (p.drive_id);
  const bytes = async (/** @type {number} */ a, /** @type {number} */ b) => new Uint8Array(await (await fetchOriginal(token, id, [a, b])).arrayBuffer());
  if (p.format === 'raf' || p.format === 'jpeg') {
    let jpeg;
    if (p.format === 'raf') {
      const head = new DataView((await bytes(0, 92)).buffer);
      if (head.byteLength < 92) return null;
      const off = head.getUint32(84), len = head.getUint32(88);
      jpeg = await bytes(off, off + Math.min(len, HEAD));
    } else jpeg = await bytes(0, HEAD);
    const info = await jpegInfo(jpeg);
    const words = await jpegWords(jpeg).catch(() => null);
    const stars = words?.rating;
    return info && { info: stars ? { ...info, rating: stars } : info, camera: words?.camera ?? null, film: words?.film ?? null };
  }
  if (p.format === 'dng') {
    const file = new File([await bytes(0, DNG_HEAD)], p.name);
    const info = await tiffInfo(blobRead(file), 0);
    const meta = await readPhoto(file);
    return info && { info, camera: meta.camera, film: meta.film };
  }
  return { info: {}, camera: null, film: null };
}

/** @type {Map<string, Promise<PhotoInfo | null>>} */
const running = new Map();

/** The photo's info: as the Worker has it, or, for one registered without it, read from its original
 * once (a load) and sent. Null offline or when it could not be read. @param {data.PhotoItem} p */
export function backfill(p) {
  const known = data.infos.get(p.id);
  if (known !== null || !p.drive_id || navigator.onLine === false) return Promise.resolve(known ?? null);
  let run = running.get(p.id);
  if (!run) {
    run = (async () => {
      const got = await fromDrive((await data.uploadToken()).access_token, p);
      if (!got) return null;
      const body = { info: got.info, ...(!p.camera && got.camera ? { camera: got.camera.slice(0, 80) } : {}), ...(!p.film && got.film ? { film: got.film } : {}) };
      const r = await data.putInfo(p.id, body);
      Object.assign(p, { camera: r.photo.camera, film: r.photo.film });
      data.infos.set(p.id, got.info);
      return got.info;
    })().catch(() => null);
    running.set(p.id, run);
    run.then((v) => { if (v === null) running.delete(p.id); });
  }
  return run;
}

/** Info in the editor's top bar, before Export; the read for a photo without info starts now.
 * @param {HTMLElement} root the editor @param {data.PhotoItem} p @param {() => Uint8Array | null} pixels the live render, read small */
export function infoButton(root, p, pixels) {
  const b = el('button', { type: 'button', class: 'vback einfo', 'aria-label': 'Info' }, [icon('info')]);
  b.addEventListener('click', () => import('./info-sheet.js').then((m) => m.infoSheet(root, p, { pixels })));
  root.querySelector('.etop')?.insertBefore(b, root.querySelector('.eexport'));
  backfill(p);
}

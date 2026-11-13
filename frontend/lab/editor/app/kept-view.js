// @ts-check
// The photo as the owner last left it, kept to show at once when it is opened again. Opening a 40 MP RAF takes
// a couple of seconds on the phone; until it is developed, the screen showed the camera's own JPEG, which is not
// the owner's edit. So when an edit is kept, its Library tile and this are made from the one frame (session.js
// `keepTile`): the editing copy's frame, cropped and edited, about the screen's size (LONG on its longer side),
// kept on this phone beside the tile (store.js `saveView`) with a mark of the edit it was made from. On open it
// shows in place of the camera JPEG only while that mark is the mark of the edit saved now: an edit changed in
// any other way (another tab, a paste on many, a backup brought back) shows the camera JPEG as before. It is made
// from the edit again whenever it is wanted, so a backup never carries it (backup.js sends originals and edits).
import * as store from './store.js';
import { mark } from './backup.js';
import { preview } from './shown.js';
import { note as keep } from './timings.js';

// A JPEG at 0.85: measured in Chromium on the editor's sample photo (1405 × 937, 2026-11-13), it is 64 KB at 46.9 dB, where
// a WebP of that quality (0.96 or so) is larger and a WebP at 0.85 is 17 KB but only 45.0 dB; the JPEG encodes ten times faster.
const LONG = 1600, TYPE = 'image/jpeg', QUALITY = 0.85;

/** The mark of a saved edit without its history and versions (they do not change the picture). '' for none.
 * @param {store.Edit | Record<string, unknown> | undefined} edit */
export function stampOf(edit) {
  if (!edit) return '';
  const { steps, at, versions, ...rest } = /** @type {Record<string, unknown>} */ (edit);
  return mark(JSON.stringify(rest));
}

// fingers on the screen: a dial still turning is never made to wait for an encoder
const down = new Set();
addEventListener('pointerdown', (e) => down.add(e.pointerId), true);
for (const t of ['pointerup', 'pointercancel']) addEventListener(t, (e) => down.delete(/** @type {PointerEvent} */ (e).pointerId), true);
const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));
let chain = Promise.resolve();

/** Keeps the frame `im` (the photo as edited, the size of its editing copy) for the photo `id`, made from the edit
 * `rec` (the record as saved, read before the frame was drawn). Nothing is done when the kept one was made from this
 * edit already. One at a time, after the fingers have let go; the resize and the encoding are the browser's own asynchronous work.
 * @param {string} id @param {store.Edit} rec @param {ImageData} im */
export function keepView(id, rec, im) {
  const at = stampOf(rec);
  if (!at || store.photos().find((p) => p.id === id)?.view === at) return;
  chain = chain.then(async () => {
    for (let i = 0; down.size && i < 50; i++) await sleep(200);   // (a finger whose lifting was never heard holds it 10 s at most)
    if (store.photos().find((p) => p.id === id)?.view === at) return;
    const k = Math.min(1, LONG / Math.max(im.width, im.height)), w = Math.max(1, Math.round(im.width * k)), h = Math.max(1, Math.round(im.height * k));
    const bm = await createImageBitmap(im, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' }), c = new OffscreenCanvas(w, h);
    /** @type {OffscreenCanvasRenderingContext2D} */ (c.getContext('2d')).drawImage(bm, 0, 0); bm.close();
    await store.saveView(id, await c.convertToBlob({ type: TYPE, quality: QUALITY }), at);
  }).catch((err) => console.warn('kept picture not made', err));
}

/** What the open's timing says of the first picture: when the tap was, how long until a picture of the photo showed, and whether it was the kept one. */
const seen = { tap: 0, first: 0, kept: false };
let made = /** @type {string[]} */ ([]), pending = '';
/** The tap on a photo to open it. */
export const tap = () => { seen.tap = performance.now(); seen.first = 0; seen.kept = false; };
/** The photo's saved edit, and the first picture to show of it, decoded: the kept one when it was made from this
 * edit, else the camera's JPEG (shown.js `preview`). @param {string} id @returns {Promise<[store.Edit | undefined, string]>} */
export async function firstPicture(id) {
  const p = store.photos().find((x) => x.id === id), camera = p?.view ? null : preview(id);   // nothing kept: the JPEG is decoded while the edit is read
  const [saved, file] = await Promise.all([store.loadEdit(id), p?.view ? store.viewFile(id) : null]);
  if (file && saved && p?.view === stampOf(saved)) {
    const url = URL.createObjectURL(file), im = new Image();
    im.src = url;
    if (await im.decode().then(() => true, () => false)) { made.push(url); pending = url; seen.kept = true; return [saved, url]; }
    URL.revokeObjectURL(url);
  }
  pending = ''; seen.kept = false;
  return [saved, await (camera || preview(id))];
}
/** The first picture is on (session.js `open`): the time is taken, and kept pictures no longer shown are let go. */
export function onScreen() {
  seen.first = performance.now() - seen.tap;
  for (const u of made) if (u !== pending) URL.revokeObjectURL(u);
  made = pending ? [pending] : [];
}
/** Keeps a timing (timings.js); an open's carries `first` (ms from the tap to the first picture) and `kept: 1` when
 * that picture was the kept one. @type {typeof keep} */
export const note = (kind, ms, more = {}) => keep(kind, ms, kind === 'open' ? { ...more, first: Math.round(seen.first), ...(seen.kept ? { kept: 1 } : {}) } : more);

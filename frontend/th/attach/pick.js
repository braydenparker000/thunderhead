// @ts-check
// Choosing what to attach (HOME.md §6.2, §4.6): the phone's camera app, its photo picker or its file
// picker, each through a file input, so the app itself never holds the camera or the files. A photo
// is redrawn here at most 2,048 px on its long edge, as JPEG at 0.85; redrawing also drops its
// location and the rest of its EXIF data. A GIF, or an image this phone can't decode, goes as it
// is. Anything over 25 MB is refused with a toast.
import { FILE_LIMITS } from '../contract.js';
import { uuidv7 } from '../chat/model.js';
import { toast } from '../ui.js';

/** @typedef {import('./state.js').LocalFile} LocalFile */

const KINDS = /** @type {const} */ ({
  camera: { accept: 'image/*', capture: 'environment', multiple: false },
  photos: { accept: 'image/*', multiple: true },
  files: { accept: '', multiple: true },
});
export const LONG_EDGE = 2048;
const THUMB = 120;

/** Opens the picker; resolves with what was chosen (nothing if it was closed).
 * @param {keyof typeof KINDS} kind @returns {Promise<File[]>} */
export function choose(kind) {
  const k = KINDS[kind];
  const input = document.createElement('input');
  input.type = 'file';
  if (k.accept) input.accept = k.accept;
  if ('capture' in k) input.setAttribute('capture', k.capture);
  input.multiple = k.multiple;
  return new Promise((resolve) => {
    input.addEventListener('change', () => resolve([...(input.files ?? [])]), { once: true });
    input.addEventListener('cancel', () => resolve([]), { once: true });
    input.click();
  });
}

/** A picked file made ready to send; null when it is too big. @param {File} file @returns {Promise<LocalFile | null>} */
export async function prepare(file) {
  if (file.size > FILE_LIMITS.bytes) {
    toast(`${file.name || 'That file'} is over 25 MB.`);
    return null;
  }
  const id = uuidv7();
  if (file.type.startsWith('image/') && file.type !== 'image/gif') {
    try {
      const bmp = await createImageBitmap(file);
      const k = Math.min(1, LONG_EDGE / Math.max(bmp.width, bmp.height));
      const blob = await redraw(bmp, Math.round(bmp.width * k), Math.round(bmp.height * k), 0.85);
      const thumb = await thumbOf(bmp);
      bmp.close();
      const name = `${(file.name || 'photo').replace(/\.[^.]*$/, '') || 'photo'}.jpg`;
      return { id, name, type: 'image/jpeg', bytes: blob.size, blob, thumb };
    } catch {
      // An image this phone can't decode goes as it is, so its EXIF goes too: say so.
      toast("Couldn't resize that photo, so it goes as it is, with any location data in it.");
    }
  }
  return { id, name: file.name || 'file', type: file.type || 'application/octet-stream', bytes: file.size, blob: file };
}

/** @param {ImageBitmap} bmp @param {number} w @param {number} h @param {number} quality @returns {Promise<Blob>} */
async function redraw(bmp, w, h, quality) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
  g.drawImage(bmp, 0, 0, w, h);
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/jpeg', quality));
}

/** A square crop for the bar's thumbnail, as a data: image. @param {ImageBitmap} bmp */
async function thumbOf(bmp) {
  const side = Math.min(bmp.width, bmp.height);
  const c = document.createElement('canvas');
  c.width = c.height = THUMB;
  const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
  g.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, THUMB, THUMB);
  return c.toDataURL('image/jpeg', 0.7);
}

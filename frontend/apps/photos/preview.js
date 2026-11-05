// @ts-check
// The working preview, made on the phone (PHOTOS.md §3.1): the embedded JPEG (or the photo itself)
// decoded once (one bitmap for the thumbnail and the preview), drawn at 2048 px on its longest side (Settings › Photos: 1024 or 2048), and encoded
// as a JPEG of at most 400 KB, a lower quality and then a smaller size until it fits; a 360 px
// thumbnail the same way for the shelf. OffscreenCanvas where the browser has it.

export const PREVIEW_BYTES = 400 * 1024;

/** @param {number} w @param {number} h */
function canvasOf(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** @param {OffscreenCanvas | HTMLCanvasElement} c @param {number} quality @returns {Promise<Blob>} */
function encode(c, quality) {
  if ('convertToBlob' in c) return c.convertToBlob({ type: 'image/jpeg', quality });
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/jpeg', quality),
  );
}

const THUMB_SIDE = 360;
const THUMB_BYTES = 60 * 1024;

/** A JPEG of the bitmap at most `side` px on its longest side and `max` bytes.
 * @param {ImageBitmap} bitmap @param {number} side @param {number} max
 * @returns {Promise<{ blob: Blob, width: number, height: number }>} */
async function draw(bitmap, side, max) {
  let s = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
  for (let round = 0; round < 4; round++) {
    const w = Math.max(1, Math.round(bitmap.width * s)), h = Math.max(1, Math.round(bitmap.height * s));
    const c = canvasOf(w, h);
    const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
    g.imageSmoothingQuality = 'high';
    g.drawImage(bitmap, 0, 0, w, h);
    for (const q of [0.82, 0.72, 0.62]) {
      const blob = await encode(c, q);
      if (blob.size <= max) return { blob, width: w, height: h };
    }
    s *= 0.8;
  }
  throw new Error('the preview will not fit');
}

/**
 * A JPEG of `source` at most `side` px on its longest side and `max` bytes.
 * @param {Blob} source @param {number} side @param {number} [max]
 */
export async function makePreview(source, side, max = PREVIEW_BYTES) {
  const bitmap = await createImageBitmap(source);
  try {
    return await draw(bitmap, side, max);
  } finally {
    bitmap.close();
  }
}

/** The shelf's thumbnail. @param {Blob} source */
export const makeThumb = async (source) => (await makePreview(source, THUMB_SIDE, THUMB_BYTES)).blob;

/**
 * One decode for both (an import): the shelf's thumbnail at once, and `preview(side)` to make the
 * working preview from the same bitmap later, while the upload runs, which then lets it go.
 * @param {Blob} source
 * @returns {Promise<{ thumb: Blob | null, preview: (side: number) => Promise<{ blob: Blob, width: number, height: number }> }>}
 */
export async function decodeOnce(source) {
  const bitmap = await createImageBitmap(source);
  const thumb = await draw(bitmap, THUMB_SIDE, THUMB_BYTES).then((t) => t.blob, () => null);
  return {
    thumb,
    preview: async (side) => {
      try {
        return await draw(bitmap, side, PREVIEW_BYTES);
      } finally {
        bitmap.close();
      }
    },
  };
}

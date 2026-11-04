// @ts-check
// The working preview, made on the phone (PHOTOS.md §3.1): the embedded JPEG (or the photo itself)
// decoded once, drawn at 2048 px on its longest side (Settings › Photos: 1024 or 2048), and encoded
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

/**
 * A JPEG of `source` at most `side` px on its longest side and `max` bytes.
 * @param {Blob} source @param {number} side @param {number} [max]
 * @returns {Promise<{ blob: Blob, width: number, height: number }>}
 */
export async function makePreview(source, side, max = PREVIEW_BYTES) {
  const bitmap = await createImageBitmap(source);
  try {
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
  } finally {
    bitmap.close();
  }
}

/** The shelf's thumbnail. @param {Blob} source */
export const makeThumb = async (source) => (await makePreview(source, 360, 60 * 1024)).blob;

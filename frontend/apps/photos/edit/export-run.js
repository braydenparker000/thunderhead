// @ts-check
// An export rendered from the original (PHOTOS.md, Export): the output is cut into bands of 256 rows,
// each band into blocks of 1,024 columns; for each block the region of the photo it samples (through
// the crop and geometry, padded for the neighbourhood steps) becomes the GPU's detail source, from a 1:1
// tile of the engine when the export is finer than the working copy, else from the working copy; the
// block is developed and read back, and each band goes to the JPEG encoder in a worker (or, for HEIC,
// onto a canvas the browser encodes). Never the full float image: a tile and a band at a time.
import { frameSize, geometry, photoBox } from './geometry.js';
import { pack, toneLut } from './uniforms.js';

const BAND = 256, BLOCK = 1024, PAD = 16;
/** The sizes Export offers: the long side, or 0 for full size. */
export const SIDES = /** @type {Record<string, number>} */ ({ full: 0, 2048: 2048, 1080: 1080 });

/** @typedef {import('./renderer.js').Source & { x?: number, y?: number }} Tile */
/** @typedef {{ raw: boolean, rawPhoto?: boolean, asShot: number[], shot: { temperature: number, tint: number }, auto?: any, width: number, height: number, ca?: number[] }} Img */

/** The output's pixel size. @param {import('./fields.js').Recipe} recipe @param {Img} img @param {string} size */
export function outSize(recipe, img, size) {
  const g = geometry(recipe, img.width, img.height), [fw, fh] = frameSize(g), side = SIDES[size] ?? 0;
  const s = side ? Math.min(1, side / Math.max(fw, fh)) : 1;
  return { g, w: Math.max(1, Math.round(fw * s)), h: Math.max(1, Math.round(fh * s)), s };
}

/** A JPEG sink in the worker. @param {number} w @param {number} h @param {number} quality @param {Uint8Array[]} segments */
function jpegSink(w, h, quality, segments) {
  const worker = new Worker('/apps/photos/edit/export-worker.js', { type: 'module' });
  const ask = (/** @type {any} */ m, /** @type {Transferable[]} */ t = []) => new Promise((ok, no) => {
    worker.onmessage = (e) => (e.data.type === 'error' ? no(new Error(e.data.message)) : ok(e.data));
    worker.onerror = (e) => no(new Error(e.message || 'the encoder stopped'));
    worker.postMessage(m, t);
  });
  const started = ask({ type: 'start', width: w, height: h, quality, segments });
  return {
    rows: async (/** @type {Uint8Array} */ band, /** @type {number} */ _y, /** @type {number} */ n) => { await started; await ask({ type: 'rows', rgba: band, n }, [band.buffer]); },
    finish: async () => /** @type {Blob} */ ((await ask({ type: 'finish' })).blob),
    close: () => worker.terminate(),
  };
}

/** A HEIC sink: the browser's own encoder on a canvas (2,048 px at most). @param {number} w @param {number} h @param {number} quality */
function heicSink(w, h, quality) {
  const c = new OffscreenCanvas(w, h), g = /** @type {OffscreenCanvasRenderingContext2D} */ (c.getContext('2d'));
  return {
    rows: async (/** @type {Uint8Array} */ band, /** @type {number} */ y, /** @type {number} */ n) => g.putImageData(new ImageData(new Uint8ClampedArray(/** @type {ArrayBuffer} */ (band.buffer), 0, w * n * 4), w, n), 0, y),
    finish: () => c.convertToBlob({ type: 'image/heic', quality: quality / 100 }),
    close: () => {},
  };
}

/** Whether this browser writes HEIC from a canvas (Safari on iOS may; none did when this was written). */
export async function heicWritable() {
  try { return (await new OffscreenCanvas(2, 2).convertToBlob({ type: 'image/heic' })).type === 'image/heic'; } catch { return false; }
}

/**
 * @param {{ r: import('./renderer.js').Renderer, img: Img, recipe: import('./fields.js').Recipe, p0: number[], working: number,
 *   tile?: ((x: number, y: number, w: number, h: number) => Promise<Tile>) | null, size: string, format: 'jpeg' | 'heic', quality: number,
 *   segments: Uint8Array[], onProgress?: (f: number) => void, signal?: AbortSignal }} o working: the share of the photo's pixels the working copy has
 * @returns {Promise<Blob>}
 */
export async function renderExport(o) {
  const { r, img, recipe } = o;
  const { g, w: W, h: H, s } = outSize(recipe, img, o.size);
  const lut = toneLut(recipe, img.raw);
  const fine = Boolean(o.tile) && s / g.z > o.working * 1.05;
  const sink = o.format === 'heic' ? heicSink(W, H, o.quality) : jpegSink(W, H, o.quality, o.segments);
  try {
    for (let y0 = 0; y0 < H; y0 += BAND) {
      const bh = Math.min(BAND, H - y0), band = new Uint8Array(W * bh * 4);
      for (let x0 = 0; x0 < W; x0 += BLOCK) {
        if (o.signal?.aborted) throw new DOMException('The export was cancelled.', 'AbortError');
        const bw = Math.min(BLOCK, W - x0);
        const box = photoBox(g, [x0 / W, y0 / H], [(x0 + bw) / W, (y0 + bh) / H], PAD / Math.min(1, s / g.z));
        const px0 = Math.floor(box[0] * img.width), py0 = Math.floor(box[1] * img.height);
        const tw = Math.max(1, Math.ceil(box[2] * img.width) - px0), th = Math.max(1, Math.ceil(box[3] * img.height) - py0);
        const t = fine && o.tile ? await o.tile(px0, py0, tw, th) : null;
        const tx = t?.x ?? px0, ty = t?.y ?? py0;
        const region = t ? [tx / img.width, ty / img.height, (tx + t.width) / img.width, (ty + t.height) / img.height] : box;
        const dw = t ? t.width : Math.max(1, Math.ceil(((region[2] - region[0]) * img.width * s) / g.z) + 2);
        const dh = t ? t.height : Math.max(1, Math.ceil(((region[3] - region[1]) * img.height * s) / g.z) + 2);
        r.detail(t, region, dw, dh);
        if (t?.kind === 'bitmap') t.bitmap.close();
        const view = { scale: [1 / W, 1 / H], offset: [x0 / W, y0 / H], size: [bw, bh], flip: 0, p0: o.p0, tile: { u0: region[0], v0: region[1], u1: region[2], v1: region[3], texel: [1 / dw, 1 / dh] } };
        const px = await r.read(pack(recipe, img, view), lut, bw, bh);
        for (let j = 0; j < bh; j++) band.set(px.subarray(j * bw * 4, (j + 1) * bw * 4), (j * W + x0) * 4);
      }
      await sink.rows(band, y0, bh);
      o.onProgress?.((y0 + bh) / H);
    }
    return await sink.finish();
  } finally {
    sink.close();
    r.clearDetail();
  }
}

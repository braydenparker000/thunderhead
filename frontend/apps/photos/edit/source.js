// @ts-check
// Where the editor's pixels come from (PHOTOS.md, the editor): the preview on this phone first (the
// embedded JPEG made at import, so the first frame needs no network), then the original from the
// owner's Drive: a RAF or DNG through the engine in a worker (engine-worker.js), a JPEG or HEIC
// decoded by the browser. Each gives a working copy (half size for RAW, at most 4096 px for JPEG) and
// 1:1 tiles on demand. Offline, or with no Drive, the preview is what is edited.
import * as data from '../data.js';
import { fetchOriginal, mediaUrl } from '../drive.js';

/** @typedef {import('./renderer.js').Source} Source */
/** @typedef {{ source: Source, raw: boolean, width: number, height: number, asShot: number[], camera: string | null, fallback: boolean, memory: number, ms: number, tile: (x: number, y: number, w: number, h: number) => Promise<Source>, close: () => void }} Original */

const D65 = [0.3127, 0.329];
const WORKING_SIDE = 4096;

/** The preview (or thumbnail) as a bitmap source. @param {string} id @returns {Promise<Source | null>} */
export async function previewSource(id) {
  const blob = (await data.previewOf(id).catch(() => null)) ?? (await data.thumbOf(id));
  if (!blob) return null;
  const bitmap = await createImageBitmap(blob);
  return { kind: 'bitmap', width: bitmap.width, height: bitmap.height, bitmap };
}

/** The original, decoded. Null offline or with no Drive file. @param {data.PhotoItem} p @returns {Promise<Original | null>} */
export async function originalSource(p) {
  if (!p.drive_id || navigator.onLine === false) return null;
  const t = await data.uploadToken();
  if (p.format === 'raf' || p.format === 'dng') return engineSource(p, t.access_token);
  if (p.format !== 'jpeg' && p.format !== 'heic') return null;
  const blob = await fetchOriginal(t.access_token, p.drive_id);
  const probe = await createImageBitmap(blob);
  const { width, height } = probe;
  const s = Math.min(1, WORKING_SIDE / Math.max(width, height));
  const bitmap = s < 1 ? await createImageBitmap(blob, { resizeWidth: Math.round(width * s), resizeHeight: Math.round(height * s), resizeQuality: 'high' }) : probe;
  if (bitmap !== probe) probe.close();
  return {
    source: { kind: 'bitmap', width: bitmap.width, height: bitmap.height, bitmap },
    raw: false, width, height, asShot: D65, camera: p.camera, fallback: false, memory: 0, ms: 0,
    tile: async (x, y, w, h) => {
      const b = await createImageBitmap(blob, x, y, w, h);
      return { kind: 'bitmap', width: b.width, height: b.height, bitmap: b };
    },
    close: () => {},
  };
}

/** @param {data.PhotoItem} p @param {string} token @returns {Promise<Original>} */
function engineSource(p, token) {
  const worker = new Worker('/apps/photos/edit/engine-worker.js', { type: 'module' });
  /** @type {Map<number, (m: any) => void>} */
  const waiting = new Map();
  let n = 0;
  return new Promise((resolve, reject) => {
    /** @type {any} */
    let meta = null;
    worker.onmessage = ({ data: m }) => {
      if (m.type === 'meta') meta = m.meta;
      else if (m.type === 'working') {
        resolve({
          source: { kind: 'planar', width: m.width, height: m.height, data: m.data },
          raw: true,
          width: meta.width,
          height: meta.height,
          asShot: meta.whiteXy,
          camera: meta.camera,
          fallback: meta.matrixIsFallback,
          memory: m.memory,
          ms: m.ms,
          tile: (x, y, w, h) => new Promise((ok, no) => {
            const id = ++n;
            waiting.set(id, (r) => (r.type === 'tile' ? ok({ kind: 'planar', width: r.width, height: r.height, data: r.data }) : no(new Error(r.message))));
            worker.postMessage({ type: 'tile', id, x, y, w, h });
          }),
          close: () => worker.terminate(),
        });
      } else if (m.id && waiting.has(m.id)) {
        waiting.get(m.id)?.(m);
        waiting.delete(m.id);
      } else if (m.type === 'error') {
        worker.terminate();
        reject(new Error(m.message));
      }
    };
    worker.onerror = (e) => { worker.terminate(); reject(new Error(e.message || 'the engine stopped')); };
    // DNG decodes whole, so its arena is made big enough for the working copy too (lib.rs).
    const reserve = p.format === 'dng' && p.width && p.height ? Math.ceil(p.width / 2) * Math.ceil(p.height / 2) * 6 : 0;
    worker.postMessage({ type: 'open', url: mediaUrl(/** @type {string} */ (p.drive_id)), auth: `Bearer ${token}`, size: p.bytes, scale: 2, reserve });
  });
}

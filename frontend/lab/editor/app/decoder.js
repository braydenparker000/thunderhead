// @ts-check
// The decoder's thread (engine/decode-worker.js), shared by all that need it: the session opens a photo on it, an
// export has its JPEG bands encoded on it, a stack reads its frames with it (stack.js). One thread, one copy of the
// decoder in memory. Every request carries a tag of its own and hears only the answers that carry it.

let worker = /** @type {Worker | null} */ (null), asked = 0;
const waiting = /** @type {Map<string, () => void>} */ (new Map());   // each request not yet answered in full: what to do should the thread fall over
/** Asks the decoder. `hear` is given each answer to this request, and says true once it has heard the last.
 * @param {Record<string, any>} msg @param {Transferable[]} give @param {(answer: any) => boolean} hear */
export function ask(msg, give, hear) {
  warm(); const to = /** @type {Worker} */ (worker), tag = `q${++asked}`;
  const on = (/** @type {MessageEvent} */ m) => { if (m.data.tag === tag && hear(m.data)) { to.removeEventListener('message', on); waiting.delete(tag); } };
  waiting.set(tag, () => { to.removeEventListener('message', on); waiting.delete(tag); hear({ error: 'The decoder stopped. Try again.', tag }); });
  to.addEventListener('message', on); to.postMessage({ ...msg, tag }, give);
}
/** Starts the decoder before a photo asks for it: its code, its WebAssembly and its threads take a while the
 * first time, and the Library is on screen meanwhile. */
export const warm = () => {
  if (worker) return;
  const w = worker = new Worker(new URL('../../engine/decode-worker.js', import.meta.url), { type: 'module' });
  // The thread itself fell over (out of memory on a large RAF, most likely): everything still waiting on it is
  // told, where it would wait for ever, and the next request starts a new thread.
  w.addEventListener('error', (e) => { console.warn('decoder stopped', e.message); if (worker === w) worker = null; w.terminate(); for (const fail of [...waiting.values()]) fail(); });
};
/** One band of an export's JPEG, encoded on the decoder's thread (the engine's files.js asks).
 * @param {Uint8Array} rgb @param {number} w @param {number} h @param {number} quality @param {boolean} fine @returns {Promise<Uint8Array>} */
export const jpegBand = (rgb, w, h, quality, fine) => new Promise((res, rej) => ask({ jpeg: [rgb, w, h, quality, fine] }, [rgb.buffer], (d) => { if (d.jpeg) res(d.jpeg); else rej(new Error(d.error)); return true; }));
/** A RAF decoded whole: what the camera's settings line says, the editing copy with what the engine needs to
 * know of it, and the sensor's own pixels (null for a sensor full size is not offered for).
 * @param {ArrayBuffer} buf the RAF; it is given away
 * @returns {Promise<{ meta: any, width: number, height: number, proxy: Uint16Array, mosaic: Uint16Array | null, dr: number, settings: string }>} */
export const frame = (buf) => new Promise((res, rej) => {
  let got = /** @type {any} */ (null), dr = 100, settings = '';
  ask({ buf, full: true }, [buf], (d) => {
    if (d.error) { rej(new Error(d.error)); return true; }
    if (d.preview) { dr = d.dr || 100; settings = d.settings || ''; return false; }
    if (d.mosaic) { res({ ...got, mosaic: d.mosaic, dr, settings }); return true; }
    got = d;
    if (d.meta.cfaWidth !== 6) { res({ ...got, mosaic: null, dr, settings }); return true; }
    return false;
  });
});

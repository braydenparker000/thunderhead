// @ts-check
// The export's JPEG encoder in a worker (export-run.js, jpeg.js): it takes the rendered photo a band
// of rows at a time and keeps only the compressed bytes, handed back as one Blob at the end.
import { jpegEncoder } from './jpeg.js';

const post = /** @type {(m: unknown) => void} */ (/** @type {any} */ (self).postMessage.bind(self));
/** @type {ReturnType<typeof jpegEncoder> | null} */
let enc = null;
/** @type {Uint8Array[]} */
let parts = [];
self.onmessage = (/** @type {MessageEvent} */ ev) => {
  const m = ev.data;
  try {
    if (m.type === 'start') { enc = jpegEncoder(m); parts = [enc.head()]; post({ type: 'started' }); }
    else if (m.type === 'rows' && enc) { parts.push(enc.rows(m.rgba, m.n)); post({ type: 'rows' }); }
    else if (m.type === 'finish' && enc) {
      parts.push(enc.finish());
      const blob = new Blob(/** @type {BlobPart[]} */ (parts), { type: 'image/jpeg' });
      parts = [];
      enc = null;
      post({ type: 'done', blob });
    }
  } catch (e) {
    post({ type: 'error', message: /** @type {Error} */ (e)?.message ?? String(e) });
  }
};

// @ts-check
// One picked file to the Worker (`PUT /v1/files/:id`, API.md §11.7), with its SHA-256 and its
// progress as it goes: XHR, because fetch can't report an upload's progress. The id was fixed when
// the file was picked, so a retry after a dropped connection gets the same record back. Errors are
// the API client's, so the outbox treats them as it treats a message's.
import { ApiError } from '../api.js';
import { api } from '../client.js';

/** @typedef {import('./state.js').LocalFile} LocalFile */
/** @typedef {import('../../../shared/contract/api.ts').Attachment} Attachment */

/** @param {Blob} blob */
export async function sha256(blob) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Every upload's progress, for the rings on the bubbles: `th:upload` with `{ id, p }` (0–1). */
const progress = (/** @type {string} */ id, /** @type {number} */ p) => document.dispatchEvent(new CustomEvent('th:upload', { detail: { id, p } }));

/** @param {string} token @param {LocalFile} f @returns {Promise<Attachment>} */
export async function upload(token, f) {
  const sum = await sha256(f.blob);
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('PUT', `${api.base}/v1/files/${encodeURIComponent(f.id)}`);
    x.timeout = 300_000;
    x.setRequestHeader('Authorization', `Bearer ${token}`);
    x.setRequestHeader('TH-Client', api.client);
    x.setRequestHeader('Content-Type', f.type);
    x.setRequestHeader('TH-File-Name', encodeURIComponent(f.name.slice(0, 120)));
    x.setRequestHeader('TH-Sha256', sum);
    if (f.seconds) x.setRequestHeader('TH-Seconds', String(Math.max(1, Math.round(f.seconds))));
    x.upload.addEventListener('progress', (e) => e.lengthComputable && progress(f.id, e.loaded / e.total));
    x.addEventListener('load', () => {
      /** @type {any} */
      let data = null;
      try {
        data = JSON.parse(x.responseText);
      } catch {}
      if (x.status >= 200 && x.status < 300 && data?.ref) {
        progress(f.id, 1);
        resolve(data);
      } else reject(new ApiError(x.status, data?.error ?? { code: 'unavailable', message: `HTTP ${x.status}`, request_id: '' }));
    });
    // Like fetch's: a dropped connection is a TypeError, which the outbox retries.
    const lost = () => reject(new TypeError('upload failed'));
    x.addEventListener('error', lost);
    x.addEventListener('timeout', lost);
    x.addEventListener('abort', lost);
    progress(f.id, 0);
    x.send(f.blob);
  });
}

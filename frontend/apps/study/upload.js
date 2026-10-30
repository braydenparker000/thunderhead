// @ts-check
// Adding a book (STUDY.md §3.1): a PDF of at most 500 MB is sent in parts of exactly the size the
// Worker names (50 MiB but the last), each tried up to four times (waits of 1 s, 5 s, 15 s), then
// completed. A part already received is never sent again, so Resume (after a failure, or after the
// page was closed and the same file picked again) sends only what is missing. Progress counts
// bytes, from each part's own upload events.
import { signedIn } from '/th/client.js';
import { CONFIG } from '/config.js';
import { sendParts as send } from './parts.js';

export { MAX_BYTES, partsOf, refuse, retriable, titleFor, WAITS } from './parts.js';

const BASE = CONFIG.api.replace(/\/+$/, '');
const CLIENT = `${CONFIG.build}.${String(CONFIG.commit).slice(0, 7)}`;

/**
 * One part through XMLHttpRequest, for its upload progress.
 * @param {string} bookId @param {number} n @param {Blob} bytes @param {(sent: number) => void} onSent
 * @returns {Promise<{ n: number, parts: number[] }>}
 */
export function putPart(bookId, n, bytes, onSent) {
  return signedIn(
    (token) =>
      new Promise((resolve, reject) => {
        const x = new XMLHttpRequest();
        x.open('PUT', `${BASE}/v1/library/books/${encodeURIComponent(bookId)}/parts/${n}`);
        x.setRequestHeader('Authorization', `Bearer ${token}`);
        x.setRequestHeader('TH-Client', CLIENT);
        x.setRequestHeader('Content-Type', 'application/octet-stream');
        x.upload.onprogress = (e) => onSent(e.loaded);
        x.onerror = x.ontimeout = () => reject(Object.assign(new Error('network'), { status: 0 }));
        x.onload = () => {
          let data = null;
          try {
            data = JSON.parse(x.responseText);
          } catch {}
          if (x.status >= 200 && x.status < 300) resolve(data);
          else reject(Object.assign(new Error(data?.error?.code ?? `HTTP ${x.status}`), { status: x.status, code: data?.error?.code ?? 'unavailable' }));
        };
        x.send(bytes);
      }),
  );
}

/** Sends every part not yet received, through `putPart`.
 * @param {Omit<Parameters<typeof send>[0], 'put'>} o */
export const sendParts = (o) => send({ ...o, put: putPart });

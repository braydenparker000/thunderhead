// The Forgets that haven't reached the Worker yet (MEMORY.md §12), by id only, never a fact's text,
// in this phone's storage under `th.p.forget`: one survives the page closing, the app being swiped
// away or a failed request, and goes again the next time the Memory page or Home opens. Home loads
// this module only when the list holds something.
import { api, signedIn } from '/th/client.js';
import { uuidv7 } from '/th/chat/model.js';

export const KEY = 'th.p.forget';

/** @returns {string[]} */
export function pendingIds() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** @param {string[]} ids */
function save(ids) {
  try {
    if (ids.length) localStorage.setItem(KEY, JSON.stringify([...new Set(ids)]));
    else localStorage.removeItem(KEY);
  } catch {}
}

/** @param {string} id */
export const remember = (id) => save([...pendingIds(), id]);
/** @param {string} id */
export const settled = (id) => save(pendingIds().filter((x) => x !== id));

/** The Worker no longer has the fact (forgotten already, or never there): nothing left to send. */
export const gone = (/** @type {any} */ e) =>
  e?.status === 422 && Array.isArray(e?.details) && e.details.some((/** @type {any} */ d) => d?.issue === 'unknown_ref');

/** One Forget. With `keepalive` it is started in the caller's own tick (nothing awaited first),
 * so it still goes out while the page unloads; `token` is then the one read when the page opened.
 * @param {string} token @param {string} id @param {boolean} keepalive */
export const sendForget = (token, id, keepalive) => api.memoryOps(token, uuidv7(), [{ op: 'forget', id }], keepalive);

/** Sends every id still on the list, oldest first; one the Worker took, or no longer has, leaves
 * it. Stops at the first other failure (offline): the next open tries again. */
export async function flush() {
  for (const id of pendingIds()) {
    try {
      await signedIn((t) => sendForget(t, id, false));
      settled(id);
    } catch (e) {
      if (!gone(e)) return;
      settled(id);
    }
  }
}

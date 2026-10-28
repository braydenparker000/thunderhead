// @ts-check
// This device's session: kept in IndexedDB `th-auth` (never a cookie, never localStorage), read
// only by a top-level page (frame guard, SECURITY.md §4.3), and wiped in the order of
// SIGN-IN.md §11.3 when the owner signs out or the server says this device is signed out.

import { kv } from './idb.js';

/** @typedef {import('./flow.js').Session} Session */

const auth = kv('th-auth');
/** One channel per page for both directions: a channel never hears its own messages, so the tab
 * that wipes doesn't also react to its own `signed_out`. */
let channel = /** @type {BroadcastChannel | null} */ (null);
const tabs = () => {
  try {
    channel ??= new BroadcastChannel('th-auth');
  } catch {}
  return channel;
};
/** Cache Storage caches that hold only code and survive a sign-out: `th-<build>` and `th-vendor`. */
const CODE_CACHE = /^th-(\d+|vendor)$/;

const top = () => {
  try {
    return window.top === window.self;
  } catch {
    return false;
  }
};

export const store = {
  /** @returns {Promise<Session | null>} */
  async read() {
    if (!top()) return null;
    try {
      const s = await auth.get('session');
      return s && typeof s.token === 'string' ? s : null;
    } catch {
      return null;
    }
  },
  /** @param {Session} s */
  async write(s) {
    if (!top()) throw new Error('framed');
    await auth.set('session', s);
    try {
      await navigator.storage?.persist?.();
    } catch {}
  },
};

/** A sign-out that couldn't reach the server keeps only its token until it can (§11.3). */
export const pending = {
  /** @returns {Promise<string | null>} */
  async get() {
    try {
      return (await auth.get('pending_signout')) ?? null;
    } catch {
      return null;
    }
  },
  /** @param {string} token */
  set: (token) => auth.set('pending_signout', token),
  clear: () => auth.del('pending_signout'),
};

/** Removes every private thing this device holds; app code and `th.ui.` choices stay (§11.3). */
export async function wipe() {
  // 1. Audio, capture and Media Session belong to the apps; they listen for `signed_out` below.
  // 2. Push subscription.
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    const sub = await reg?.pushManager?.getSubscription();
    await sub?.unsubscribe();
  } catch {}
  // 3. IndexedDB.
  await Promise.all([auth.drop(), kv('th-data').drop()]);
  // 4. Cache Storage, except code caches.
  try {
    for (const name of await caches.keys()) if (!CODE_CACHE.test(name)) await caches.delete(name);
  } catch {}
  // 5. The Origin Private File System (offline songs, downloads, PDFs).
  try {
    const root = await navigator.storage.getDirectory();
    /** @type {string[]} */
    const names = [];
    for await (const name of /** @type {any} */ (root).keys()) names.push(name);
    for (const name of names) await root.removeEntry(name, { recursive: true });
  } catch {}
  // 6. Personal localStorage keys.
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith('th.p.')) localStorage.removeItem(key);
  } catch {}
  // 7. Other tabs and the service worker.
  try {
    tabs()?.postMessage('signed_out');
  } catch {}
  try {
    navigator.serviceWorker?.controller?.postMessage({ k: 'signed_out' });
  } catch {}
}

/** Runs `then` when another tab signs out. @param {() => void} then */
export function onSignedOut(then) {
  tabs()?.addEventListener('message', (e) => {
    if (e.data === 'signed_out') then();
  });
}

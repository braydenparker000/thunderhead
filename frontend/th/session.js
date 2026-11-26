// @ts-check
// This device's session: kept in IndexedDB `th-auth` (never a cookie, never localStorage), read
// only by a top-level page (frame guard, SECURITY.md §4.3), and wiped in the order of
// SIGN-IN.md §11.3 at a sign-out here or one the server reports.

import { kv, sealed } from './idb.js';
import { keepsFor, keepUnsent, settle, sweep } from './kept.js';

/** @typedef {import('./flow.js').Session} Session */

const auth = kv('th-auth');
/** One channel per page, both ways: it never hears its own messages, so the wiping tab ignores
 * its own `signed_out`. */
let channel = /** @type {BroadcastChannel | null} */ (null);
const tabs = () => {
  try {
    channel ??= new BroadcastChannel('th-auth');
  } catch {}
  return channel;
};
/** Kept at sign-out: code (`th-<build>`, `th-vendor`) and Music's catalogue (th/music/bridge.js), which holds
 * nothing its phone-only snapshot (its `r2:` records) does not keep; wiped, a sign-in paid ~35 MB for it again. */
const KEPT_CACHE = /^th-(\d+|vendor|music-catalog)$/;
/** The ported apps' stores the account also holds (SIGN-IN.md §11.3): Podcasts' positions and follows
 * (and its feeds, Up Next and speed, which the account keeps too), Guitar's library and practice
 * (th/guitar/progress.js; its ladder is `th.p.guitar.ladder`), Music's taste weights. What lives only on
 * this phone stays: `claude-player`, `cp-*`, `th.music.dj`, `mymedia.*`, `th-report`, `th-setup`,
 * `th-recover`. */
const SYNCED_KEYS = ['jarvis.podcasts.v1', 'jarvis.guitar.library.v1', 'th.music.taste'];
/** Guitar's store loses its songs, practice log and searches; its preferences (instrument, sound, tab
 * size, this phone's latency) are settings of the phone, like `th.s.*`, and stay. */
const GUITAR = 'jarvis.guitar.v2';
function wipeGuitar() {
  let prefs;
  try { prefs = JSON.parse(localStorage.getItem(GUITAR) || 'null')?.prefs; } catch {}
  if (prefs && typeof prefs === 'object') localStorage.setItem(GUITAR, JSON.stringify({ prefs }));
  else localStorage.removeItem(GUITAR);
}

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
    await settle(s.username); // what a forced sign-out kept, back to the same owner only (th/kept.js)
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

/** Set once a sign-out by hand has begun in this page: from then on nothing is kept and `th-kept` takes no write. */
let byHand = false;
/** Marks a sign-out by hand, before its request is sent (th/client.js signOutHere, Settings' "Sign out everywhere"). */
export function signingOut() {
  byHand = true;
  sealed.add('th-kept');
}

/** The wipe in flight, and whether it is one by hand: one at a time. */
let inflight = /** @type {Promise<void> | null} */ (null);
let inflightHand = false;

/** Removes every private thing this device holds; app code and `th.ui.` choices stay (§11.3). With a `reason`
 * it is a sign-out the server reported (the /signin/ reason): for `expired` and `unauthorized` only, the owner's
 * unsent outbox and draft are copied to `th-kept` first (th/kept.js). One wipe at a time: a second reported one
 * shares the one in flight; a sign-out by hand always wins, running after whatever is in flight and dropping
 * anything kept. @param {{ reason?: string }} [opts] */
export function wipe(opts = {}) {
  const hand = !opts.reason;
  if (hand) signingOut();
  if (inflight && (!hand || inflightHand)) return inflight;
  const run = (inflight ?? Promise.resolve()).catch(() => {}).then(() => wipeNow(hand ? null : opts.reason ?? null));
  inflightHand = hand;
  const p = (inflight = run.finally(() => { if (inflight === p) inflight = null; }));
  return p;
}

/** @param {string | null} reason */
async function wipeNow(reason) {
  sealed.add('th-data'); // an outbox write still in flight in this page must not make it again
  if (!byHand && keepsFor(reason)) await keepUnsent(await store.read()).catch(() => {});
  // 1. Audio, capture and Media Session belong to the apps; they listen for `signed_out` below.
  // 2. Push subscription.
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    const sub = await reg?.pushManager?.getSubscription();
    await sub?.unsubscribe();
  } catch {}
  // 3. IndexedDB.
  // `th-study`: Study's covers, places and uploads (STUDY.md §2.1); `th-photos`: the shelf kept offline;
  // `jarvis-podcasts`: Podcasts' feeds.
  // `th-kept`: the unsent work a reported sign-out kept (th/kept.js), dropped by a sign-out by hand; a reported one
  // leaves it (one in another tab, which reads no session or no outbox, must not drop what the first kept).
  const dbs = ['th-data', 'th-study', 'th-photos', 'jarvis-podcasts', ...(byHand ? ['th-kept'] : [])];
  await Promise.all([auth.drop(), ...dbs.map((n) => kv(n).drop())]);
  // 4. Cache Storage, except the kept caches.
  try {
    for (const name of await caches.keys()) if (!KEPT_CACHE.test(name)) await caches.delete(name);
  } catch {}
  // 5. The Origin Private File System (offline songs, downloads, PDFs).
  try {
    const root = await navigator.storage.getDirectory();
    /** @type {string[]} */
    const names = [];
    for await (const name of /** @type {any} */ (root).keys()) names.push(name);
    for (const name of names) await root.removeEntry(name, { recursive: true });
  } catch {}
  // 6. Personal localStorage keys, the ported apps' synced ones, and Astra's (astra/wipe.js).
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith('th.p.') || SYNCED_KEYS.includes(key)) localStorage.removeItem(key);
    wipeGuitar();
    (await import('./astra/wipe.js')).wipeAstra();
  } catch {}
  // 7. Other tabs and the service worker.
  try {
    tabs()?.postMessage('signed_out');
  } catch {}
  try {
    navigator.serviceWorker?.controller?.postMessage({ k: 'signed_out' });
  } catch {}
}

// A kept record older than 30 days goes unread at each start of a page that loads this (th/kept.js).
if (top()) sweep().catch(() => {});

/** Runs `then` when another tab signs out. @param {() => void} then */
export function onSignedOut(then) {
  tabs()?.addEventListener('message', (e) => {
    if (e.data === 'signed_out') then();
  });
}

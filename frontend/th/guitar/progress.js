// @ts-check
// Guitar's progress on the Worker (GUITAR.md §1.1), modelled on Podcasts' (th/podcasts/progress.js):
// one record per song, so the library entry (status, star, where it was left, speed, best, practice
// seconds), the tempo ladder's sections (`th.p.guitar.ladder`, th/guitar/practice.js) and the
// practice seconds by day follow the owner to another phone, and come back after a sign-out (which
// clears the ladder). Started by the ported app with its live store (frontend/guitar/app.js), so
// what it takes goes through the store and is never written over by it:
// - when Guitar opens and when it is shown again, what the Worker took since the last time
//   (GET /v1/guitar/progress?since=) is merged song by song, the newer `updated_at` winning: a song
//   newer on this phone stays (only ladder sections it lacks are added); a phone with nothing gets
//   everything;
// - after a change (debounced, 20 s), on hiding the page (`keepalive` for a small body) and when the
//   network returns, the songs changed since the last push go up (PUT, ≤ 50 and < 60 KB a request):
//   one record each, so at most one write a song.
// Each song's `updated` is the store's stamp on the phone's clock; the Worker's answers carry its
// clock, so times go up on the Worker's (`offset`, as Podcasts keeps it) and come back onto the
// phone's. Each record also carries the phone's own stamp (`phone_at`): a record this phone saved
// is known again by it, so after a sign-out the same version brings its ladder back. Kept-offline tab
// files are not synced (they can be fetched again). Only signed in, and in a top-level page or one of
// home's own frames. What it remembers is `th.p.guitar.sync`, cleared on sign-out.
import { CONFIG } from '../../config.js';
import { framedByOther, sessionToken } from '../ported/session.js';
import { cleanLadder } from './ladder.js';
import { ladderOf, saveLadder } from './practice.js';

/** The Worker's limits this module keeps to (GUITAR_LIMITS in shared/contract/guitar.ts;
 * tests/guitar-progress.test.mjs checks they agree). */
export const L = Object.freeze({ batch_items: 50, sections_max: 24, days_max: 400 });

export const SYNC_KEY = 'th.p.guitar.sync';
/** A change goes up this long after it was made (more changes meanwhile join it). */
const DEBOUNCE_MS = 20_000;
/** One request's body: under the Worker's 64 KB limit. */
const BODY_BYTES = 60_000;
/** A body this small goes as keepalive, so it outlives a page that is closing. */
const KEEPALIVE_BYTES = 8_000;
/** Pages read at most (100 records each; the Worker keeps 1,000). */
const PAGES = 11;

/** `since`: the Worker's `next_since` of the last pull. `sent`: per song, the store's `updated`
 * (phone clock) of the version the Worker has. `offset`: the Worker's clock minus the phone's, ms.
 * @typedef {{ v: 1, since: number, sent: Record<string, number>, offset?: number }} Memory */
/** @typedef {import('../../../shared/contract/guitar.ts').GuitarProgress} Progress */
/** The ported store (frontend/guitar/store.js) as this module uses it.
 * @typedef {{ song: (key: string) => any, songs: () => any[], days: (key: string) => Record<string, number>,
 *   take: (key: string, song: any, days: Record<string, number>, at: number) => void, subscribe: (fn: () => void) => unknown }} Store */

export const deps = {
  /** @type {typeof fetch} */
  fetch: (...a) => fetch(...a),
  now: () => Date.now(),
  storage: () => /** @type {Storage} */ (localStorage),
  token: sessionToken,
  framed: framedByOther,
  api: () => CONFIG.api,
  online: () => navigator.onLine,
};

/** @param {Storage} storage @returns {Memory} */
export function loadMemory(storage) {
  try {
    const m = JSON.parse(storage.getItem(SYNC_KEY) || 'null');
    if (m?.v === 1 && m.sent && typeof m.sent === 'object') return m;
  } catch {}
  return { v: 1, since: 0, sent: {} };
}
/** @param {Storage} storage @param {Memory} mem */
function saveMemory(storage, mem) {
  try {
    storage.setItem(SYNC_KEY, JSON.stringify(mem));
  } catch {}
}

/** The Worker's clock minus the phone's, from an answer that left at `t0` and came back at `t1`.
 * @param {Memory} mem @param {unknown} at @param {number} t0 @param {number} t1 */
export function setOffset(mem, at, t0, t1) {
  if (Number.isFinite(Number(at)) && Number(at) > 0) mem.offset = Math.round(Number(at) - (t0 + t1) / 2);
}

/** The Worker's records into the store and the ladder where they are newer than this phone's (on
 * the Worker's clock), or are this phone's own save (`phone_at`). Returns how many were taken.
 * @param {Store} store @param {Storage} storage @param {Memory} mem @param {Progress[]} items */
export function apply(store, storage, mem, items) {
  const offset = mem.offset ?? 0;
  let n = 0;
  for (const p of items) {
    if (!p || typeof p.key !== 'string') continue;
    const here = Number(store.song(p.key)?.updated) || 0;
    const own = here > 0 && p.phone_at === here;
    const remote = cleanLadder(p.ladder);
    if (here && !own && here + offset >= p.updated_at) {
      // This phone's is newer: it stays, and goes up at the next push; sections only the Worker
      // has (a ladder cleared by a sign-out) are added to it.
      const local = ladderOf(storage, p.key);
      const missing = Object.keys(remote).filter((k) => !(k in local));
      if (missing.length) saveLadder(storage, null, p.key, { ...Object.fromEntries(missing.map((k) => [k, remote[k]])), ...local });
      continue;
    }
    const at = own ? here : Math.round(p.updated_at - offset);
    mem.sent[p.key] = at;
    saveLadder(storage, null, p.key, remote);
    store.take(p.key, p.song, p.days && typeof p.days === 'object' ? p.days : {}, at);
    n++;
  }
  return n;
}

/** The songs changed since the Worker last had them, as records on the Worker's clock.
 * @param {Store} store @param {Storage} storage @param {Memory} mem @returns {Progress[]} */
export function toSend(store, storage, mem) {
  const offset = mem.offset ?? 0;
  /** @type {Progress[]} */
  const out = [];
  for (const s of store.songs()) {
    const at = Math.round(Number(s?.updated) || 0);
    if (at <= 0 || (mem.sent[s.key] ?? 0) >= at) continue;
    const { updated: _, ...song } = s;
    const days = Object.entries(store.days(s.key)).sort(([a], [b]) => (a < b ? 1 : -1)).slice(0, L.days_max);
    out.push({ key: s.key, song, ladder: cleanLadder(ladderOf(storage, s.key)), days: Object.fromEntries(days), phone_at: at, updated_at: at + offset });
  }
  return out;
}

/** Requests of at most `batch_items` items and BODY_BYTES. @template T @param {T[]} items @returns {T[][]} */
export function chunks(items) {
  /** @type {T[][]} */
  const out = [];
  let cur = /** @type {T[]} */ ([]);
  let bytes = 20;
  for (const it of items) {
    const size = JSON.stringify(it).length + 1;
    if (cur.length && (cur.length >= L.batch_items || bytes + size > BODY_BYTES)) {
      out.push(cur);
      cur = [];
      bytes = 20;
    }
    cur.push(it);
    bytes += size;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** @type {string | null} */
let token = null;
const tokenOf = async () => (token ??= deps.framed() ? null : await deps.token());

/** @param {string} method @param {string} query @param {string} t @param {unknown} [body] */
async function call(method, query, t, body) {
  const text = body === undefined ? undefined : JSON.stringify(body);
  try {
    const r = await deps.fetch(`${deps.api()}/v1/guitar/progress${query}`, {
      method,
      headers: { Authorization: `Bearer ${t}`, ...(text ? { 'Content-Type': 'application/json' } : {}) },
      body: text,
      keepalive: Boolean(text && text.length < KEEPALIVE_BYTES),
      credentials: 'omit',
      mode: 'cors',
      cache: 'no-store',
    });
    if ([401, 403].includes(r.status)) token = null;
    return r;
  } catch {
    return null;
  }
}

/** What changed since the last pull, merged into the store. @param {Store} store */
async function pullNow(store) {
  const t = deps.api() && deps.online() ? await tokenOf() : null;
  if (!t) return;
  const storage = deps.storage();
  const mem = loadMemory(storage);
  /** @type {Progress[]} */
  const items = [];
  let q = `?since=${mem.since}`;
  for (let page = 0; page < PAGES; page++) {
    const t0 = deps.now();
    const r = await call('GET', q, t);
    if (!r?.ok) return;
    const b = await r.json();
    setOffset(mem, b.next_since, t0, deps.now());
    items.push(...(Array.isArray(b.items) ? b.items : []));
    if (!b.next) {
      // Read again: a push may have finished meanwhile (its stamps are kept).
      const latest = loadMemory(storage);
      for (const [k, at] of Object.entries(latest.sent)) mem.sent[k] = Math.max(mem.sent[k] ?? 0, at);
      apply(store, storage, mem, items);
      mem.since = Number(b.next_since) || mem.since;
      saveMemory(storage, mem);
      return;
    }
    q = `?cursor=${encodeURIComponent(b.next)}`;
  }
}

/** The changed songs up; a song the Worker refused stays unsent, for next time. @param {Store} store */
async function pushNow(store) {
  const t = deps.api() && deps.online() ? await tokenOf() : null;
  if (!t) return;
  const storage = deps.storage();
  const mem = loadMemory(storage);
  // Not before a pull has come back since this memory began (after a sign-out it is gone): until
  // then the clock's offset is unknown, and this phone's own records are not known again yet.
  if (!mem.since) return;
  for (const batch of chunks(toSend(store, storage, mem))) {
    const t0 = deps.now();
    const r = await call('PUT', '', t, { items: batch });
    if (!r?.ok) break;
    let refused;
    try {
      const b = await r.json();
      setOffset(mem, b.at, t0, deps.now());
      refused = new Set((Array.isArray(b.refused) ? b.refused : []).map((/** @type {{ index: number }} */ x) => x.index));
    } catch {
      break;
    }
    batch.forEach((p, i) => {
      if (!refused.has(i)) mem.sent[p.key] = Math.max(mem.sent[p.key] ?? 0, p.phone_at);
    });
  }
  const latest = loadMemory(storage);
  for (const [k, at] of Object.entries(latest.sent)) mem.sent[k] = Math.max(mem.sent[k] ?? 0, at);
  mem.since = Math.max(mem.since, latest.since);
  mem.offset ??= latest.offset;
  // What it remembers stays small: only songs the library still keeps.
  const keys = new Set(store.songs().map((s) => s.key));
  for (const k of Object.keys(mem.sent)) if (!keys.has(k)) delete mem.sent[k];
  saveMemory(storage, mem);
}

/** One at a time each way, and once more if asked meanwhile. @param {(s: Store) => Promise<void>} fn */
function serial(fn) {
  /** @type {Promise<void> | null} */
  let running = null;
  let again = false;
  /** @param {Store} store @returns {Promise<void>} */
  const go = (store) => {
    if (running) {
      again = true;
      return running;
    }
    running = fn(store)
      .catch(() => {})
      .finally(() => {
        running = null;
        if (again) {
          again = false;
          void go(store);
        }
      });
    return running;
  };
  return go;
}
export const pull = serial(pullNow);
export const push = serial(pushNow);

/** For tests: forget the token. */
export function reset() {
  token = null;
}

let started = false;
/** Guitar opened: a pull now, then the pushes and pulls above. Once a page. @param {Store} store */
export function start(store) {
  if (started) return;
  started = true;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  const soon = () => {
    if (timer === undefined) timer = setTimeout(() => ((timer = undefined), void push(store)), DEBOUNCE_MS);
  };
  const now = () => {
    clearTimeout(timer);
    timer = undefined;
    void push(store);
  };
  // Changes the store makes when it takes a record are not this phone's: `sent` already has them.
  store.subscribe(soon);
  document.addEventListener('visibilitychange', () => (document.hidden ? now() : void pull(store)));
  addEventListener('pagehide', now);
  addEventListener('online', now);
  void pull(store).then(() => push(store));
}

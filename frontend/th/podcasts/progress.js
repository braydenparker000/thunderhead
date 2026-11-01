// @ts-check
// Podcasts' progress on the Worker (NEXT-BATCH.md part 7, PODCASTS.md §5.4), for the ported app,
// which keeps where each episode was left and the shows it follows in its own storage
// (`jarvis.podcasts.v1`, podcasts/core.js) and is otherwise unchanged. Its one recorded edit loads
// this module and waits for `opened(by)` before it reads that storage, at most 1.5 s (`by` is when
// it stops waiting, in the page's time):
// - on open, what the Worker took since the last time (GET /v1/podcasts/progress?since=) is merged
//   into the app's storage before the app reads it, the newer `updatedAt` winning, so an episode
//   left on another phone resumes where it was. A pull that comes back at `by` or later is not
//   applied (the app has read its storage then, and would write over it); `since` stays, so the
//   next open brings it;
// - then, and on pause, on hiding the page, every 60 s while an episode plays and when the network
//   returns, the positions the Worker doesn't have yet go up (PUT, ≤ 100 and < 60 KB a request),
//   and so do the follows and unfollows since the last time (PUT /v1/podcasts/follows), so the night
//   knows the shows. Follows go up only: a second copy of the app open on this phone (another tab)
//   can write its older list over the storage, and taking a show missing from it as an unfollow is
//   right only for what this phone's app shows, never for what came from another phone.
// Only signed in, and in a top-level page or one of home's own frames (th/ported/session.js). What
// this module remembers (what the Worker has, and since when it last asked) is `th.p.podcasts.sync`,
// cleared on sign-out with the rest of `th.p.*` (th/session.js).
import { CONFIG } from '../../config.js';
import { PODCAST_LIMITS as L } from '../contract.js';
import { framedByOther, sessionToken } from '../ported/session.js';

/** The app's storage (podcasts/core.js `STORAGE_KEY`) and this module's. */
export const APP_KEY = 'jarvis.podcasts.v1';
export const SYNC_KEY = 'th.p.podcasts.sync';
const EVERY_MS = 60_000;
/** One request's body: under the Worker's 64 KB limit. */
const BODY_BYTES = 60_000;
/** A body this small goes as keepalive, so it outlives a page that is closing (the browser allows
 * 64 KB of those in flight for all the page's requests; a sync while playing is one or two items). */
const KEEPALIVE_BYTES = 8_000;
/** Pages read on open, at most (3,000 rows; the Worker keeps 1,000 positions). */
const PAGES = 6;
const UNFOLLOW_MEMORY_MS = L.unfollowed_keep_days * 86_400_000;

/** @typedef {{ position?: number, duration?: number, played?: boolean, updatedAt?: number, episode?: unknown }} Entry */
/** @typedef {{ progress: Record<string, Entry>, follows: { feedUrl: string, title?: string, author?: string, artwork?: string }[], [k: string]: unknown }} App */
/** @typedef {{ followed: boolean, at: number, sent: boolean, title: string, author: string, artwork: string }} Known */
/** @typedef {{ v: 1, since: { progress: number }, sent: Record<string, number>, follows: Record<string, Known> }} Memory */
/** @typedef {import('../../../shared/contract/podcasts.ts').PodcastProgress} Progress */
/** @typedef {import('../../../shared/contract/podcasts.ts').PodcastFollow} Follow */

export const deps = {
  /** @type {typeof fetch} */
  fetch: (...a) => fetch(...a),
  now: () => Date.now(),
  /** Ms since the page began. */
  sincePage: () => performance.now(),
  storage: () => /** @type {Storage} */ (localStorage),
  token: sessionToken,
  framed: framedByOther,
  api: () => CONFIG.api,
  online: () => navigator.onLine,
};

/** Why a key is refused, or null (the Worker's `progressKeyProblem`, shared/contract/podcasts.ts).
 * @param {string} key */
export function keyProblem(key) {
  const cut = key.lastIndexOf('#');
  if (cut < 1) return 'not <feed address>#<episode id>';
  if (!new RegExp(`^[A-Za-z0-9_-]{1,${L.id_chars}}$`).test(key.slice(cut + 1))) return 'an episode id of letters and digits';
  return feedProblem(key.slice(0, cut));
}
/** @param {string} url */
export function feedProblem(url) {
  if (url.length > L.url_chars) return `a feed address of at most ${L.url_chars} characters`;
  try {
    const u = new URL(url);
    return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password ? null : 'an http(s) address';
  } catch {
    return 'an http(s) address';
  }
}

/** A position or a length as the Worker takes it: finite, 0 … a week, to 0.1 s. @param {unknown} n */
const seconds = (n) => (Number.isFinite(n) ? Math.round(Math.min(Math.max(Number(n), 0), L.seconds_max) * 10) / 10 : 0);
/** @param {unknown} s @param {number} max */
const text = (s, max) => (typeof s === 'string' ? s.slice(0, max) : '');
/** @param {unknown} url */
const artwork = (url) => (typeof url === 'string' && url && !feedProblem(url) ? url : '');

/** @param {Storage} storage @param {string} key */
function read(storage, key) {
  try {
    return JSON.parse(storage.getItem(key) || 'null');
  } catch {
    return null;
  }
}
/** The app's state, or null when it has none it would read (podcasts/core.js `readState`). @param {Storage} storage @returns {App | null} */
export function loadApp(storage) {
  const s = read(storage, APP_KEY);
  if (s?.version !== 1) return null;
  return { ...s, progress: s.progress && typeof s.progress === 'object' ? s.progress : {}, follows: Array.isArray(s.follows) ? s.follows : [] };
}
/** @param {Storage} storage @returns {Memory} */
export function loadMemory(storage) {
  const m = read(storage, SYNC_KEY);
  return m?.v === 1 ? m : { v: 1, since: { progress: 0 }, sent: {}, follows: {} };
}
/** @param {Storage} storage @param {string} key @param {unknown} value */
function save(storage, key, value) {
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** Remote positions into the app's state where they are newer than its own; the episode's details
 * the app keeps stay. Returns how many changed. @param {App} app @param {Memory} mem @param {Progress[]} items */
export function applyProgress(app, mem, items) {
  let n = 0;
  for (const p of items) {
    const here = app.progress[p.key];
    mem.sent[p.key] = Math.max(mem.sent[p.key] ?? 0, p.updated_at);
    if ((Number(here?.updatedAt) || 0) >= p.updated_at) continue;
    app.progress[p.key] = { ...here, position: p.position_s, duration: p.duration_s, played: p.played, updatedAt: p.updated_at };
    n++;
  }
  return n;
}

/** The app's positions the Worker doesn't have yet. @param {App} app @param {Memory} mem @returns {Progress[]} */
export function progressToSend(app, mem) {
  /** @type {Progress[]} */
  const out = [];
  for (const [key, p] of Object.entries(app.progress)) {
    const at = Math.round(Number(p?.updatedAt) || 0);
    if (at <= 0 || (mem.sent[key] ?? 0) >= at || keyProblem(key)) continue;
    out.push({ key, position_s: seconds(p.position), duration_s: seconds(p.duration), played: Boolean(p.played), updated_at: at });
  }
  return out;
}

/** Follows and unfollows since the last look, stamped now (the app keeps no time for them). Returns
 * how many. @param {App} app @param {Memory} mem @param {number} now */
export function noteFollows(app, mem, now) {
  let n = 0;
  const here = new Map(app.follows.filter((s) => typeof s?.feedUrl === 'string' && !feedProblem(s.feedUrl)).map((s) => [s.feedUrl, s]));
  for (const [url, s] of here) {
    if (mem.follows[url]?.followed) continue;
    mem.follows[url] = { followed: true, at: now, sent: false, title: text(s.title, L.title_chars), author: text(s.author, L.author_chars), artwork: artwork(s.artwork) };
    n++;
  }
  for (const [url, k] of Object.entries(mem.follows)) {
    if (!k.followed || here.has(url)) continue;
    mem.follows[url] = { ...k, followed: false, at: now, sent: false };
    n++;
  }
  return n;
}
/** @param {Memory} mem @returns {Follow[]} */
export const followsToSend = (mem) =>
  Object.entries(mem.follows)
    .filter(([, k]) => !k.sent)
    .map(([feed_url, k]) => ({ feed_url, title: k.title, author: k.author, artwork: k.artwork, followed: k.followed, updated_at: k.at }));

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

/** What it remembers stays small: what the Worker has of positions the app still keeps, and an
 * unfollow for 30 days. @param {App} app @param {Memory} mem @param {number} now */
export function trim(app, mem, now) {
  for (const key of Object.keys(mem.sent)) if (!(key in app.progress)) delete mem.sent[key];
  for (const [url, k] of Object.entries(mem.follows)) if (!k.followed && k.sent && k.at < now - UNFOLLOW_MEMORY_MS) delete mem.follows[url];
}

/** @type {string | null} */
let token = null;
const tokenOf = async () => (token ??= deps.framed() ? null : await deps.token());

/** @param {string} method @param {string} path @param {string} t @param {{ body?: unknown, signal?: AbortSignal }} [o] */
async function call(method, path, t, o = {}) {
  const body = o.body === undefined ? undefined : JSON.stringify(o.body);
  try {
    return await deps.fetch(`${deps.api()}/v1/podcasts/${path}`, {
      method,
      headers: { Authorization: `Bearer ${t}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body,
      signal: o.signal,
      keepalive: Boolean(body && body.length < KEEPALIVE_BYTES),
      credentials: 'omit',
      mode: 'cors',
      cache: 'no-store',
    });
  } catch {
    return null;
  }
}

/** Every page of what changed since `since`, or null. @param {number} since @param {string} t @param {AbortSignal} signal */
async function pull(since, t, signal) {
  /** @type {Progress[]} */
  const items = [];
  let q = `since=${since}`;
  for (let page = 0; page < PAGES; page++) {
    const r = await call('GET', `progress?${q}`, t, { signal });
    if (!r?.ok) {
      if (r && [401, 403].includes(r.status)) token = null;
      return null;
    }
    const b = await r.json();
    items.push(...b.items);
    if (!b.next) return { items, next_since: Number(b.next_since) };
    q = `cursor=${encodeURIComponent(b.next)}`;
  }
  return null;
}

/** On open: the Worker's newer positions into the app's storage, if back before `by` (the page's
 * time when the app stops waiting: it reads its storage at `by` or later, never before; the check
 * and the write below run in one go, so nothing of the app runs between them).
 * @param {number} by */
export async function open(by) {
  if (!deps.api() || !deps.online() || deps.sincePage() >= by) return;
  const t = await tokenOf();
  if (!t) return;
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), Math.max(0, by - deps.sincePage()));
  try {
    const storage = deps.storage();
    const mem = loadMemory(storage);
    const got = await pull(mem.since.progress, t, stop.signal);
    if (!got || deps.sincePage() >= by) return;
    const app = loadApp(storage) ?? { version: 1, progress: {}, follows: [] };
    if (applyProgress(app, mem, got.items) && !save(storage, APP_KEY, app)) return;
    mem.since.progress = got.next_since;
    save(storage, SYNC_KEY, mem);
  } catch {
    // Late or refused: nothing applied, `since` kept for the next open.
  } finally {
    clearTimeout(timer);
  }
}

/** One request's items: 'ok', 'refused' (a 4xx no retry fixes: never sent again), or 'stop'.
 * @param {string} path @param {unknown[]} items @param {string} t */
async function send(path, items, t) {
  const r = await call('PUT', path, t, { body: { items } });
  if (r?.ok) return 'ok';
  if (r && [401, 403].includes(r.status)) token = null;
  return r && [400, 413, 422].includes(r.status) ? 'refused' : 'stop';
}

async function pushNow() {
  const t = deps.api() && deps.online() ? await tokenOf() : null;
  if (!t) return;
  const storage = deps.storage();
  const app = loadApp(storage);
  if (!app) return;
  const mem = loadMemory(storage);
  // The stamps are kept before sending, so a follow noticed now keeps its time if the send fails.
  if (noteFollows(app, mem, deps.now())) save(storage, SYNC_KEY, mem);
  let ok = true;
  for (const batch of chunks(progressToSend(app, mem))) {
    if ((await send('progress', batch, t)) === 'stop') ok = false;
    else for (const p of batch) mem.sent[p.key] = Math.max(mem.sent[p.key] ?? 0, p.updated_at);
    if (!ok) break;
  }
  for (const batch of ok ? chunks(followsToSend(mem)) : []) {
    if ((await send('follows', batch, t)) === 'stop') break;
    for (const f of batch) if (mem.follows[f.feed_url]?.at === f.updated_at) mem.follows[f.feed_url].sent = true;
  }
  // Read again: another tab may have written since (the stamps above are this one's).
  const latest = loadMemory(storage);
  for (const [k, at] of Object.entries(latest.sent)) mem.sent[k] = Math.max(mem.sent[k] ?? 0, at);
  mem.since = latest.since;
  trim(app, mem, deps.now());
  save(storage, SYNC_KEY, mem);
}

/** @type {Promise<void> | null} */
let pushing = null;
let again = false;
/** Sends what the Worker doesn't have; one at a time, and once more if asked meanwhile. */
export function push() {
  if (pushing) {
    again = true;
    return pushing;
  }
  pushing = pushNow()
    .catch(() => {})
    .finally(() => {
      pushing = null;
      if (again) {
        again = false;
        void push();
      }
    });
  return pushing;
}

/** For tests: forget the token and any send in progress. */
export function reset() {
  token = null;
  opening = null;
  pushing = null;
  again = false;
}

/** After the app's own listeners (it registers them once `opened` lets it run), so its storage holds
 * the position it just saved when these send. @param {Document} doc */
export function wire(doc) {
  const audio = doc.getElementById('audio');
  for (const e of ['pause', 'ended']) audio?.addEventListener(e, () => void push());
  addEventListener('visibilitychange', () => doc.hidden && void push());
  addEventListener('pagehide', () => void push());
  addEventListener('online', () => void push());
  setInterval(() => audio instanceof HTMLMediaElement && !audio.paused && void push(), EVERY_MS);
  void push();
}

/** @type {Promise<void> | null} */
let opening = null;
/** The app's edit calls this before it reads its storage: the open's merge, done or given up before
 * `by`; then the sync's listeners, after the app's own. Once a page. @param {number} by */
export function opened(by) {
  opening ??= open(by).finally(() => {
    if (typeof document !== 'undefined') setTimeout(() => wire(document), 0);
  });
  return opening;
}

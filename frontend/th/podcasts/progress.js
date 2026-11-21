// @ts-check
// Podcasts' progress on the Worker (NEXT-BATCH.md part 7, PODCASTS.md §5.4), for the ported app,
// which keeps where each episode was left and the shows it follows in its own storage
// (`jarvis.podcasts.v1`, podcasts/core.js). Its edit for this loads this module and waits for
// `opened(by)` before it reads that storage, at most 400 ms (`by` is when it stops waiting, in the
// page's time), then hands this module its live state (`attach`):
// - on open, what the Worker took since the last time (GET /v1/podcasts/progress?since=) is merged
//   into the app's storage before the app reads it, the newer `updatedAt` winning, so an episode
//   left on another phone resumes where it was; the mind's pending intents for the shows and Up Next
//   go into the same write (th/podcasts/intents.js), reported once it is saved. A pull that comes
//   back at `by` or later goes into the app's state in memory instead (the app rewrites all its
//   storage from that state on each save, so storage alone would be written over), held until the
//   app attaches if it has not yet; its intents wait for the next open;
// - the newest position always wins: the pull runs again when the page becomes visible and before
//   each episode plays (`refresh`), into the live state the same way; the app offers a jump
//   further than 30 s rather than seeking under the listener (`resumeOffer`);
// - then, and on pause, on hiding the page, every 60 s while an episode plays and when the network
//   returns, the positions the Worker doesn't have yet go up (PUT, ≤ 100 and < 60 KB a request),
//   and so do the follows and unfollows since the last time (PUT /v1/podcasts/follows), so the night
//   knows the shows;
// - follows come down too, on the same pulls (GET /v1/podcasts/follows?since=, alongside the
//   positions: one more read a pull, an empty page when nothing changed), so a phone signed in again
//   gets its shows back: a show the account follows and the app lacks is added (`applyFollows`). A
//   pull never removes a show: a show missing from the account, or one it has as unfollowed, stays
//   (a second copy of the app open on this phone can write its older list over the storage, so a
//   missing show proves nothing). This phone's own word stands: a show it follows (listed or not: an
//   unlisted one is an unfollow not yet sent) or unfollowed at least as recently is left alone, so an
//   unfollow made here goes up and the next pull does not bring the show back (the Worker keeps an
//   unfollow 30 days, newer wins). Up Next, downloads and speed stay on one phone.
// Times: the app stamps its saves with the phone's clock, which may be off. Every answer from the
// Worker carries its own clock (`at`, `next_since`), so this module keeps the difference (`offset`,
// Worker minus phone, from the middle of each request, always taken) and sends times on the Worker's clock, and
// reads the Worker's times back onto the phone's; "the newer wins" then compares one clock's times.
// One bad item never costs the rest: the Worker reports what it refused by place, and those stay
// unsent (tried again next time: a time ahead of the Worker's clock comes good once it is due).
// Only signed in, and in a top-level page or one of home's own frames (th/ported/session.js). What
// this module remembers (what the Worker has, and since when it last asked) is `th.p.podcasts.sync`,
// cleared on sign-out with the rest of `th.p.*` (th/session.js).
// The listening, as senses too (shared/contract/senses.ts `podcast.*`, th/senses/send.js): an episode
// starting to sound (`podcast.play`), playing to its end (`podcast.finish`), left unfinished for
// another (`podcast.skip`), from the app's `<audio>` and the episode it keeps as current; a show
// followed or unfollowed, as this module notices it (not on a phone's first look, which only
// learns what is followed). The ref is `podcast:<show id>/<episode id>`: the show's id is the hash
// of its feed address the Worker's follows use, never the address or a title.
import { CONFIG } from '../../config.js';
import { framedByOther, sessionToken } from '../ported/session.js';
import { episodeID } from './feed.js';

/** The Worker's limits this module keeps to (PODCAST_LIMITS in shared/contract/podcasts.ts; kept here,
 * not in th/contract.js, which counts against the shell's size budget; tests/podcasts-progress.test.mjs
 * checks they agree). */
export const L = Object.freeze({
  batch_items: 100,
  url_chars: 2000,
  id_chars: 64,
  seconds_max: 604_800,
  title_chars: 300,
  author_chars: 200,
  unfollowed_keep_days: 30,
});

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
/** The pending intents must be in this long before the app reads its storage, or wait. */
const INTENTS_SPARE_MS = 50;
const UNFOLLOW_MEMORY_MS = L.unfollowed_keep_days * 86_400_000;
/** A pull gives up after this long. */
const PULL_MS = 15_000;
/** A pulled position further on than the one playing by more than this is offered, not jumped to. */
export const RESUME_GAP_S = 30;
/** The app keeps at most this many shows (podcasts/core.js `readState`). */
const FOLLOWS_MAX = 100;
/** Whether to offer the pulled position (seconds) instead of the one the listener is at. @param {number} pulled @param {number} here */
export const resumeOffer = (pulled, here) => Number(pulled) - (Number(here) || 0) > RESUME_GAP_S;

/** @typedef {{ position?: number, duration?: number, played?: boolean, updatedAt?: number, episode?: unknown }} Entry */
/** @typedef {{ progress: Record<string, Entry>, follows: { feedUrl: string, title?: string, author?: string, artwork?: string }[], [k: string]: unknown }} App */
/** @typedef {{ followed: boolean, at: number, sent: boolean, title: string, author: string, artwork: string }} Known */
/** `sent`: per key, the app's own `updatedAt` (phone clock) of the version the Worker has. `offset`:
 * the Worker's clock minus the phone's, ms. `looked`: this phone has looked at the follows once (a
 * first look only learns them, so it sends no follow senses).
 * @typedef {{ v: 1, since: { progress: number, follows?: number }, sent: Record<string, number>, follows: Record<string, Known>, offset?: number, looked?: boolean }} Memory */
/** @typedef {import('../../../shared/contract/podcasts.ts').PodcastProgress} Progress */
/** @typedef {import('../../../shared/contract/podcasts.ts').PodcastFollow} Follow */
/** A pull: the positions, and the follows (null when their read failed: `since.follows` stays).
 * @typedef {{ items: Progress[], next_since: number, follows: { items: Follow[], next_since: number } | null }} Pulled */

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
  /** One sense (th/senses/send.js). @param {string} type @param {string} ref @param {Record<string, number> | null} [data] */
  sense: (type, ref, data = null) => import('../senses/send.js').then((m) => m.sense(type, ref, data)).catch(() => false),
  /** The app's pending intents applied to its storage (th/podcasts/intents.js), not yet reported.
   * @param {App} app @returns {Promise<{ done: unknown[], send: () => Promise<void> } | null>} */
  intents: (app) => import('./intents.js').then((m) => m.applyToApp(/** @type {any} */ (app))),
};

/** An episode's ref for a sense, from the app's key `<feed address>#<episode id>`, or null for a
 * key the Worker would refuse. @param {string} key */
export function episodeRef(key) {
  const cut = key.lastIndexOf('#');
  return keyProblem(key) ? null : `podcast:${episodeID(key.slice(0, cut))}/${key.slice(cut + 1)}`;
}
/** A show's ref for a sense, from its feed address. @param {string} feedUrl */
export const showRef = (feedUrl) => (feedProblem(feedUrl) ? null : `podcast:${episodeID(feedUrl)}`);

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

/** The Worker's clock minus the phone's, from an answer that left at `t0` and came back at `t1`
 * (phone times) with the Worker's `at`. @param {Memory} mem @param {unknown} at @param {number} t0 @param {number} t1 */
export function setOffset(mem, at, t0, t1) {
  // Always from the Worker's answer: the worse the phone's clock, the more the offset matters.
  if (Number.isFinite(Number(at)) && Number(at) > 0) mem.offset = Math.round(Number(at) - (t0 + t1) / 2);
}

/** Remote positions into the app's state where they are newer than its own (on the Worker's clock);
 * the episode's details the app keeps stay, and its time goes back onto the phone's clock. Returns
 * how many changed, their keys added to `moved`. @param {App} app @param {Memory} mem @param {Progress[]} items @param {string[]} [moved] */
export function applyProgress(app, mem, items, moved = []) {
  const offset = mem.offset ?? 0;
  let n = 0;
  for (const p of items) {
    const here = app.progress[p.key];
    const local = Math.round(p.updated_at - offset);
    if ((Number(here?.updatedAt) || 0) + offset >= p.updated_at) {
      mem.sent[p.key] = Math.max(mem.sent[p.key] ?? 0, Math.min(local, Number(here?.updatedAt) || 0));
      continue;
    }
    app.progress[p.key] = { ...here, position: p.position_s, duration: p.duration_s, played: p.played, updatedAt: local };
    mem.sent[p.key] = local;
    moved.push(p.key);
    n++;
  }
  return n;
}

/** The app's positions the Worker doesn't have yet, their times on the Worker's clock.
 * @param {App} app @param {Memory} mem @returns {Progress[]} */
export function progressToSend(app, mem) {
  const offset = mem.offset ?? 0;
  /** @type {Progress[]} */
  const out = [];
  for (const [key, p] of Object.entries(app.progress)) {
    const at = Math.round(Number(p?.updatedAt) || 0);
    if (at <= 0 || (mem.sent[key] ?? 0) >= at || keyProblem(key)) continue;
    out.push({ key, position_s: seconds(p.position), duration_s: seconds(p.duration), played: Boolean(p.played), updated_at: at + offset });
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
/** The account's follows into the app's state: a followed show the app lacks is added, unless this
 * phone's own word on it stands (followed here, listed or not, or unfollowed at least as recently, on
 * the Worker's clock); nothing is ever removed. Returns how many shows were added; the addresses this
 * phone now knows from the account go into `changed`. @param {App} app @param {Memory} mem
 * @param {Follow[]} rows @param {string[]} [changed] */
export function applyFollows(app, mem, rows, changed = []) {
  const offset = mem.offset ?? 0;
  let n = 0;
  for (const f of rows) {
    const url = f?.feed_url;
    if (!f?.followed || typeof url !== 'string' || feedProblem(url)) continue;
    const k = mem.follows[url];
    if (k && (k.followed || k.at + offset >= f.updated_at)) continue;
    const listed = app.follows.some((s) => s?.feedUrl === url);
    // Past the app's cap the show is not known either, or its absence would go up as an unfollow.
    if (!listed && app.follows.length >= FOLLOWS_MAX) continue;
    const show = { title: text(f.title, L.title_chars), author: text(f.author, L.author_chars), artwork: artwork(f.artwork) };
    mem.follows[url] = { followed: true, at: Math.round(f.updated_at - offset), sent: true, ...show };
    changed.push(url);
    if (listed) continue;
    app.follows.push({ feedUrl: url, ...show });
    n++;
  }
  return n;
}

/** The follows not sent yet, their times on the Worker's clock. @param {Memory} mem @returns {Follow[]} */
export const followsToSend = (mem) =>
  Object.entries(mem.follows)
    .filter(([, k]) => !k.sent)
    .map(([feed_url, k]) => ({ feed_url, title: k.title, author: k.author, artwork: k.artwork, followed: k.followed, updated_at: k.at + (mem.offset ?? 0) }));

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

/** Every page of what changed since `since`, or null; the clock's offset kept from the answers.
 * @param {string} path @param {number} since @param {Memory} mem @param {string} t @param {AbortSignal} signal
 * @returns {Promise<{ items: any[], next_since: number } | null>} */
async function pages(path, since, mem, t, signal) {
  /** @type {any[]} */
  const items = [];
  let q = `since=${since}`;
  for (let page = 0; page < PAGES; page++) {
    const t0 = deps.now();
    const r = await call('GET', `${path}?${q}`, t, { signal });
    if (!r?.ok) {
      if (r && [401, 403].includes(r.status)) token = null;
      return null;
    }
    const b = await r.json();
    setOffset(mem, b.next_since, t0, deps.now());
    items.push(...b.items);
    if (!b.next) return { items, next_since: Number(b.next_since) };
    q = `cursor=${encodeURIComponent(b.next)}`;
  }
  return null;
}
/** The positions and the follows changed since this phone last asked, both at once; null when the
 * positions could not be read. @param {Memory} mem @param {string} t @param {AbortSignal} signal
 * @returns {Promise<Pulled | null>} */
async function pull(mem, t, signal) {
  const [progress, follows] = await Promise.all([
    pages('progress', mem.since.progress, mem, t, signal),
    pages('follows', mem.since.follows ?? 0, mem, t, signal),
  ]);
  return progress && { ...progress, follows };
}

/** On open: the Worker's newer positions into the app's storage, if back before `by` (the page's
 * time when the app stops waiting: it reads its storage at `by` or later, never before; the check
 * and the write below run in one go, so nothing of the app runs between them); a later answer goes
 * into the live app (`deliver`). Resolves by `by`, the late part going on behind.
 * @param {number} by */
export function open(by) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  const wait = new Promise((done) => {
    timer = setTimeout(done, Math.max(0, by - deps.sincePage()));
  });
  return Promise.race([merge(by), wait]).finally(() => clearTimeout(timer));
}
/** @param {number} by */
async function merge(by) {
  if (!deps.api() || !deps.online() || deps.sincePage() >= by) return;
  const t = await tokenOf();
  if (!t) return;
  const stop = new AbortController();
  // A late answer is still taken (into the live app, `deliver`), within the request's own time.
  const timer = setTimeout(() => stop.abort(), PULL_MS);
  try {
    const storage = deps.storage();
    const mem = loadMemory(storage);
    const got = await pull(mem, t, stop.signal);
    if (!got) return;
    if (deps.sincePage() >= by) return deliver(mem, got);
    const app = loadApp(storage) ?? { version: 1, progress: {}, follows: [] };
    const moved = applyProgress(app, mem, got.items) + applyFollows(app, mem, got.follows?.items ?? []);
    // The mind's pending intents for the shows and Up Next (th/podcasts/intents.js), applied to a
    // copy and kept only if they were all in before `by` (less a moment for the write), into the
    // same write; reported only once it is saved. Late, or no answer: the positions go alone, and
    // the intents' claims lapse and come back for the next open.
    const draft = structuredClone(app);
    const intents = await Promise.race([
      deps.intents(draft).catch(() => null),
      new Promise((done) => setTimeout(() => done(null), Math.max(0, by - deps.sincePage() - INTENTS_SPARE_MS))),
    ]);
    const out = intents ? draft : app;
    if (deps.sincePage() >= by) return deliver(mem, got);
    if ((moved || intents?.done.length) && !save(storage, APP_KEY, out)) return;
    mem.since.progress = got.next_since;
    if (got.follows) mem.since.follows = got.follows.next_since;
    save(storage, SYNC_KEY, mem);
    void intents?.send().catch(() => {});
  } catch {
    // Refused or no answer: nothing applied, `since` kept for the next open.
  } finally {
    clearTimeout(timer);
  }
}

/** The app once it runs (podcasts/app.js): its state in memory, its save, and what to do once
 * positions or follows came in (the keys of the positions, then the addresses of the shows, which
 * never match a key: any of them repaints). @typedef {{ state: () => App, commit: () => boolean, pulled: (keys: string[]) => void }} Live */
/** @type {Live | null} */
let live = null;
/** A pull that came back before the app attached. @type {{ mem: Memory, got: Pulled } | null} */
let held = null;

/** A pull into the live app's state (newer wins), saved by the app's own save, `since` moved on;
 * held until the app attaches. @param {Memory} mem @param {Pulled} got */
function deliver(mem, got) {
  if (!live) {
    held = { mem, got };
    return;
  }
  /** @type {string[]} */
  const keys = [];
  /** @type {string[]} */
  const shows = [];
  const moved = applyProgress(live.state(), mem, got.items, keys) + applyFollows(live.state(), mem, got.follows?.items ?? [], shows);
  if (moved && !live.commit()) return;
  // Onto what is kept now: a send may have written since this pull began.
  const storage = deps.storage();
  const latest = loadMemory(storage);
  for (const [k, at] of Object.entries(mem.sent)) latest.sent[k] = Math.max(latest.sent[k] ?? 0, at);
  for (const url of shows) {
    const k = latest.follows[url];
    if (!k || (!k.followed && k.at < mem.follows[url].at)) latest.follows[url] = mem.follows[url];
  }
  latest.since = { ...latest.since, progress: got.next_since, ...(got.follows ? { follows: got.follows.next_since } : {}) };
  if (mem.offset !== undefined) latest.offset = mem.offset;
  save(storage, SYNC_KEY, latest);
  live.pulled([...keys, ...shows]);
}

/** The app hands over its live state once it has read its storage. @param {Live} app */
export function attach(app) {
  live = app;
  const late = held;
  held = null;
  if (late) deliver(late.mem, late.got);
}

/** @type {Promise<void> | null} */
let pulling = null;
/** The Worker's newer positions into the live app now (on becoming visible, before an episode plays). */
export function refresh() {
  pulling ??= (async () => {
    if (!live || !deps.api() || !deps.online()) return;
    const t = await tokenOf();
    if (!t) return;
    const mem = loadMemory(deps.storage());
    const got = await pull(mem, t, AbortSignal.timeout(PULL_MS));
    if (got) deliver(mem, got);
  })()
    .catch(() => {})
    .finally(() => {
      pulling = null;
    });
  return pulling;
}

/** One request's items: the places the Worker refused (those stay unsent), or null to stop (no
 * answer, a refused session, or the whole request refused: all stay unsent, for next time).
 * @param {string} path @param {unknown[]} items @param {string} t @param {Memory} mem */
async function send(path, items, t, mem) {
  const t0 = deps.now();
  const r = await call('PUT', path, t, { body: { items } });
  if (!r?.ok) {
    if (r && [401, 403].includes(r.status)) token = null;
    return null;
  }
  try {
    const b = await r.json();
    setOffset(mem, b.at, t0, deps.now());
    return new Set((Array.isArray(b.refused) ? b.refused : []).map((/** @type {{ index: number }} */ x) => x.index));
  } catch {
    return null;
  }
}

async function pushNow() {
  const t = deps.api() && deps.online() ? await tokenOf() : null;
  if (!t) return;
  const storage = deps.storage();
  const app = loadApp(storage);
  if (!app) return;
  const mem = loadMemory(storage);
  // What was followed before this look; this phone's first look (`looked` not yet kept) only learns it.
  const known = mem.looked ? new Map(Object.entries(mem.follows).map(([u, k]) => [u, k.followed])) : null;
  // The stamps are kept before sending, so a follow noticed now keeps its time if the send fails.
  const noted = noteFollows(app, mem, deps.now());
  if (noted || !mem.looked) {
    mem.looked = true;
    save(storage, SYNC_KEY, mem);
  }
  if (noted && known)
    for (const [url, k] of Object.entries(mem.follows)) {
      const ref = (known.get(url) ?? false) !== k.followed ? showRef(url) : null;
      if (ref) void deps.sense(k.followed ? 'podcast.follow' : 'podcast.unfollow', ref);
    }
  let ok = true;
  for (const batch of chunks(progressToSend(app, mem))) {
    const refused = await send('progress', batch, t, mem);
    if (!refused) {
      ok = false;
      break;
    }
    batch.forEach((p, i) => {
      // What the Worker has is the app's own save (its phone time), unless it refused this one.
      if (!refused.has(i)) mem.sent[p.key] = Math.max(mem.sent[p.key] ?? 0, Math.round(Number(app.progress[p.key]?.updatedAt) || 0));
    });
  }
  // Each follow's own stamp as sent: a reply moves the offset, so the times sent can't be recomputed.
  const follows = ok ? followsToSend(mem) : [];
  const stamped = new Map(follows.map((f) => [f.feed_url, mem.follows[f.feed_url]?.at]));
  for (const batch of chunks(follows)) {
    const refused = await send('follows', batch, t, mem);
    if (!refused) break;
    batch.forEach((f, i) => {
      const k = mem.follows[f.feed_url];
      if (!refused.has(i) && k && k.at === stamped.get(f.feed_url)) k.sent = true;
    });
  }
  // Read again: another tab may have written since (the stamps above are this one's).
  const latest = loadMemory(storage);
  for (const [k, at] of Object.entries(latest.sent)) mem.sent[k] = Math.max(mem.sent[k] ?? 0, at);
  // And the shows a pull learned meanwhile.
  for (const [u, k] of Object.entries(latest.follows)) mem.follows[u] ??= k;
  mem.since = latest.since;
  mem.offset ??= latest.offset;
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
  live = null;
  held = null;
  pulling = null;
}

/** After the app's own listeners (it registers them once `opened` lets it run), so its storage holds
 * the position it just saved when these send. @param {Document} doc */
export function wire(doc) {
  const audio = doc.getElementById('audio');
  if (audio instanceof HTMLMediaElement) listening(audio);
  for (const e of ['pause', 'ended']) audio?.addEventListener(e, () => void push());
  addEventListener('visibilitychange', () => void (doc.hidden ? push() : refresh()));
  addEventListener('pagehide', () => void push());
  addEventListener('online', () => void push());
  setInterval(() => audio instanceof HTMLMediaElement && !audio.paused && void push(), EVERY_MS);
  void push();
}

/** The episode the app keeps as current (its storage's `current`), as its key, or null. */
function currentKey() {
  const e = /** @type {any} */ (read(deps.storage(), APP_KEY))?.current;
  return typeof e?.show?.feedUrl === 'string' && typeof e.id === 'string' ? `${e.show.feedUrl}#${e.id}` : null;
}

/** The listening senses from the app's player: a new episode sounding is a play (a resume of the
 * same one is not), and the one before it a skip unless it ended; an end is a finish.
 * @param {HTMLMediaElement} audio */
export function listening(audio) {
  /** Where in it and how long, while its own source plays (`src`: a new episode's loading moves the
   * element before it sounds). @type {{ key: string, ref: string, src: string, at: number, dur: number, ended: boolean } | null} */
  let now = null;
  const ms = (/** @type {number} */ s) => (Number.isFinite(s) && s > 0 ? Math.round(Math.min(s, L.seconds_max) * 1000) : 0);
  audio.addEventListener('timeupdate', () => {
    if (!now || audio.currentSrc !== now.src || audio.seeking) return;
    now.at = Math.max(now.at, ms(audio.currentTime));
    now.dur = ms(audio.duration) || now.dur;
  });
  audio.addEventListener('playing', () => {
    const key = currentKey();
    if (!key || now?.key === key) return;
    if (now && !now.ended) void deps.sense('podcast.skip', now.ref, { at_ms: now.at, duration_ms: now.dur });
    const ref = episodeRef(key);
    now = ref ? { key, ref, src: audio.currentSrc, at: ms(audio.currentTime), dur: ms(audio.duration), ended: false } : null;
    if (now) void deps.sense('podcast.play', now.ref, { at_ms: now.at });
  });
  audio.addEventListener('ended', () => {
    if (!now || now.ended) return;
    now.ended = true;
    void deps.sense('podcast.finish', now.ref, { listened_ms: now.dur || now.at });
  });
}

/** @type {Promise<void> | null} */
let opening = null;
/** The app's edit calls this before it reads its storage: the open's merge into storage, if back
 * before `by` (else into the live app, `deliver`); then the sync's listeners, after the app's own.
 * Once a page. @param {number} by */
export function opened(by) {
  opening ??= open(by).finally(() => {
    if (typeof document !== 'undefined') setTimeout(() => wire(document), 0);
  });
  return opening;
}

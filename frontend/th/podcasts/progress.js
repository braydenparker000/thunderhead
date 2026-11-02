// @ts-check
// Podcasts' progress on the Worker (NEXT-BATCH.md part 7, PODCASTS.md §5.4), for the ported app,
// which keeps where each episode was left and the shows it follows in its own storage
// (`jarvis.podcasts.v1`, podcasts/core.js) and is otherwise unchanged. Its one edit for this loads
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
const UNFOLLOW_MEMORY_MS = L.unfollowed_keep_days * 86_400_000;

/** @typedef {{ position?: number, duration?: number, played?: boolean, updatedAt?: number, episode?: unknown }} Entry */
/** @typedef {{ progress: Record<string, Entry>, follows: { feedUrl: string, title?: string, author?: string, artwork?: string }[], [k: string]: unknown }} App */
/** @typedef {{ followed: boolean, at: number, sent: boolean, title: string, author: string, artwork: string }} Known */
/** `sent`: per key, the app's own `updatedAt` (phone clock) of the version the Worker has. `offset`:
 * the Worker's clock minus the phone's, ms.
 * @typedef {{ v: 1, since: { progress: number }, sent: Record<string, number>, follows: Record<string, Known>, offset?: number }} Memory */
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
  /** One sense (th/senses/send.js). @param {string} type @param {string} ref @param {Record<string, number> | null} [data] */
  sense: (type, ref, data = null) => import('../senses/send.js').then((m) => m.sense(type, ref, data)).catch(() => false),
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
 * how many changed. @param {App} app @param {Memory} mem @param {Progress[]} items */
export function applyProgress(app, mem, items) {
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
 * @param {Memory} mem @param {string} t @param {AbortSignal} signal */
async function pull(mem, t, signal) {
  /** @type {Progress[]} */
  const items = [];
  let q = `since=${mem.since.progress}`;
  for (let page = 0; page < PAGES; page++) {
    const t0 = deps.now();
    const r = await call('GET', `progress?${q}`, t, { signal });
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
    const got = await pull(mem, t, stop.signal);
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
  // What was followed before this look; a phone's first look (nothing remembered) only learns it.
  const known = read(storage, SYNC_KEY) ? new Map(Object.entries(mem.follows).map(([u, k]) => [u, k.followed])) : null;
  // The stamps are kept before sending, so a follow noticed now keeps its time if the send fails.
  if (noteFollows(app, mem, deps.now())) {
    save(storage, SYNC_KEY, mem);
    for (const [url, k] of Object.entries(mem.follows)) {
      const ref = known && (known.get(url) ?? false) !== k.followed ? showRef(url) : null;
      if (ref) void deps.sense(k.followed ? 'podcast.follow' : 'podcast.unfollow', ref);
    }
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
}

/** After the app's own listeners (it registers them once `opened` lets it run), so its storage holds
 * the position it just saved when these send. @param {Document} doc */
export function wire(doc) {
  const audio = doc.getElementById('audio');
  if (audio instanceof HTMLMediaElement) listening(audio);
  for (const e of ['pause', 'ended']) audio?.addEventListener(e, () => void push());
  addEventListener('visibilitychange', () => doc.hidden && void push());
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
/** The app's edit calls this before it reads its storage: the open's merge, done or given up before
 * `by`; then the sync's listeners, after the app's own. Once a page. @param {number} by */
export function opened(by) {
  opening ??= open(by).finally(() => {
    if (typeof document !== 'undefined') setTimeout(() => wire(document), 0);
  });
  return opening;
}

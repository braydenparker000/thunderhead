// @ts-check
// Up Next and the playback speed on every phone (PODCASTS.md §5.4), for th/podcasts/progress.js,
// which pulls and pushes them beside the positions and follows, through the app's state (in its
// storage on open, in memory once it runs). The app keeps no time for either, so this phone notes a
// change when it looks (before each pull is applied and each push) and stamps it then, on the
// Worker's clock (`now` here is the phone's time plus the kept offset).
// - Up Next: each change is a new version of the whole queue: its members go up with the version's
//   stamp and their place, and the episodes it took out as removals, kept by the Worker so they do
//   not come back. The queue is the members at the newest stamp: a newer version pulled replaces
//   this phone's (its own copy of an episode kept, richer than the Worker's); an older one leaves it,
//   except that an episode removed on another phone after the version this phone last had (`base`)
//   goes here too. A version that came in more than one request is completed when the rest arrives.
// - Speed: one value, the newer wins.
// A phone's first look (none noted yet: a new phone, or one signed in again after the wipe) learns
// what it has with the stamp 0, so anything the account holds wins over it; what it has goes up (as
// 1, the Worker's least) only when the account has nothing. Downloads are files and stay on the phone.
import { keyProblem } from './progress.js';

/** The app's speeds (podcasts/core.js `readState`; PODCAST_SPEEDS in shared/contract/podcasts.ts). */
export const SPEEDS = Object.freeze([0.75, 1, 1.25, 1.5, 1.75, 2, 2.5]);
/** One Up Next episode as the Worker keeps it, in characters of JSON (PODCAST_LIMITS.episode_chars). */
export const EPISODE_CHARS = 8000;
/** An episode's description as it goes up (this phone keeps its own in full). */
const DESCRIPTION_CHARS = 1000;

/** @typedef {{ id?: unknown, show?: { feedUrl?: unknown, [k: string]: unknown }, [k: string]: unknown }} Episode */
/** @typedef {{ queue?: unknown, speed?: unknown, [k: string]: unknown }} App */
/** `keys`: the version this phone has noted; `at`: its stamp; `base`: the newest version this phone
 * had from the Worker; `gone`: what it took out, not yet sent.
 * @typedef {{ keys: string[], at: number, base: number, sent: boolean, gone: string[] }} Queue */
/** @typedef {{ value: number, at: number, sent: boolean }} Speed */
/** @typedef {{ queue?: Queue, speed?: Speed, [k: string]: unknown }} Memory */
/** @typedef {import('../../../shared/contract/podcasts.ts').PodcastQueueItem} Item */
/** @typedef {import('../../../shared/contract/podcasts.ts').PodcastPref} Pref */

/** @param {Episode} e */
const keyOf = (e) => `${e?.show?.feedUrl}#${e?.id}`;
/** @param {App} app @returns {Episode[]} */
const entries = (app) => (Array.isArray(app.queue) ? app.queue.filter((e) => e && typeof e === 'object') : []);
/** @param {App} app */
const keysOf = (app) => entries(app).map(keyOf).filter((k) => !keyProblem(k));
/** @param {App} app */
const speedOf = (app) => (SPEEDS.includes(/** @type {number} */ (app.speed)) ? /** @type {number} */ (app.speed) : 1);
/** @param {string[]} a @param {string[]} b */
const same = (a, b) => a.length === b.length && a.every((k, i) => k === b[i]);

/** Up Next's change since the last look, stamped `now`. Returns whether memory changed.
 * @param {App} app @param {Memory} mem @param {number} now */
export function noteQueue(app, mem, now) {
  const keys = keysOf(app);
  const q = mem.queue;
  if (!q) {
    mem.queue = { keys, at: 0, base: 0, sent: keys.length === 0, gone: [] };
    return true;
  }
  if (same(keys, q.keys)) return false;
  const gone = [...new Set([...(q.sent ? [] : q.gone), ...q.keys])].filter((k) => !keys.includes(k));
  mem.queue = { keys, at: Math.max(Math.round(now), q.at + 1), base: q.base, sent: false, gone };
  return true;
}

/** The speed's change since the last look, stamped `now`. @param {App} app @param {Memory} mem @param {number} now */
export function noteSpeed(app, mem, now) {
  const value = speedOf(app);
  const s = mem.speed;
  if (!s) {
    mem.speed = { value, at: 0, sent: value === 1 };
    return true;
  }
  if (s.value === value) return false;
  mem.speed = { value, at: Math.max(Math.round(now), s.at + 1), sent: false };
  return true;
}

/** The episode as it goes up: its show's description left out and its own cut, or only what
 * playing it needs when that is still too long; null past even that. @param {Episode} e */
export function slim(e) {
  const { description: _, ...show } = e.show ?? {};
  const full = { ...e, show, ...(typeof e.description === 'string' ? { description: e.description.slice(0, DESCRIPTION_CHARS) } : {}) };
  if (JSON.stringify(full).length <= EPISODE_CHARS) return full;
  const pick = (/** @type {Record<string, unknown>} */ o, /** @type {string[]} */ names) => Object.fromEntries(names.filter((n) => n in o).map((n) => [n, o[n]]));
  const bare = { ...pick(e, ['id', 'title', 'audioUrl', 'type', 'publishedAt', 'duration', 'bytes']), show: pick(show, ['feedUrl', 'title']) };
  return JSON.stringify(bare).length <= EPISODE_CHARS ? bare : null;
}

/** The noted version of Up Next not sent yet: its members by place, then its removals.
 * @param {App} app @param {Memory} mem @returns {Item[]} */
export function queueToSend(app, mem) {
  const q = mem.queue;
  if (!q || q.sent) return [];
  const byKey = new Map(entries(app).map((e) => [keyOf(e), e]));
  /** @type {Item[]} */
  const out = [];
  q.keys.forEach((key, pos) => {
    const e = byKey.get(key);
    const episode = e ? slim(e) : null;
    if (episode) out.push({ key, pos, queued: true, episode: /** @type {Item['episode']} */ (episode), base: q.base, updated_at: Math.max(1, q.at) });
  });
  for (const key of q.gone) out.push({ key, pos: 0, queued: false, episode: null, base: q.base, updated_at: Math.max(1, q.at) });
  return out;
}

/** @param {Memory} mem @returns {Pref[]} */
export const speedToSend = (mem) =>
  mem.speed && !mem.speed.sent ? [{ name: 'speed', value: /** @type {Pref['value']} */ (mem.speed.value), updated_at: Math.max(1, mem.speed.at) }] : [];

/** Pulled Up Next rows into the app's state (after `noteQueue`). Returns how many changes, 'queue'
 * added to `changed` when any. @param {App} app @param {Memory} mem @param {Omit<Item, 'base'>[]} rows @param {string[]} [changed] */
export function applyQueue(app, mem, rows, changed = []) {
  const q = mem.queue;
  if (!q || !rows.length) return 0;
  const v = Math.max(...rows.map((r) => r.updated_at));
  const top = rows.filter((r) => r.queued && r.updated_at === v && r.episode).sort((a, b) => a.pos - b.pos);
  const byKey = new Map(entries(app).map((e) => [keyOf(e), e]));
  if (v > q.at) {
    app.queue = top.map((r) => byKey.get(r.key) ?? r.episode);
    mem.queue = { keys: top.map((r) => r.key), at: v, base: v, sent: true, gone: [] };
    changed.push('queue');
    return 1;
  }
  const queue = entries(app);
  let n = 0;
  // The rest of a version this phone has: members it lacked join at their place.
  if (v === q.at)
    for (const r of top) {
      if (q.keys.includes(r.key) || byKey.has(r.key)) continue;
      queue.splice(Math.min(r.pos, queue.length), 0, /** @type {Episode} */ (r.episode));
      q.keys.splice(Math.min(r.pos, q.keys.length), 0, r.key);
      n++;
    }
  // An episode removed on another phone after the version this phone last had stays removed.
  for (const r of rows) {
    if (r.queued || r.updated_at <= q.base) continue;
    const i = queue.findIndex((e) => keyOf(e) === r.key);
    if (i >= 0) queue.splice(i, 1), n++;
    q.keys = q.keys.filter((k) => k !== r.key);
  }
  q.base = Math.max(q.base, v);
  if (n) {
    app.queue = queue;
    changed.push('queue');
  }
  return n;
}

/** The pulled speed into the app's state where it is newer (after `noteSpeed`). @param {App} app
 * @param {Memory} mem @param {Pref[]} rows @param {string[]} [changed] */
export function applySpeed(app, mem, rows, changed = []) {
  const p = rows.find((r) => r?.name === 'speed' && SPEEDS.includes(r.value));
  if (!p || !mem.speed || p.updated_at <= mem.speed.at) return 0;
  app.speed = p.value;
  mem.speed = { value: p.value, at: p.updated_at, sent: true };
  changed.push('speed');
  return 1;
}

/** Of two notes of the same thing, the newer stamp; at one stamp, sent if either was.
 * @template {{ at: number, sent: boolean }} T @param {T | undefined} a @param {T | undefined} b @returns {T | undefined} */
export function newer(a, b) {
  if (!a || !b) return a ?? b;
  if (a.at !== b.at) return a.at > b.at ? a : b;
  return { ...b, sent: a.sent || b.sent };
}

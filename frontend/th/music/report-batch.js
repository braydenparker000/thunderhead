// @ts-check
// Music's playback batches, without the page (API.md §11.16 reports; MUSIC.md §5.10): the playback
// log's events that the Worker hasn't taken yet, and its counters, kept to the known fields
// (report-fields.js: timings, counts and track ids, never a title, an artist, a file name or more of
// an address than its host). Each event carries its number in this page load (`n`), and each batch
// the page's own id, so an event sent twice (a batch the Worker kept whose answer was lost) is told
// apart by `(page, n)`; `th reports` counts it once. th/music/report.js sends them;
// tests/music-report.test.mjs checks them.
import { cleanBatch, keepField, PLAYBACK_STATE } from './report-fields.js';

/** The Worker keeps a batch of at most 32 KB as JSON (REPORT_LIMITS.body_bytes); this leaves room. */
export const BATCH_BYTES = 30_000;
/** The longest wait after failures in a row (each doubles it, from a minute), unless the Worker asks for longer. */
export const WAIT_MAX_MS = 30 * 60_000;
const bytes = (/** @type {unknown} */ v) => new TextEncoder().encode(JSON.stringify(v)).length;

/**
 * The events logged after `last` (the last event the Worker took: the log's own object). When `last`
 * is no longer in the log (it keeps 300), everything it has, and `lost`: some went unsent.
 * @template T @param {readonly T[]} events @param {T | null} last
 * @returns {{ events: T[], lost: boolean }}
 */
export function since(events, last) {
  const i = last === null ? -1 : events.lastIndexOf(last);
  return { events: events.slice(i + 1), lost: last !== null && i < 0 };
}

/** The playback log's counters for a batch, its known fields only. @param {unknown} snapshot */
export const stateOf = (snapshot) => keepField(PLAYBACK_STATE, snapshot);

/**
 * One batch's body, its known fields only, at most BATCH_BYTES as JSON: when the events don't fit,
 * the oldest are left out and counted in `dropped`.
 * @param {{ page: string, seq: number, why: 'minute' | 'hidden', build: number, t0: number, lost: boolean,
 *   events: readonly object[], state: unknown }} b
 */
export function batchOf(b) {
  let events = b.events;
  let dropped = 0;
  const body = () => cleanBatch({ v: 1, page: b.page, seq: b.seq, why: b.why, build: b.build, t0: Math.round(b.t0), lost: b.lost, dropped, events, state: b.state });
  let out = body();
  while (events.length && bytes(out) > BATCH_BYTES) {
    const n = Math.ceil(events.length / 4);
    events = events.slice(n);
    dropped += n;
    out = body();
  }
  return out;
}

/** @typedef {{ events: object[], now(): number, snapshot(): unknown }} Log */
/** @typedef {{ ok: boolean, status: number, retryAfter?: number }} Answer */

/**
 * The batches of one page load: what the log holds that the Worker hasn't taken goes once a minute
 * while music plays (`follow` after each play or pause) and when the page is hidden (`hidden`);
 * nothing new, nothing sent. One batch at a time: none starts while one is on its way. The mark of
 * what was taken moves only when the Worker takes it, or refuses it for good (400, 404, 413, 422):
 * after no answer, 408, 429 or 5xx the same events go again after a minute, then 2, 4 … 30 (or the
 * Worker's Retry-After); after 401 or 403 nothing goes until the session changes.
 * @param {{ log: Log, post: (body: object, token: string) => Promise<Answer>, token: () => string | null,
 *   playing: () => boolean, page: string, build: number, now?: () => number, everyMs?: number }} o
 */
export function batches(o) {
  const now = o.now ?? Date.now;
  const every = o.everyMs ?? 60_000;
  let seq = 0;
  /** @type {object | null} The last event the Worker took. */
  let last = null;
  /** Each event's number in this page load, given when it first goes. */
  const numbers = new WeakMap();
  let next = 0;
  let busy = false;
  /** @type {string | null} A session the Worker refused. */
  let refused = null;
  let wait = 0;
  let until = 0;
  /** @type {ReturnType<typeof setInterval> | undefined} */
  let timer;
  /** @param {'minute' | 'hidden'} why @returns {Promise<void> | null} null when nothing went */
  const send = (why) => {
    const token = o.token();
    if (busy || !token || token === refused || now() < until) return null;
    const fresh = since(o.log.events, last);
    if (!fresh.events.length) return null;
    for (const e of fresh.events) if (!numbers.has(e)) numbers.set(e, next++);
    const end = fresh.events.at(-1) ?? null;
    const events = fresh.events.map((e) => ({ ...e, n: numbers.get(e) }));
    const body = batchOf({ page: o.page, seq: ++seq, why, build: o.build, t0: now() - o.log.now(), lost: fresh.lost, events, state: stateOf(o.log.snapshot()) });
    busy = true;
    /** @param {Answer | null} r null: no answer (offline, timed out) */
    const settle = (r) => {
      busy = false;
      if (r && (r.status === 401 || r.status === 403)) refused = token;
      else if (!r || r.status === 408 || r.status === 429 || r.status >= 500) {
        wait = Math.min(WAIT_MAX_MS, wait ? wait * 2 : every);
        until = now() + Math.max(wait, (r?.retryAfter ?? 0) * 1000);
      } else {
        // Taken, or refused in a way no retry changes.
        last = end;
        wait = 0;
        until = 0;
      }
    };
    return o.post(body, token).then(settle, () => settle(null));
  };
  return {
    send,
    hidden: () => send('hidden'),
    follow() {
      if (o.playing() && !timer) timer = setInterval(() => send('minute'), every);
      else if (!o.playing() && timer) {
        clearInterval(timer);
        timer = undefined;
      }
    },
  };
}

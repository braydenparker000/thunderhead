// @ts-check
// What one playback batch holds (API.md §11.16 reports; MUSIC.md §5.10), without the page: the
// playback log's events since the last batch, and its counters, made safe to send. Timings, counts
// and track ids only: a field that could hold a title, an artist, a file name or an address is
// dropped, every address left in a text keeps only its host, and a text is at most 160 characters.
// th/music/report.js sends it; tests/music-report.test.mjs checks it.

/** The Worker keeps a batch of at most 32 KB as JSON (REPORT_LIMITS.body_bytes); this leaves room. */
export const BATCH_BYTES = 30_000;
const TEXT_MAX = 160;
/** Fields never sent, whatever they hold: they name things, or point at them. */
const NAMES = new Set(['title', 'artist', 'album', 'albumartist', 'composer', 'genre', 'name', 'path', 'folder', 'file', 'filename', 'src', 'url', 'href', 'art', 'lyrics', 'browser', 'startedat']);
const ADDRESS = /\b(?:blob:)?https?:\/\/([^/\s?#]+)\S*/g;
const bytes = (/** @type {unknown} */ v) => new TextEncoder().encode(JSON.stringify(v)).length;

/** A text as sent: each address only its host, at most 160 characters. @param {string} s */
export const bare = (s) => s.replace(ADDRESS, '$1/…').slice(0, TEXT_MAX);

/**
 * A value made safe to send: named fields dropped, texts bare, numbers to 0.1, nothing nested deeper
 * than 6 (the Worker refuses deeper than 8).
 * @param {unknown} v @param {number} [depth] @returns {unknown}
 */
export function clean(v, depth = 0) {
  if (typeof v === 'string') return bare(v);
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 10) / 10 : null;
  if (typeof v === 'boolean') return v;
  if (v === null || typeof v !== 'object' || depth >= 6) return null;
  if (Array.isArray(v)) return v.map((x) => clean(x, depth + 1));
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [k, x] of Object.entries(v)) {
    if (NAMES.has(k.toLowerCase()) || x === undefined || typeof x === 'function') continue;
    out[k.slice(0, 40)] = clean(x, depth + 1);
  }
  return out;
}

/**
 * The events logged after `last` (the last event sent: the log's own object). When `last` is no
 * longer in the log (it keeps 300), everything it has, and `lost`: some went unsent.
 * @template T @param {readonly T[]} events @param {T | null} last
 * @returns {{ events: T[], lost: boolean }}
 */
export function since(events, last) {
  const i = last === null ? -1 : events.lastIndexOf(last);
  return { events: events.slice(i + 1), lost: last !== null && i < 0 };
}

/**
 * The playback log's counters for a batch: its snapshot without the event list (the events go on
 * their own), the browser's name and the start as a date (`t0` says it).
 * @param {Record<string, unknown>} snapshot
 */
export function stateOf(snapshot) {
  const { events: _events, browser: _browser, startedAt: _started, ...rest } = snapshot;
  return clean(rest);
}

/**
 * One batch's body, at most BATCH_BYTES as JSON: when the events don't fit, the oldest are left out
 * and counted in `dropped`.
 * @param {{ page: string, seq: number, why: 'minute' | 'hidden', build: number, t0: number, lost: boolean,
 *   events: readonly object[], state: unknown }} b
 */
export function batchOf(b) {
  let events = b.events.map((e) => clean(e));
  let dropped = 0;
  const body = () => ({ v: 1, page: b.page, seq: b.seq, why: b.why, build: b.build, t0: Math.round(b.t0), lost: b.lost, dropped, events, state: b.state });
  while (events.length && bytes(body()) > BATCH_BYTES) {
    const n = Math.ceil(events.length / 4);
    events = events.slice(n);
    dropped += n;
  }
  return body();
}

/** @typedef {{ events: object[], now(): number, snapshot(): Record<string, unknown> }} Log */

/**
 * The batches of one page load: what the log holds that no batch took yet goes once a minute while
 * music plays (`follow` after each play or pause) and when the page is hidden (`hidden`); nothing
 * new, nothing sent. A batch the Worker didn't take for now (offline, busy, 5xx, 429) leaves its
 * events for the next one; one it refused (413, 422) does not.
 * @param {{ log: Log, post: (body: object) => Promise<{ ok: boolean, status: number }>, playing: () => boolean,
 *   page: string, build: number, now?: () => number, everyMs?: number }} o
 */
export function batches(o) {
  const now = o.now ?? Date.now;
  let seq = 0;
  /** @type {object | null} The last event a batch took. */
  let last = null;
  /** @type {ReturnType<typeof setInterval> | undefined} */
  let timer;
  /** @param {'minute' | 'hidden'} why @returns {Promise<void> | null} null when nothing was new */
  const send = (why) => {
    const fresh = since(o.log.events, last);
    if (!fresh.events.length) return null;
    const before = last;
    const sent = (last = /** @type {object} */ (fresh.events.at(-1)));
    const body = batchOf({ page: o.page, seq: ++seq, why, build: o.build, t0: now() - o.log.now(), lost: fresh.lost, events: fresh.events, state: stateOf(o.log.snapshot()) });
    // Unless a newer batch went meanwhile, this one's events go again with the next.
    const again = () => {
      if (last === sent) last = before;
    };
    return o.post(body).then((r) => {
      if (!r.ok && r.status !== 413 && r.status !== 422) again();
    }, again);
  };
  return {
    send,
    hidden: () => send('hidden'),
    follow() {
      if (o.playing() && !timer) timer = setInterval(() => send('minute'), o.everyMs ?? 60_000);
      else if (!o.playing() && timer) {
        clearInterval(timer);
        timer = undefined;
      }
    },
  };
}

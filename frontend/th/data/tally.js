// @ts-check
// The data meter's arithmetic (docs/engineering/DATA-METER.md): what a count is, which day and network
// it lands on, and the totals Settings › Data use shows. Pure: no storage, no DOM, and no network at all
// (tests/data-meter.test.mjs checks this folder never asks for anything): the numbers stay on the phone.

/** The parts, in the order the page names them when sizes tie: [id, name, icon]. */
export const PARTS = /** @type {const} */ ([
  ['home', 'Home and the shell', 'chat-circle'],
  ['music', 'Music', 'music-notes-simple'],
  ['podcasts', 'Podcasts', 'microphone'],
  ['astra', 'Astra', 'monitor-play'],
  ['photos', 'Photos', 'aperture'],
  ['study', 'Study', 'book-open-text'],
  ['guitar', 'Guitar', 'guitar'],
  ['updates', 'Updates', 'arrow-clockwise'],
  ['api', 'Talking to Thunderhead', 'plugs-connected'],
]);
/** Music's own pieces, counted apart and shown under Music. */
export const MUSIC = /** @type {const} */ ([['music.songs', 'Songs'], ['music.covers', 'Covers'], ['music.rest', 'The rest']]);
/** Every id a count may carry. */
/** @type {string[]} */
export const IDS = [...PARTS.map(([id]) => id).filter((id) => id !== 'music'), ...MUSIC.map(([id]) => id)];
/** The networks, in this order in every [wifi, mobile, unknown] triple. */
export const NETS = /** @type {const} */ (['wifi', 'mobile', 'unknown']);
/** Days kept, today included. */
export const KEEP_DAYS = 62;
/** An answer's headers when their size is not known (Chrome's own figure in Resource Timing). */
export const HEADERS = 300;
/** Where the tally is kept: localStorage, under th.p. so signing out clears it (th/session.js). */
export const KEY = 'th.p.data';

/** @typedef {[number, number, number]} Split bytes on Wi-Fi, mobile data, unknown */
/** @typedef {{ v: 1, since: number, days: Record<string, Record<string, Split>>, unsized: number }} Tally */

const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
/** The owner's local day of a moment, as YYYY-MM-DD. @param {number} ms */
export const dayOf = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
/** The network as the browser names it ('wifi', 'cellular', …) to the meter's three; anything else, or
 * nothing, is unknown (never inferred from speed). @param {unknown} type @returns {0 | 1 | 2} */
export const netOf = (type) => (type === 'wifi' ? 0 : type === 'cellular' ? 1 : 2);

/** An answer's size from its headers, as a service worker sees them: a 304 is its headers; otherwise
 * Content-Length (a range answer's is its range), else the span of Content-Range, plus the headers;
 * null when nothing says (never guessed).
 * @param {{ status: number, length?: string | null, range?: string | null }} r */
export function sizeOf({ status, length, range }) {
  if (status === 304) return HEADERS;
  const n = length == null || length === '' ? NaN : Number(length);
  if (Number.isFinite(n) && n >= 0) return n + HEADERS;
  const m = /^bytes (\d+)-(\d+)\//.exec(range ?? '');
  if (m) return Number(m[2]) - Number(m[1]) + 1 + HEADERS;
  return null;
}

/** A document's filter for its timeline's entries, true the first time an entry is seen. Chrome hands a
 * `buffered` navigation observer the page's navigation entry at once and again when its load ends, so an
 * observer started before the load ends saw it twice (the meter counted a page's own load twice): a
 * document has one navigation, counted once; any entry handed over again is the same object, seen once.
 * @returns {(e: { entryType: string }) => boolean} */
export function firstSight() {
  let navigated = false;
  const had = new WeakSet();
  return (e) => {
    if (had.has(e) || (e.entryType === 'navigation' && navigated)) return false;
    had.add(e);
    if (e.entryType === 'navigation') navigated = true;
    return true;
  };
}

/** A Resource Timing entry's bytes: nothing when it came from a cache or a service worker's answer (the
 * worker counts what it fetched); else transferSize; else encodedBodySize (a cross-origin answer without
 * Timing-Allow-Origin); else a Content-Length the code held for it; else null.
 * @param {{ transferSize: number, encodedBodySize: number, deliveryType?: string }} e @param {number | null} [held] */
export function entrySize(e, held = null) {
  if (e.deliveryType === 'cache') return 0;
  if (e.transferSize > 0) return e.transferSize;
  if (e.encodedBodySize > 0) return e.encodedBodySize;
  return held ?? null;
}

/** @param {number} now @returns {Tally} */
export const empty = (now) => ({ v: 1, since: now, days: {}, unsized: 0 });

/** A stored tally, checked: anything malformed starts again from now. @param {unknown} raw @param {number} now @returns {Tally} */
export function parse(raw, now) {
  const t = /** @type {any} */ (raw);
  if (!t || t.v !== 1 || !Number.isFinite(t.since) || typeof t.days !== 'object' || !t.days) return empty(now);
  /** @type {Tally} */
  const out = { v: 1, since: t.since, days: {}, unsized: Number.isFinite(t.unsized) ? t.unsized : 0 };
  for (const [day, parts] of Object.entries(t.days)) {
    if (!/^\d{4}-\d\d-\d\d$/.test(day) || !parts || typeof parts !== 'object') continue;
    for (const [id, s] of Object.entries(parts)) if (IDS.includes(id) && Array.isArray(s) && s.length === 3 && s.every((n) => Number.isFinite(n) && n >= 0)) (out.days[day] ??= {})[id] = /** @type {Split} */ ([...s]);
  }
  return out;
}

/** Adds bytes to a day, a part and a network. @param {Tally} t @param {string} day @param {string} id @param {number} net 0 | 1 | 2 @param {number} bytes */
export function add(t, day, id, net, bytes) {
  if (!IDS.includes(id) || !(bytes > 0) || !(net >= 0 && net <= 2)) return;
  const s = ((t.days[day] ??= {})[id] ??= [0, 0, 0]);
  s[net] += Math.round(bytes);
}

/** One tally into another (the page's batch into the stored one). @param {Tally} into @param {Tally} from */
export function merge(into, from) {
  for (const [day, parts] of Object.entries(from.days)) for (const [id, s] of Object.entries(parts)) s.forEach((n, net) => add(into, day, id, net, n));
  into.unsized += from.unsized;
  return into;
}

/** Drops days older than KEEP_DAYS, counting back from today. @param {Tally} t @param {number} now */
export function prune(t, now) {
  const d = new Date(now);
  const oldest = dayOf(new Date(d.getFullYear(), d.getMonth(), d.getDate() - (KEEP_DAYS - 1), 12).getTime());
  for (const day of Object.keys(t.days)) if (day < oldest) delete t.days[day];
  return t;
}

const plus = (/** @type {Split} */ a, /** @type {Split} */ b) => { a[0] += b[0]; a[1] += b[1]; a[2] += b[2]; };
const sum = (/** @type {Split} */ s) => s[0] + s[1] + s[2];

/** @typedef {{ id: string, name: string, icon: string, split: Split, pieces?: { name: string, split: Split }[] }} Row */
/** @typedef {{ all: Split, rows: Row[] }} Span */

/** Today's and this month's totals (the owner's local days), each with a row per part, largest first.
 * @param {Tally} t @param {number} now @returns {{ today: Span, month: Span }} */
export function totals(t, now) {
  const today = dayOf(now), month = today.slice(0, 7);
  const span = (/** @type {(day: string) => boolean} */ inside) => {
    /** @type {Record<string, Split>} */
    const by = {};
    for (const [day, parts] of Object.entries(t.days)) if (inside(day)) for (const [id, s] of Object.entries(parts)) plus((by[id] ??= [0, 0, 0]), s);
    /** @type {Split} */
    const all = [0, 0, 0];
    const rows = PARTS.map(([id, name, icon]) => {
      /** @type {Split} */
      const split = [0, 0, 0];
      const pieces = id === 'music' ? MUSIC.map(([m, n]) => ({ name: n, split: /** @type {Split} */ ([...(by[m] ?? [0, 0, 0])]) })) : undefined;
      if (pieces) for (const p of pieces) plus(split, p.split);
      else plus(split, by[id] ?? [0, 0, 0]);
      plus(all, split);
      return /** @type {Row} */ ({ id, name, icon, split, ...(pieces ? { pieces } : {}) });
    });
    rows.sort((a, b) => sum(b.split) - sum(a.split));
    return { all, rows };
  };
  return { today: span((d) => d === today), month: span((d) => d.startsWith(month)) };
}

/** A size in plain words: KB, MB or GB with one decimal (1024 to the next), the number and its unit on one line. @param {number} bytes */
export function words(bytes) {
  if (!(bytes > 0)) return '0\u00a0KB';
  let v = Math.max(bytes / 1024, 0.1), u = 0; // a few bytes read 0.1 KB, never 0.0
  const units = ['KB', 'MB', 'GB'];
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
  // One decimal, and 1,024 rounded up never reads "1024.0 KB".
  if (v.toFixed(1) === '1024.0' && u < units.length - 1) { v = 1; u++; }
  return `${v.toFixed(1)}\u00a0${units[u]}`;
}

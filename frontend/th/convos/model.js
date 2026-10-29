// @ts-check
// The menu's conversations and search, without the DOM (MENU-AND-SETTINGS.md §2, §3): which group
// a thread lands in by its day against today's (the Worker's logical day, so the 04:00 roll and the
// owner's zone are the Worker's), its title or the fallback date, each row's meta line, and the
// search helpers (accent folding, ±40-character snippets with the match marked, rows appended
// within their group). Dates are written out here, not by the locale, so "12 Sep" reads the same
// on every phone.

/** @typedef {import('../../../shared/contract/api.ts').Thread} Thread */
/** @typedef {import('../../../shared/contract/api.ts').SearchHit} SearchHit */
/** @typedef {{ text: string, bold: boolean }} Part */

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Older threads load this many at a time (§3.1). */
export const PAGE = 30;
/** Rows a search group shows before "Show all N" (§2.2). */
export const SHOWN = { goto: 4, convos: 5, memory: 3 };
/** Search starts at this many characters, after this pause (§2.1). */
export const MIN_CHARS = 2;
export const DEBOUNCE_MS = 150;

/** @param {string} day `YYYY-MM-DD` */
const parse = (day) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
/** Whole days from `a` to `b` (both `YYYY-MM-DD`). @param {string} a @param {string} b */
export const daysBetween = (a, b) => Math.round((parse(b).getTime() - parse(a).getTime()) / 86_400_000);

/** "12 Sep" @param {string} day */
export const shortDate = (day) => {
  const d = parse(day);
  return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;
};
/** "Saturday 12 September" @param {string} day */
export const longDate = (day) => {
  const d = parse(day);
  return `${WEEKDAY[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH[d.getUTCMonth()]}`;
};
/** "Sat" @param {string} day */
export const weekday = (day) => WD[parse(day).getUTCDay()];
/** "September 2026" @param {string} day */
export const monthLabel = (day) => `${MONTH[Number(day.slice(5, 7)) - 1]} ${day.slice(0, 4)}`;
/** `21:40` in the phone's own clock. @param {number} ms */
export const clock = (ms) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** The Now row's meta by the hour of its last message (05–12 / 12–18 / 18–22 / 22–05). @param {number} ms */
export function partOfDay(ms) {
  const h = new Date(ms).getHours();
  return h >= 5 && h < 12 ? 'this morning' : h >= 12 && h < 18 ? 'this afternoon' : h >= 18 && h < 22 ? 'this evening' : 'tonight';
}

/** The title on one line, else the thread's date (§3.2). @param {Thread} t */
export function titleOf(t) {
  const s = (t.title ?? '').replace(/\s+/g, ' ').trim();
  return s || longDate(t.day);
}

/** @typedef {'today' | 'yesterday' | 'week' | 'last' | 'older'} Group */

/** The menu's collapsible groups under Now, in order, with their headings (§3.1). */
export const GROUPS = /** @type {const} */ ([['yesterday', 'Yesterday'], ['week', 'Earlier this week'], ['last', 'Last week']]);

/** The Monday that starts `day`'s week (weeks run Monday to Sunday). @param {string} day */
export function mondayOf(day) {
  const d = parse(day);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/** Where a thread goes, by its day against today's on the calendar: today, yesterday, earlier this
 * week (since Monday), last week (the Monday to Sunday before), or older. A Saturday is never "this
 * week" on a Thursday. @param {string} day @param {string} today @returns {Group} */
export function groupOf(day, today) {
  const n = daysBetween(day, today);
  if (n <= 0) return 'today';
  if (n === 1) return 'yesterday';
  const monday = mondayOf(today);
  if (day >= monday) return 'week';
  return daysBetween(day, monday) <= 7 ? 'last' : 'older';
}

/** Newest day first, then the latest message first. @param {Thread} a @param {Thread} b */
const newest = (a, b) => (a.day === b.day ? b.updated_at - a.updated_at : a.day < b.day ? 1 : -1);

/** Whether a thread is today's open one, the Now row (left out of every list). @param {Thread} t @param {string} today @param {string | null} currentId */
export const isNow = (t, today, currentId) => t.id === currentId || (t.kind === 'daily' && t.status === 'open' && t.day >= today);

/**
 * The menu's groups. Today's open thread is the Now row, so it is left out; anything else of today
 * (an imported old chat started today) sits under it. Imported threads land by their own day like
 * every other.
 * @param {Thread[]} threads @param {string} today @param {string | null} currentId
 * @returns {Record<Group, Thread[]>}
 */
export function grouped(threads, today, currentId) {
  /** @type {Record<Group, Thread[]>} */
  const out = { today: [], yesterday: [], week: [], last: [], older: [] };
  for (const t of threads) if (!isNow(t, today, currentId)) out[groupOf(t.day, today)].push(t);
  for (const g of Object.values(out)) g.sort(newest);
  return out;
}

/** Threads by month, newest first: "October", or "December 2025" outside today's year.
 * @param {Thread[]} threads @param {string} today @returns {{ key: string, label: string, items: Thread[] }[]} */
export function byMonth(threads, today) {
  /** @type {Map<string, Thread[]>} */
  const months = new Map();
  for (const t of [...threads].sort(newest)) {
    const k = t.day.slice(0, 7);
    if (!months.has(k)) months.set(k, []);
    months.get(k)?.push(t);
  }
  return [...months].map(([key, items]) => ({ key, label: key.slice(0, 4) === today.slice(0, 4) ? MONTH[Number(key.slice(5)) - 1] : monthLabel(key), items }));
}

/** "Sat 24" @param {string} day */
export const dayLabel = (day) => `${weekday(day)} ${parse(day).getUTCDate()}`;

/** A row's date on the right: the time of its last message yesterday, else its weekday and date
 * ("Sat 24"), so two days are never in doubt. @param {Thread} t @param {Group} g */
export function metaOf(t, g) {
  if (g === 'today') return partOfDay(t.updated_at);
  if (g === 'yesterday') return clock(t.updated_at);
  return dayLabel(t.day);
}

/** "1 message", "14 messages" @param {number} n */
export const count = (n) => `${n} ${n === 1 ? 'message' : 'messages'}`;

/** A row's second line: the night shift's summary on one line, else how many messages. @param {Thread} t */
export const subOf = (t) => (t.summary ?? '').replace(/\s+/g, ' ').trim() || count(t.message_count);

/** The past view's "when": "Today", "Yesterday", "Monday 26 October", "Wednesday 3 December 2025".
 * @param {string} day @param {string} today */
export function whenOf(day, today) {
  const g = groupOf(day, today);
  if (g === 'today') return 'Today';
  if (g === 'yesterday') return 'Yesterday';
  return day.slice(0, 4) === today.slice(0, 4) ? longDate(day) : `${longDate(day)} ${day.slice(0, 4)}`;
}

/** The tag on an imported thread's row and in its past view. */
export const OLD_CHATS = 'Old Chats';

// --- search -----------------------------------------------------------------------------------

/** Lower-cased and accent-folded, with where each folded character came from. @param {string} s */
export function fold(s) {
  let text = '';
  /** @type {number[]} */
  const at = [];
  let i = 0;
  for (const ch of s) {
    const f = ch.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    for (let k = 0; k < f.length; k++) at.push(i);
    text += f;
    i += ch.length;
  }
  at.push(i);
  return { text, at };
}
/** @param {string} s */
export const folded = (s) => fold(s).text;

/** Where `q` is in `text`, accent- and case-blind, as [start, end) of the original. @param {string} text @param {string} q */
export function find(text, q) {
  const f = fold(text);
  const n = folded(q).trim();
  const i = n ? f.text.indexOf(n) : -1;
  return i < 0 ? null : /** @type {[number, number]} */ ([f.at[i], f.at[i + n.length]]);
}

/** ±`pad` characters around [start, end), the match bold, "…" where text was cut. @param {string} text @param {number} start @param {number} end @returns {Part[]} */
export function around(text, start, end, pad = 40) {
  const a = Math.max(0, start - pad);
  const b = Math.min(text.length, end + pad);
  return [
    { text: `${a > 0 ? '…' : ''}${text.slice(a, start)}`, bold: false },
    { text: text.slice(start, end), bold: true },
    { text: `${text.slice(end, b)}${b < text.length ? '…' : ''}`, bold: false },
  ].filter((p) => p.text);
}

/** The Worker's snippet ("…a «calm» playlist…") as parts, cut to ±40 characters around the first
 * match. @param {string} snippet @returns {Part[]} */
export function snippetParts(snippet) {
  const one = snippet.replace(/\s+/g, ' ');
  const s = one.indexOf('«');
  const e = one.indexOf('»', s);
  if (s < 0 || e < 0) return [{ text: one.replace(/[«»]/g, ''), bold: false }];
  const plain = one.replace(/[«»]/g, '');
  const parts = around(plain, s, e - 1);
  return parts;
}

/** How well a name matches: 0 exact, 1 prefix, 2 a word's prefix, 3 inside, -1 not at all. @param {string} name @param {string} q */
export function rank(name, q) {
  const n = folded(name);
  const f = folded(q).trim();
  if (!f) return -1;
  if (n === f) return 0;
  if (n.startsWith(f)) return 1;
  if (n.split(/[\s·-]+/).some((w) => w.startsWith(f))) return 2;
  return n.includes(f) ? 3 : -1;
}

/** Rows appended to a group, never reordering the ones there: new refs go at the end. @template {{ ref: string }} R @param {R[]} rows @param {R[]} more */
export function append(rows, more) {
  const seen = new Set(rows.map((r) => r.ref));
  return [...rows, ...more.filter((r) => !seen.has(r.ref) && (seen.add(r.ref), true))];
}

/** The message or fact id inside a hit's ref (`msg:<id>`). @param {string} ref */
export const refId = (ref) => ref.slice(ref.indexOf(':') + 1);

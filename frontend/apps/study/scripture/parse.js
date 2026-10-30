// @ts-check
// The scripture-reference parser (STUDY.md §7). One pure module, run on the phone (the ask bar and
// search, offline too), in the Worker (every ref it stores is validated here) and in the ingestion
// job (refs in book text), so all three agree. The code is public; the book table it reads is the
// owner's and lives only in the private bucket (owner ruling 2026-10-28). Tests use invented books.
//
// It finds "Book A 3:12", "2 Bet. 4:7", "Second Beta 4:7", ranges with any dash, lists ("3:12,
// 17–19"), chains ("3:12; 4:2"), cross-chapter ranges, whole chapters, and single-chapter books;
// case and extra spaces don't matter and a period after an abbreviation is optional. Guards: a book
// name alone is nothing; the chapter and verse must exist; a whole-chapter form of a book whose
// name is also a common word or a person's needs a reference-like context; a numbered book without
// its number is nothing; bare "3:16" is nothing unless it continues a list; URLs, email addresses
// and code spans are skipped.

/**
 * @typedef {{ code: string, volume: string, name: string, abbr: string, aliases?: string[],
 *   chapters: number, verses: number[], single_chapter?: boolean, name_collision?: boolean,
 *   link_volume?: string, link_book?: string }} ScriptureBook
 * @typedef {{ v: 1, books: ScriptureBook[], totals?: Record<string, number>, source?: string,
 *   checked_at?: string, links?: { chapter: string, verse: string, range: string } }} ScriptureTable
 * @typedef {{ ref: string, code: string, chapter: number, v_start: number | null, v_end: number | null,
 *   start: number, end: number, listed: boolean }} Found
 * @typedef {{ table: ScriptureTable, byCode: Map<string, ScriptureBook>, names: RegExp, byName: Map<string, ScriptureBook> }} Index
 */

const ORDINALS = {
  1: ['1', '1st', 'first', 'i'],
  2: ['2', '2nd', 'second', 'ii'],
  3: ['3', '3rd', 'third', 'iii'],
  4: ['4', '4th', 'fourth', 'iv'],
};
/** Words after a whole-chapter number that make it a count, not a chapter (rule 4). */
const UNITS =
  /^\s*(?:(?:years?|days?|weeks?|months?|times?|hours?|minutes?|seconds?|people|persons?|men|women|children|kids|friends|students|members|visitors|guests|miles?|km|pages?|dollars?|cents?|points?|items?|things?|ways?|books?|songs?|percent|of|am|pm)\b|%|a\.m\.|p\.m\.|:(?!\s*\d))/i;
const NUMBER_WORDS = /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|dozen|hundred|thousand|million|about|nearly|over|under|some)\s*$/i;
const DASH = '[-\\u2010-\\u2015]';

/** A name as it is compared: lower case, `&` spaced, periods and extra spaces gone. @param {string} s */
export const norm = (s) =>
  s
    .toLowerCase()
    .replace(/&/g, ' & ')
    .replace(/\./g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Every way a book is written: its name, abbreviation, aliases, and a numbered book's number
 * spelled out ("2nd", "Second", "II"). @param {ScriptureBook} b */
function namesOf(b) {
  const out = new Set();
  for (const raw of [b.name, b.abbr, ...(b.aliases ?? [])]) {
    const n = norm(raw);
    if (!n) continue;
    out.add(n);
    const m = /^([1-4]) (.+)$/.exec(n);
    if (m) for (const w of ORDINALS[/** @type {1|2|3|4} */ (Number(m[1]))]) out.add(`${w} ${m[2]}`);
  }
  return [...out];
}

const esc = (/** @type {string} */ s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The table made ready for parsing (build it once per table). @param {ScriptureTable} table @returns {Index} */
export function makeIndex(table) {
  /** @type {Map<string, ScriptureBook>} */
  const byName = new Map();
  for (const b of table.books) for (const n of namesOf(b)) if (!byName.has(n)) byName.set(n, b);
  // Longest names first, so "2 Beta" wins over a shorter name inside it. In the text a period may
  // follow any word and spaces may vary ("S. & N.", "S&N").
  const alts = [...byName.keys()]
    .sort((a, b) => b.length - a.length)
    .map((n) => n.split(' ').map((w) => `${esc(w)}\\.?`).join('\\s*'));
  const names = new RegExp(`(?<![\\p{L}\\p{N}])(${alts.join('|')})(?![\\p{L}])`, 'giu');
  return { table, byCode: new Map(table.books.map((b) => [b.code, b])), names, byName };
}

/** Problems with a table (STUDY.md §7.1), [] when none. @param {ScriptureTable} t @returns {string[]} */
export function checkTable(t) {
  const out = [];
  if (!t || t.v !== 1 || !Array.isArray(t.books) || !t.books.length) return ['a table needs v 1 and books'];
  const seen = new Map();
  const totals = /** @type {Record<string, number>} */ ({});
  for (const b of t.books) {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(b.code ?? '')) out.push(`${b.code}: code`);
    if (!b.name || !b.abbr || !b.volume) out.push(`${b.code}: name, abbr and volume`);
    if (!Number.isInteger(b.chapters) || b.chapters < 1 || !Array.isArray(b.verses) || b.verses.length !== b.chapters)
      out.push(`${b.code}: one verse count per chapter`);
    else if (!b.verses.every((v) => Number.isInteger(v) && v >= 1)) out.push(`${b.code}: verse counts ≥ 1`);
    else totals[b.volume] = (totals[b.volume] ?? 0) + b.verses.reduce((a, v) => a + v, 0);
    for (const n of namesOf(b)) {
      const other = seen.get(n);
      if (other && other !== b.code) out.push(`"${n}" names ${other} and ${b.code}`);
      seen.set(n, b.code);
    }
  }
  for (const [vol, want] of Object.entries(t.totals ?? {}))
    if (totals[vol] !== want) out.push(`${vol}: ${totals[vol] ?? 0} verses, the published total is ${want}`);
  return out;
}

/** `verse:<code>/<ch>[/<v>[-<v>]]` → its parts, or null. @param {string} ref */
export function splitRef(ref) {
  const m = /^verse:([a-z0-9]+(?:-[a-z0-9]+)*)\/(\d{1,4})(?:\/(\d{1,4})(?:-(\d{1,4}))?)?$/.exec(ref);
  if (!m) return null;
  const v1 = m[3] ? Number(m[3]) : null;
  return { code: m[1], chapter: Number(m[2]), v_start: v1, v_end: m[4] ? Number(m[4]) : v1 };
}

/** Whether a ref names a real place in the table (STUDY.md §7.4). @param {string} ref @param {Index} ix */
export function validRef(ref, ix) {
  const p = splitRef(ref);
  const b = p && ix.byCode.get(p.code);
  if (!p || !b || p.chapter < 1 || p.chapter > b.chapters) return false;
  if (p.v_start === null) return true;
  const max = b.verses[p.chapter - 1];
  return p.v_start >= 1 && /** @type {number} */ (p.v_end) >= p.v_start && /** @type {number} */ (p.v_end) <= max;
}

/** @param {string} code @param {number} ch @param {number | null} v1 @param {number | null} v2 */
export const refOf = (code, ch, v1, v2) =>
  `verse:${code}/${ch}${v1 === null ? '' : `/${v1}${v2 !== null && v2 !== v1 ? `-${v2}` : ''}`}`;

/** "Book A 3:12–14" for a ref. @param {string} ref @param {Index} ix */
export function display(ref, ix) {
  const p = splitRef(ref);
  const b = p && ix.byCode.get(p.code);
  if (!p || !b) return ref;
  if (p.v_start === null) return `${b.name} ${p.chapter}`;
  const vs = p.v_end !== p.v_start ? `${p.v_start}–${p.v_end}` : `${p.v_start}`;
  return b.single_chapter ? `${b.name} ${vs}` : `${b.name} ${p.chapter}:${vs}`;
}

/** The source site's link for a ref, from the private template, or null. @param {string} ref @param {Index} ix */
export function linkFor(ref, ix) {
  const p = splitRef(ref);
  const b = p && ix.byCode.get(p.code);
  const t = ix.table.links;
  if (!p || !b || !t || !b.link_volume || !b.link_book) return null;
  const tpl = p.v_start === null ? t.chapter : p.v_end !== p.v_start ? t.range : t.verse;
  return tpl
    .replaceAll('{volume}', encodeURIComponent(b.link_volume))
    .replaceAll('{book}', encodeURIComponent(b.link_book))
    .replaceAll('{chapter}', String(p.chapter))
    .replaceAll('{v1}', String(p.v_start ?? ''))
    .replaceAll('{v2}', String(p.v_end ?? ''));
}

/** URLs, email addresses and code spans, blanked to spaces so nothing in them matches (rule 7). @param {string} s */
const mask = (s) =>
  s.replace(/`[^`]*`|\bhttps?:\/\/\S+|\bwww\.\S+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+/gi, (m) => ' '.repeat(m.length));

/**
 * Every reference in a text.
 * @param {string} text
 * @param {Index} ix
 * @param {'ask' | 'book'} [context] book text keeps a common-word book's whole-chapter form only in
 *   parentheses, after "see"/"cf.", or in a list with another reference
 * @returns {Found[]}
 */
export function findRefs(text, ix, context = 'ask') {
  const s = mask(text);
  /** @type {Found[]} */
  const out = [];
  ix.names.lastIndex = 0;
  for (let m = ix.names.exec(s); m; m = ix.names.exec(s)) {
    const book = ix.byName.get(norm(m[1]));
    if (!book) continue;
    const found = afterName(s, m.index + m[0].length, book, m.index, context);
    if (found.length) {
      out.push(...found);
      ix.names.lastIndex = found.at(-1)?.end ?? ix.names.lastIndex;
    }
  }
  return out;
}

/**
 * The references after a book's name at `at`: chapter[:verse[-verse | -ch:verse]] and what lists
 * or chains on from it.
 * @param {string} s @param {number} at @param {ScriptureBook} b @param {number} nameStart
 * @param {'ask' | 'book'} context @returns {Found[]}
 */
function afterName(s, at, b, nameStart, context) {
  const head = new RegExp(`^\\s{0,3}(\\d{1,3})(?:\\s*:\\s*(\\d{1,3})(?:\\s*${DASH}\\s*(\\d{1,3})(?:\\s*:\\s*(\\d{1,3}))?)?)?`, 'u');
  const m = head.exec(s.slice(at));
  if (!m) return [];
  const end = at + m[0].length;
  const ch = Number(m[1]);
  /** @type {Found[]} */
  const out = [];
  const push = (/** @type {number} */ c, /** @type {number|null} */ v1, /** @type {number|null} */ v2, /** @type {number} */ a, /** @type {number} */ z, listed = false) => {
    const ref = refOf(b.code, c, v1, v2);
    out.push({ ref, code: b.code, chapter: c, v_start: v1, v_end: v1 === null ? null : (v2 ?? v1), start: a, end: z, listed });
  };
  if (m[2] === undefined) {
    // A whole chapter, or a verse of a one-chapter book ("Delta 3").
    if (b.single_chapter) {
      if (ch < 1 || ch > b.verses[0]) return [];
      // "Delta 3" is a verse, but the same guard as a whole chapter: "Delta 3 people" is a count.
      if (b.name_collision && !chapterContextOk(s, nameStart, end, context)) return [];
      push(1, ch, null, nameStart, end);
    } else {
      if (ch < 1 || ch > b.chapters) return [];
      if (b.name_collision && !chapterContextOk(s, nameStart, end, context)) return [];
      push(ch, null, null, nameStart, end);
    }
    return more(s, end, b, out, ch);
  }
  const v1 = Number(m[2]);
  if (ch < 1 || ch > b.chapters || v1 < 1 || v1 > b.verses[ch - 1]) return [];
  if (m[4] !== undefined) {
    // Book A 3:12–4:1: to the chapter's last verse, then the next chapter from its first.
    const ch2 = Number(m[3]);
    const v2 = Number(m[4]);
    if (ch2 <= ch || ch2 > b.chapters || v2 < 1 || v2 > b.verses[ch2 - 1]) return [];
    push(ch, v1, b.verses[ch - 1], nameStart, end);
    push(ch2, 1, v2, nameStart, end);
    return more(s, end, b, out, ch2);
  }
  const v2 = m[3] !== undefined ? Number(m[3]) : v1;
  if (v2 < v1 || v2 > b.verses[ch - 1]) return [];
  push(ch, v1, v2 === v1 ? null : v2, nameStart, end);
  return more(s, end, b, out, ch);
}

/** ", 17–19" (more verses of the chapter) and "; 4:2" (another place in the same book). */
function more(/** @type {string} */ s, /** @type {number} */ at, /** @type {ScriptureBook} */ b, /** @type {Found[]} */ out, /** @type {number} */ ch) {
  const list = new RegExp(`^\\s*,\\s*(\\d{1,3})(?:\\s*${DASH}\\s*(\\d{1,3}))?(?![\\d:])`, 'u');
  const chain = new RegExp(`^\\s*;\\s*(\\d{1,3})\\s*:\\s*(\\d{1,3})(?:\\s*${DASH}\\s*(\\d{1,3}))?`, 'u');
  for (;;) {
    const rest = s.slice(at);
    const l = out.at(-1)?.v_start !== null ? list.exec(rest) : null;
    const c = l ? null : chain.exec(rest);
    const hit = l ?? c;
    if (!hit) break;
    const cc = c ? Number(c[1]) : ch;
    const v1 = Number(c ? c[2] : hit[1]);
    const v2raw = c ? c[3] : hit[2];
    const v2 = v2raw !== undefined ? Number(v2raw) : v1;
    if (cc < 1 || cc > b.chapters || v1 < 1 || v2 < v1 || v2 > b.verses[cc - 1]) break;
    const end = at + hit[0].length;
    for (const f of out) f.listed = true;
    out.push({ ref: refOf(b.code, cc, v1, v2), code: b.code, chapter: cc, v_start: v1, v_end: v2, start: at, end, listed: true });
    ch = cc;
    at = end;
  }
  return out;
}

/** Rule 4: a whole chapter of a book whose name is also a common word or a person's. */
function chapterContextOk(/** @type {string} */ s, /** @type {number} */ a, /** @type {number} */ z, /** @type {'ask'|'book'} */ context) {
  if (UNITS.test(s.slice(z))) return false;
  if (NUMBER_WORDS.test(s.slice(0, a))) return false;
  if (context === 'ask') return true;
  const before = s.slice(Math.max(0, a - 12), a);
  if (/\(\s*$/.test(before) || /\b(?:see|cf)\.?\s*$/i.test(before)) return true;
  // In a list with another reference ("Book A 3:12; Gamma 10").
  return /[;,]\s*$/.test(before) || /^\s*[;,]/.test(s.slice(z));
}

/** Text that is only a reference ("2 Bet 4:7"): its refs, else null (the ask bar opens the verse
 * page for it without waking the mind). @param {string} text @param {Index} ix */
export function onlyRefs(text, ix) {
  const found = findRefs(text, ix);
  if (!found.length) return null;
  const left = found.reduce((t, f) => t.slice(0, f.start) + ' '.repeat(f.end - f.start) + t.slice(f.end), text);
  return /^[\s.,;:!?]*$/.test(left) ? found : null;
}

/** The ask bar's hint for a verse that isn't there ("Book A 3 has 24 verses."), else null.
 * @param {string} text @param {Index} ix */
export function hint(text, ix) {
  ix.names.lastIndex = 0;
  const m = ix.names.exec(mask(text));
  const b = m && ix.byName.get(norm(m[1]));
  if (!m || !b) return null;
  const r = /^\s*(\d{1,3})\s*:\s*(\d{1,3})/.exec(text.slice(m.index + m[0].length));
  if (!r) return null;
  const ch = Number(r[1]);
  if (ch < 1) return null;
  if (ch > b.chapters) return `${b.name} has ${b.chapters} chapter${b.chapters === 1 ? '' : 's'}.`;
  const n = b.verses[ch - 1];
  return Number(r[2]) > n ? `${b.name} ${ch} has ${n} verse${n === 1 ? '' : 's'}.` : null;
}

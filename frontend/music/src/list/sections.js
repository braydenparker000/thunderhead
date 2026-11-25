// The fast-scroll rail's sections (owner 2026-11-25: the rail matches the sort on every list). A
// sorted list's source carries `sections` = {type, of, reversed}: `of(item)` reads the sorted field of
// a row's song or group, and the type says how it divides:
//   letters: the first letter of that field (the alphabet column, Z→A when reversed);
//   years:   each year in the list, in list order (the bubble shows the exact year);
//   months:  each month in the list, in list order ("Nov", "’25" where the year changes); the bubble
//            shows the month and day of the row under the finger ("Nov 24").
// Sorts with no natural sections (track number, duration, play count, rating, track count, playlist
// order, shuffle, the Queue) leave `sections` unset: the plain thumb. No DOM here (unit tests).

export const AZ_CHARS = '0ABCDEFGHIJKLMNOPQRSTUVWXYZ#';
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ARTICLE = /^(the|a|an)\s+/i;
const UNKNOWN = '#';

/** Section char of a title: digits under '0', Latin letters by letter, the rest under '#'. */
export function sectionChar(title, chars = AZ_CHARS) {
  const c = String(title ?? '').trim().normalize('NFD').charAt(0).toUpperCase();
  if (!c) return chars[chars.length - 1];
  if (/[0-9]/.test(c)) return chars[0];
  return chars.includes(c) ? c : chars[chars.length - 1];
}

/** The column of a reversed name sort, in list order: the letters Z→A, then digits, then the rest. */
export function reversedChars(chars = AZ_CHARS) {
  return [...chars.slice(1, -1)].reverse().join('') + chars[0] + chars[chars.length - 1];
}

export const letters = (of, reversed = false) => ({type: 'letters', of, reversed});
export const years = of => ({type: 'years', of});
export const months = of => ({type: 'months', of});

// A path's first letter is its top folder's, not the slash before it.
const pathOf = s => String(s ?? '').replace(/^[/\\]+/, '');
const stripped = (s, articles) => (articles ? String(s ?? '').replace(ARTICLE, '') : s);
const maxAdded = g => g?.tracks?.reduce((m, t) => Math.max(m, t.added || 0), 0) ?? 0;
const minYear = g => g?.tracks?.reduce((m, t) => (t.year && (!m || t.year < m) ? t.year : m), 0) ?? 0;

/** Songs' sections by sort value (list-opts.js SORTS.tracks); null for a plain thumb. */
const TRACK_SECTIONS = {
  1: () => letters(t => t?.title),
  2: () => letters(t => t?.fileName),
  14: () => letters(t => pathOf(t?.path ?? t?.fileName)),
  8: () => letters(t => t?.artist),
  9: () => letters(t => t?.album),
  3: () => years(t => t?.year),
  15: () => years(t => t?.year),
  12: () => months(t => t?.added),
  4: () => months(t => t?.modified || t?.added),
  7: () => months(t => t?.lastPlayed),
};

/** Group lists' sections by their sort (sources.js GROUP_SORT names); null for a plain thumb. */
const GROUP_SECTIONS = {
  0: ({articles, yearTitles}) => (yearTitles ? years(g => Number(g?.title)) : letters(g => stripped(g?.title, articles))),
  artist: ({articles}) => letters(g => stripped(g?.artist ?? g?.tracks?.[0]?.artist, articles)),
  albumArtist: ({articles}) => letters(g => stripped(g?.tracks?.[0]?.albumArtist || g?.tracks?.[0]?.artist, articles)),
  year: () => years(minYear),
  added: () => months(g => g?.pl?.created ?? maxAdded(g)),
  modified: () => months(g => g?.pl?.modified ?? maxAdded(g)),
  pathCs: () => letters(g => pathOf(g?.path ?? g?.title)),
  path: () => letters(g => pathOf(g?.path ?? g?.title)),
};

/**
 * The sections of a list sorted by `value` (REVERSE stripped, `reversed` apart): songs by their sort
 * value, groups by their GROUP_SORT name (`group`). `articles`: names sort without "the", "a", "an";
 * `yearTitles`: the Years list, whose names are years.
 */
export function sectionsFor({group = null, value = 0, reversed = false, articles = false, yearTitles = false}) {
  const make = group != null ? GROUP_SECTIONS[group] : TRACK_SECTIONS[value];
  const s = make?.({articles, yearTitles}) ?? null;
  if (s) s.reversed = reversed;
  return s;
}

/** The song or group a row's section reads; a subhead reads the first row after it. */
export function rowItem(src, i) {
  const rows = src.pageRows;
  if (rows) {
    for (let j = i; j < rows.length; j++) if (rows[j].sep == null) return rows[j].track ?? rows[j].group;
    return undefined;
  }
  return src.groups ? src.groups[i] : src.tracks?.[i];
}

const validYear = v => {
  const y = Math.trunc(Number(v));
  return y > 0 && y < 9999 ? y : 0;
};
const validTime = v => (Number(v) > 0 ? Number(v) : 0);

/** "Nov 24": a date's month and day (local time); '#' without one. */
export function monthDay(ms) {
  if (!validTime(ms)) return UNKNOWN;
  const d = new Date(Number(ms));
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/**
 * A source's section index: `entries` ({text, year?} per column entry, in list order), each entry's
 * first row and row count, each row's entry. rowFor(e, sub) is the row a touch at fraction sub of
 * entry e scrolls to; bubble(row) the bubble's text for a row; touchBubble(e, row) for a touched entry.
 */
export function buildIndex(src, chars = AZ_CHARS) {
  const s = src?.sections, n = src?.count ?? 0;
  if (!s || !n) return null;
  const entryOf = new Int32Array(n), first = [], counts = [];
  let entries;
  const note = (k, i) => {
    entryOf[i] = k;
    if (first[k] === undefined) first[k] = i;
    counts[k] = (counts[k] ?? 0) + 1;
  };
  if (s.type === 'letters') {
    const col = s.reversed ? reversedChars(chars) : chars;
    entries = [...col].map(text => ({text}));
    const at = new Map([...col].map((c, k) => [c, k]));
    for (let i = 0; i < n; i++) note(at.get(sectionChar(s.of(rowItem(src, i)), chars)), i);
  } else {
    entries = [];
    const at = new Map();
    for (let i = 0; i < n; i++) {
      const v = s.of(rowItem(src, i));
      let key, entry;
      if (s.type === 'years') {
        const y = validYear(v);
        key = y || UNKNOWN;
        entry = y ? {text: String(y)} : {text: UNKNOWN};
      } else {
        const t = validTime(v), d = t ? new Date(t) : null;
        key = d ? d.getFullYear() * 12 + d.getMonth() : UNKNOWN;
        entry = d ? {text: MONTHS[d.getMonth()], year: d.getFullYear()} : {text: UNKNOWN};
      }
      let k = at.get(key);
      if (k === undefined) { k = entries.length; at.set(key, k); entries.push(entry); }
      note(k, i);
    }
  }
  const other = s.type === 'letters' ? entries.length - 1 : -1;
  // Letters with no rows go to the next later letter's first row (symbol titles, under '#' at the
  // column's end, are not later): computed from the column's end.
  const later = new Array(entries.length).fill(-1);
  for (let k = entries.length - 2, best = -1; k >= 0; k--) {
    if (k + 1 !== other && first[k + 1] !== undefined && (best < 0 || first[k + 1] < best)) best = first[k + 1];
    later[k] = best;
  }
  return {
    type: s.type, entries, first, counts, entryOf, count: n,
    rowFor(e, sub = 0) {
      if (first[e] === undefined) {
        if (later[e] >= 0) return later[e];
        // An empty '#': symbol titles sort first (last when reversed); an empty letter: the end.
        return e === other && !s.reversed ? 0 : n - 1;
      }
      // Months scrub through their days; letters and years go to their first row.
      if (s.type !== 'months') return first[e];
      return Math.min(n - 1, first[e] + Math.min(counts[e] - 1, Math.floor(Math.max(0, sub) * counts[e])));
    },
    bubble(row) {
      const r = Math.max(0, Math.min(n - 1, row));
      return s.type === 'months' ? monthDay(s.of(rowItem(src, r))) : entries[entryOf[r]].text;
    },
    touchBubble(e, row) {
      return s.type === 'months' && first[e] !== undefined ? this.bubble(row) : entries[e].text;
    },
  };
}

// One index per source and alphabet, made again when its rows change.
const cache = new WeakMap();
export function sectionIndex(src, chars = AZ_CHARS) {
  if (!src?.sections) return null;
  const c = cache.get(src);
  if (c && c.chars === chars && c.sections === src.sections && c.count === src.count && c.tracks === src.tracks && c.groups === src.groups && c.rows === src.pageRows) return c.index;
  const index = buildIndex(src, chars);
  cache.set(src, {chars, sections: src.sections, count: src.count, tracks: src.tracks, groups: src.groups, rows: src.pageRows, index});
  return index;
}

/** The entries shown when only m of n fit: evenly spread, each the one under its slot's middle. */
export function thinned(n, m) {
  const k = Math.max(1, Math.min(n, m));
  return Array.from({length: k}, (_, j) => (k === n ? j : Math.min(n - 1, Math.floor(((j + 0.5) * n) / k))));
}

/**
 * The column's labels for the shown entries: a month shows its short name, or "’25" where the year
 * changes from the label above it (the first one when it is not this year).
 */
export function columnLabels(entries, shown, nowYear = new Date().getFullYear()) {
  let prev = nowYear;
  return shown.map(e => {
    const x = entries[e];
    if (x.year == null) return x.text;
    const text = x.year !== prev ? '’' + String(x.year).slice(-2) : x.text;
    prev = x.year;
    return text;
  });
}

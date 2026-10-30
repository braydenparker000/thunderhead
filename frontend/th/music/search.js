// Better song search for the Music player (MUSIC.md §8; the owner's day-1 request: "genuinely
// better than normal search, never worse"). Every song the player's own search finds stays found;
// on top, accents and punctuation don't matter (§8.2), words match in any order and one typo per
// word of 4 letters or more is forgiven, and the songs come best first (§8.3's tiers: the title is
// the query, starts with it; the artist is it, starts with it; the album; every word starts a word;
// every word is inside; a typo away), A–Z inside a tier as before. Nothing leaves the phone.

/** §8.2: accents off, lower case, `&`/`+` → "and", apostrophes gone, other punctuation a space. @param {unknown} s */
export function norm(s) {
  return String(s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/æ/g, 'ae')
    .replace(/ø/g, 'o')
    .replace(/ł/g, 'l')
    .replace(/[&+]/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Whether two words are at most one edit apart (a change, an extra or missing letter, two swapped). @param {string} a @param {string} b */
export function oneOff(a, b) {
  if (a === b) return true;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0;
  while (i < la && i < lb && a[i] === b[i]) i++;
  if (la === lb) return a.slice(i + 1) === b.slice(i + 1) || (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
  return la > lb ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

/** @typedef {{ title: string, artist: string, album: string, all: string, words: string[] }} Fields */
/** @type {WeakMap<object, { key: string, f: Fields }>} */
const cache = new WeakMap();

/** A song's search fields, normalised once. @param {any} t @param {string} title @param {boolean} titlesOnly */
function fieldsOf(t, title, titlesOnly) {
  const key = `${titlesOnly ? 1 : 0}|${title}`;
  const had = cache.get(t);
  if (had?.key === key) return had.f;
  const f = { title: norm(title), artist: titlesOnly ? '' : norm(t.artist), album: titlesOnly ? '' : norm(t.album), all: '', words: /** @type {string[]} */ ([]) };
  f.all = `${f.title} ${f.artist} ${f.album}`.trim();
  f.words = f.all.split(' ').filter(Boolean);
  cache.set(t, { key, f });
  return f;
}

/** The tier of a song for a query, 0 best, or -1 for no match. @param {Fields} f @param {string} q @param {string[]} qw */
export function tier(f, q, qw) {
  if (!q) return -1;
  if (f.title === q) return 0;
  if (f.title.startsWith(q)) return 1;
  if (f.artist && f.artist === q) return 2;
  if (f.artist?.startsWith(q)) return 3;
  if (f.album?.startsWith(q)) return 4;
  if (qw.every((w) => f.words.some((x) => x.startsWith(w)))) return 5;
  if (qw.every((w) => f.all.includes(w))) return 6;
  if (qw.every((w) => f.all.includes(w) || (w.length >= 4 && f.words.some((x) => oneOff(w, x) || (x.length > w.length && oneOff(w, x.slice(0, w.length))))))) return 7;
  return -1;
}

/**
 * The player's song hits, kept, ranked best first, with the songs only this search finds after them
 * in their tiers.
 * @template T
 * @param {T[]} pool every song searched @param {string} query @param {T[]} plain the player's own hits, A–Z
 * @param {(t: T) => string} title the line the player shows @param {boolean} [titlesOnly]
 * @returns {T[]}
 */
export function smartSongs(pool, query, plain, title, titlesOnly = false) {
  const q = norm(query);
  const qw = q.split(' ').filter(Boolean);
  const place = new Map(plain.map((t, i) => [t, i]));
  /** @type {[T, number, string][]} */
  const out = [];
  for (const t of pool) {
    const f = fieldsOf(t, title(t) ?? '', titlesOnly);
    let k = tier(f, q, qw);
    if (k < 0 && place.has(t)) k = 6;
    if (k >= 0) out.push([t, k, f.title]);
  }
  out.sort((a, b) => a[1] - b[1] || (place.get(a[0]) ?? Infinity) - (place.get(b[0]) ?? Infinity) || (a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0));
  return out.map((x) => x[0]);
}

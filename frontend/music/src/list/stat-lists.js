// The statistics lists (Most Played, Recently Played, Recently Added, Top Rated, Low Rated; the
// reference's oi1, zi1, yi1, sj1, ii1): a filter, the list's own ranking and the sort value that
// names that ranking in List Options, Max Items (*_files_limit, 200 by default, m30.d) and, for
// the lists with Clear / Show All (ch1), the time they start from (*_from; 0 shows all).
//
// The rule (owner audit 2026-11-26): Max Items cuts the list's own ranking, never another order.
// - Sorted by its own ranking (the default; Reverse only turns it round): the songs the filter
//   keeps, ranked, cut to Max Items (200 unless the user chose another), in that ranking.
// - Sorted any other way: every song the filter keeps, in that sort, with no silent cut; only a
//   Max Items the user chose themselves still cuts, and it cuts the ranking first (the 500 most
//   played, then by title).
// No DOM here (unit tests).

export const DEFAULT_LIMIT = 200, NO_LIMIT = 2147483647;
const REVERSE = 0x40000000; // list-opts.js REVERSE

const recency = t => Math.max(t.ratedAt || 0, t.lastPlayed || 0);
const PLAIN = new Intl.Collator();
const byTitle = (a, b) => PLAIN.compare(a.title ?? '', b.title ?? '');

export const STAT_LISTS = {
  mostPlayed: {keep: (t, from) => t.plays > 0 && (t.lastPlayed ?? 0) > from, rank: (a, b) => b.plays - a.plays || (b.lastPlayed || 0) - (a.lastPlayed || 0), sort: 6, clearable: true},
  recentlyPlayed: {keep: (t, from) => (t.lastPlayed ?? 0) > from, rank: (a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0), sort: 7, clearable: true},
  recent: {keep: (t, from) => !from || (t.added ?? 0) > from, rank: (a, b) => (b.added || 0) - (a.added || 0), sort: 12, clearable: true},
  topRated: {keep: t => t.rating > 1, rank: (a, b) => b.rating - a.rating || recency(b) - recency(a), sort: 5},
  // Lowest rating first, then the most recently rated or played.
  lowRated: {keep: t => t.rating === 1, rank: (a, b) => a.rating - b.rating || recency(b) - recency(a), sort: 5 | REVERSE},
};

/** Whether a sort value is the list's own ranking (Reverse aside). */
export const ownRanking = (stat, sort) => sort == null || ((sort ^ stat.sort) & ~REVERSE) === 0;

/**
 * A statistics list's songs by the rule above: {tracks, limit, ranked}. opts are its saved List
 * Options ({sort, limit, from}); ranked: the songs are in the list's own ranking (turned round when
 * the sort's Reverse differs from the ranking's), to be shown as they are.
 */
export function statTracks(tracks, stat, opts = {}) {
  const from = stat.clearable ? opts.from ?? 0 : 0;
  const ranked = ownRanking(stat, opts.sort);
  const limit = Math.max(2, opts.limit ?? DEFAULT_LIMIT);
  const cut = opts.limit != null || ranked ? limit : NO_LIMIT;
  let picked = tracks.filter(t => stat.keep(t, from));
  picked.sort((a, b) => stat.rank(a, b) || byTitle(a, b));
  if (cut !== NO_LIMIT) picked = picked.slice(0, cut);
  if (ranked && ((opts.sort ?? stat.sort) & REVERSE) !== (stat.sort & REVERSE)) picked.reverse();
  return {tracks: picked, limit, ranked};
}

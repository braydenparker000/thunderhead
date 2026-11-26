// The v2 Home's rules for what a shelf holds (data.js builds them in idle slices; nothing here
// touches the page, so the unit tests run them on invented songs):
// - liked: a song rated like (5; library.js rates like 5 and unlike 1, Top Rated keeps both stars
//   and likes, so like is the one value both read as liked), the newest liked first;
// - forgotten favourites: liked or played FORGOTTEN_PLAYS times or more, and last played
//   FORGOTTEN_MS ago or longer (a song never played has nothing to forget), the newest forgotten first;
// - most played lately: plays in the play history (player/play-history.js) of the last LATELY_MS,
//   or, while the history holds fewer than HISTORY_MIN plays of that span, the songs' play counts
//   of those last played in it;
// - a playlist's recent: the latest of its change and any of its songs' last play.

export const DAY = 86_400_000;
export const LIKE = 5;
export const FORGOTTEN_MS = 90 * DAY, FORGOTTEN_PLAYS = 5;
export const LATELY_MS = 30 * DAY, HISTORY_MIN = 25;

export const isLiked = t => t?.rating === LIKE;

/** The liked songs, the newest liked first (when liked unknown: the last played). */
export function likedSongs(tracks) {
  const out = tracks.filter(isLiked);
  return out.sort((a, b) => (b.ratedAt || b.lastPlayed || 0) - (a.ratedAt || a.lastPlayed || 0));
}

/** Whether a song is a forgotten favourite at `now`. */
export function isForgotten(t, now) {
  const last = t?.lastPlayed || 0;
  return !!last && last <= now - FORGOTTEN_MS && (isLiked(t) || (t.plays || 0) >= FORGOTTEN_PLAYS);
}

/** The forgotten favourites, the newest forgotten (the latest last play) first. */
export function forgottenSongs(tracks, now) {
  return tracks.filter(t => isForgotten(t, now)).sort((a, b) => b.lastPlayed - a.lastPlayed);
}

/**
 * Plays per song id lately: from the history ({id, at}, newest first) when it holds HISTORY_MIN plays
 * or more of the span, else the play counts of the songs last played in it. {counts, fromHistory}.
 */
export function playsLately(tracks, history, now) {
  const since = now - LATELY_MS, counts = new Map();
  for (const e of history ?? []) {
    if (e.at < since) break;
    if (e.at <= now) counts.set(e.id, (counts.get(e.id) ?? 0) + 1);
  }
  let n = 0;
  for (const c of counts.values()) n += c;
  if (n >= HISTORY_MIN) return {counts, fromHistory: true};
  const own = new Map();
  for (const t of tracks) if ((t.plays || 0) > 0 && (t.lastPlayed || 0) >= since) own.set(t.id, t.plays);
  return {counts: own, fromHistory: false};
}

/** Songs by plays lately, the most first (ties: the last played first); only those played. */
export function mostPlayedSongs(tracks, counts) {
  return tracks.filter(t => counts.get(t.id) > 0)
    .sort((a, b) => counts.get(b.id) - counts.get(a.id) || (b.lastPlayed || 0) - (a.lastPlayed || 0));
}

/** Groups (albums, artists) by their songs' plays lately, the most first; only those played. */
export function mostPlayedGroups(groups, counts) {
  const scored = [];
  for (const g of groups) {
    let s = 0;
    for (const t of g.tracks) s += counts.get(t.id) ?? 0;
    if (s > 0) scored.push({g, s});
  }
  return scored.sort((a, b) => b.s - a.s).map(x => x.g);
}

/** The latest last play of some songs (0: none played). */
export function lastPlayOf(tracks) {
  let m = 0;
  for (const t of tracks) if ((t.lastPlayed || 0) > m) m = t.lastPlayed;
  return m;
}

/** A playlist's recent: the latest of its change (or making) and its songs' last play. */
export function playlistRecent(pl, tracks) {
  return Math.max(pl?.modified || pl?.created || 0, lastPlayOf(tracks));
}

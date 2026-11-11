// What the DJ shuffle reads off a song, kept so a plan does not read it again for every comparison
// (th/music/dj.js compares a song with thousands of others for each plan, and plans again after a skip).

/** @typedef {{ id: string, title?: string, artist?: string, albumArtist?: string, album?: string, composer?: string, genre?: string, year?: number, rating?: number, lastPlayed?: number }} Track */

const low = (/** @type {unknown} */ s) => (typeof s === 'string' ? s.trim().toLowerCase() : '');

/** A song's tags as the DJ compares them, read once for each song record (a plan compares a song
 * thousands of times; a library refresh makes new records).
 * @type {WeakMap<Track, { composer: string, artist: string, albumArtist: string, album: string, genres: string[], keys: string[] }>} */
const read = new WeakMap();
/** @param {Track} t */
export function tagsOf(t) {
  let v = read.get(t);
  if (v) return v;
  const genres = [...new Set(low(t.genre).split(/\s*[/,;]\s*/).filter(Boolean))];
  v = { composer: low(t.composer), artist: low(t.artist), albumArtist: low(t.albumArtist), album: low(t.album), genres, keys: [] };
  v.keys = [`c:${v.composer}`, `a:${v.artist}`, ...genres.map((g) => `g:${g}`)].filter((k) => !k.endsWith(':'));
  read.set(t, v);
  return v;
}

/** A list's songs by tag (composer, artist, each genre), kept while the list is the same songs.
 * @type {WeakMap<Track[], { n: number, first: Track, last: Track, by: Map<string, number[]> }>} */
const indexes = new WeakMap();
/** @param {Track[]} tracks */
export function tagIndex(tracks) {
  const kept = indexes.get(tracks);
  if (kept && kept.n === tracks.length && kept.first === tracks[0] && kept.last === tracks[tracks.length - 1]) return kept.by;
  /** @type {Map<string, number[]>} */
  const by = new Map();
  tracks.forEach((t, i) => {
    for (const k of tagsOf(t).keys) {
      const b = by.get(k);
      if (b) b.push(i);
      else by.set(k, [i]);
    }
  });
  indexes.set(tracks, { n: tracks.length, first: tracks[0], last: tracks[tracks.length - 1], by });
  return by;
}

// The library's shelves (MUSIC.md §2.3, owner 2026-11-21): what Albums, Singles, Artists and
// Possible duplicates list, and what an album's and an artist's page hold. Built once per library
// change from the library's own album and artist groups (Library.grouped), never per row.
// - an album is a release (an album group with an album tag) of ALBUM_MIN songs or more, in every
//   list that shows albums (Albums, Albums by Artist, an entry's albums, search; owner audit
//   2026-11-26); a shorter release's songs show as Singles wherever albums would;
// - Singles: the songs of shorter releases and the songs with no album, by artist then title;
// - Artists: artists with ARTIST_MIN songs or more, or an album of their own (its album artist is
//   them, or one of them);
// - possible duplicates: songs whose title and artist are equal once case, spacing and punctuation
//   are left out (nothing else is stripped), two songs or more, wherever they are.

import {run, sortSteps, STEP} from './groups.js';

export const ALBUM_MIN = 3;
export const ARTIST_MIN = 5;

const BASE = new Intl.Collator(undefined, {sensitivity: 'base'});
const cmp = (a, b) => BASE.compare(a ?? '', b ?? '');
const lc = s => String(s ?? '').toLowerCase();

/** An album group that counts as an album (a tagged release of ALBUM_MIN songs or more). */
export const isAlbum = g => g.tracks.length >= ALBUM_MIN && !!g.tracks[0]?.album;

/** A title or artist for the duplicate test: case, punctuation and spacing left out of the comparison. */
export const dupKey = s => lc(s).normalize('NFKC').replace(/\p{P}+/gu, '').replace(/\s+/gu, ' ').trim();

/** Disc, then track number, then title (an album page's order). */
export const byDiscTrack = (a, b) => (a.disc || 0) - (b.disc || 0) || (a.track || 0) - (b.track || 0) || cmp(a.title, b.title);

/**
 * The shelves from the library's groups: {albums, albumOf (track → album), singles, artists,
 * owners (lower-cased artist names with an album of their own), duplicates}. names(albumArtist)
 * gives an album artist's split names (Library.namesOf).
 */
export function buildShelves(groups) {
  return run(shelfSteps(groups));
}

/** buildShelves as steps (a generator yielding every STEP songs: Library's idle warm-up, groups.js). */
export function* shelfSteps({albumGroups, artistGroups, names = s => [s]}) {
  const albums = [], albumOf = new Map(), singles = [], owners = new Set();
  let n = 0;
  for (const g of albumGroups) {
    if (!isAlbum(g)) { singles.push(...g.tracks); continue; }
    albums.push(g);
    for (const t of g.tracks) albumOf.set(t, g);
    for (const name of names(g.artist)) owners.add(lc(name));
    if ((n += g.tracks.length) >= STEP) { n = 0; yield; }
  }
  yield* sortSteps(singles, (a, b) => cmp(a.artist, b.artist) || cmp(a.title, b.title));
  const artists = artistGroups.filter(g => g.tracks.length >= ARTIST_MIN || owners.has(lc(g.title)));
  return {albums, albumOf, singles, artists, owners, duplicates: yield* duplicateSteps(albumGroups.flatMap(g => g.tracks))};
}

/** Groups of two songs or more with the same title and artist (dupKey), by title then artist. */
export function duplicateGroups(tracks) {
  return run(duplicateSteps(tracks));
}

function* duplicateSteps(tracks) {
  const map = new Map();
  let n = 0;
  for (const t of tracks) {
    if (++n % STEP === 0) yield;
    const title = dupKey(t.title);
    if (!title) continue;
    const k = title + '\u0000' + dupKey(t.artist);
    (map.get(k) ?? map.set(k, []).get(k)).push(t);
  }
  const out = [];
  for (const list of map.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => cmp(a.album, b.album) || (a.durationMs || 0) - (b.durationMs || 0));
    out.push({title: list[0].title, artist: list[0].artist, tracks: list});
  }
  return yield* sortSteps(out, (a, b) => cmp(a.title, b.title) || cmp(a.artist, b.artist));
}

/** An album's year: the earliest a song has, or 0. */
export function albumYear(g) {
  let y = 0;
  for (const t of g.tracks) if (t.year && (!y || t.year < y)) y = t.year;
  return y;
}

/**
 * An artist's page from their songs: the albums holding any of them (newest year first, unknown
 * years last, then by name) and their other songs (shorter releases and no album, by title).
 */
export function artistShelf(tracks, albumOf) {
  const albums = new Set(), singles = [];
  for (const t of tracks) {
    const a = albumOf.get(t);
    if (a) albums.add(a);
    else singles.push(t);
  }
  const year = g => albumYear(g) || -Infinity;
  return {
    albums: [...albums].sort((a, b) => year(b) - year(a) || cmp(a.title, b.title)),
    singles: singles.sort((a, b) => cmp(a.title, b.title) || cmp(a.album, b.album)),
  };
}

/**
 * An album artist's, genre's, composer's or year's albums from its songs: each album (as the
 * shelves count them) holding any of them, with only those songs, in the order first met; and its
 * other songs (shorter releases and no album, by title), as an artist's page has them.
 */
export function entryShelf(tracks, albumOf) {
  const shares = new Map(), singles = [];
  for (const t of tracks) {
    const a = albumOf.get(t);
    if (!a) { singles.push(t); continue; }
    let s = shares.get(a);
    if (!s) shares.set(a, s = {kind: 'album', title: a.title, artist: a.artist, artId: a.artId, tracks: []});
    s.tracks.push(t);
  }
  return {albums: [...shares.values()], singles: singles.sort((a, b) => cmp(a.title, b.title) || cmp(a.album, b.album))};
}

/**
 * An artist row's second line in Artists and All artists: "N albums · N songs" (albums as the shelves
 * count them: the albums holding any of their songs), "N songs" alone when none. songs(n) words a count.
 */
export function artistLine2(tracks, albumOf, songs = n => `${n} ${n === 1 ? 'song' : 'songs'}`) {
  const albums = new Set();
  for (const t of tracks) { const a = albumOf?.get(t); if (a) albums.add(a); }
  const n = albums.size;
  return n ? `${n} ${n === 1 ? 'album' : 'albums'} · ${songs(tracks.length)}` : songs(tracks.length);
}

/** An album's songs in disc order, with a "Disc N" break before each disc when there are several. */
export function albumRows(tracks) {
  const sorted = [...tracks].sort(byDiscTrack);
  const discs = new Set(sorted.map(t => t.disc || 0));
  const rows = [];
  sorted.forEach((t, at) => {
    if (discs.size > 1 && t.disc > 0 && (at === 0 || (sorted[at - 1].disc || 0) !== t.disc)) rows.push({disc: t.disc});
    rows.push({track: t, at});
  });
  return {tracks: sorted, rows};
}

/** A song row's second line on its album's page: its artist only when not the album's artist. */
export function albumSongLine2(t, albumArtist) {
  return t.artist && lc(t.artist) !== lc(albumArtist) ? t.artist : '';
}

/** The shelves' own words (the reference has no strings for them). */
export const SHELF_WORDS = {singles: 'Singles', possible_duplicates: 'Possible duplicates', all_artists: 'All artists'};

// The library's shape as numbers (MUSIC.md §5.10 "Library"): "Copy report" on the playback log screen
// adds it under `library`, built only when tapped. Counts, sizes and percentages only: never a title,
// an artist, an album, a genre, a file name or an id, so the report can be pasted anywhere.
// Fields are the library records' own (library/r2.js r2Tracks, library.js USER_FIELDS); the album and
// artist groups are the lists' own (Library.albums(), Library.artists()) when `describe` gives them.
// `screens` counts the rows the library's shelves build (library/shelves.js, list/sources.js): Albums
// (releases of 3 songs or more), Singles, the listed artists and All artists, Possible duplicates, an
// album's page and an artist's page, and per screen how many rows have a second line.
import {albumLabel, trackLine2} from '../library/labels.js';
import {albumRows, albumSongLine2, albumYear, artistShelf, buildShelves} from '../library/shelves.js';

const UNKNOWN_ARTIST = 'Unknown artist', UNKNOWN_ALBUM = 'Unknown album';
const lc = s => String(s ?? '').trim().toLowerCase();
const pct = (n, of) => (of ? Math.round((n / of) * 1000) / 10 : 0);
// Same song, different spelling: case, accents, spaces and punctuation left out.
const norm = s => lc(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, '');
// Same artist, split in two: also "feat." and its featured names, "&" / "and" / "+" / "," / "x" forms.
const artistNorm = s => norm(lc(s).replace(/\s*[([]?\b(feat\.?|ft\.?|featuring|with)\s.*$/u, '').replace(/\s+(and|x)\s+|\s*[&+,/]\s*/gu, '&'));
const PLACEHOLDER = /^\s*(unknown|unknown (artist|album|title|track)|untitled( track)?|no (title|artist|album)|<unknown>|\[unknown\]|n\/a|-+|\?+)\s*$/i;
const FILE_LIKE = /\.(mp3|flac|m4a|mp4|aac|ogg|oga|opus|wav|wma|ape|alac|aiff?|dsf|wv)\s*$|^\s*(track|piste|titel|pista)?[\s_-]*\d{1,3}\s*$/i;
const has = v => (typeof v === 'number' ? v > 0 : !!String(v ?? '').trim());
const cover = t => !!(t.artUrl || (t.artId && !String(t.artId).startsWith('embedded:')));

// The fields counted, as the records carry them; rating and plays exist once set (USER_FIELDS).
const FIELDS = {
  album: t => has(t.album), albumArtist: t => has(t.albumArtist), artist: t => has(t.artist), year: t => has(t.year),
  trackNumber: t => has(t.track), discNumber: t => has(t.disc), genre: t => has(t.genre), composer: t => has(t.composer),
  length: t => has(t.durationMs), cover, waveform: t => !!(t.waveB64 || t.wave || t.waveUrl), rating: t => has(t.rating), played: t => has(t.plays),
};
const KEYS = {album: ['album'], albumArtist: ['albumArtist'], artist: ['artist'], year: ['year'], trackNumber: ['track'], discNumber: ['disc'], genre: ['genre'], composer: ['composer'], length: ['durationMs'], cover: ['artUrl', 'artId'], waveform: ['waveB64', 'wave', 'waveUrl', 'waveKind']};

/** An album's artist on its page (sources.js pageArtist). */
const pageArtist = g => g.artist || g.tracks.find(t => t.albumArtist)?.albumArtist || g.tracks[0]?.artist || '';

/**
 * Each shelf screen's second line, as list/sources.js builds it with these settings (ctx: pref, res;
 * none: the defaults). Albums: the album row's artist (groupLine2 / albumRowArtist); Singles: the song
 * row's line (labels.js trackLine2); artists: none; Possible duplicates: album · format · bitrate ·
 * length; an album's page: the song's artist only when not the album's (shelves.js albumSongLine2); an
 * artist's page: "year · N songs" under each album, the release's name under each other song.
 */
export function shelfLine2(ctx = {}, unknownArtist = UNKNOWN_ARTIST) {
  return {
    albums: g => { const t = g.tracks[0]; return ctx.pref?.('use_albumartist_albums') && t?.albumArtist ? t.albumArtist : t?.artist || unknownArtist; },
    singles: t => trackLine2(ctx, t),
    artists: () => '',
    allArtists: () => '',
    duplicates: t => [albumLabel(ctx, t), t.format, t.bitrate ? t.bitrate + 'kbps' : '', t.durationMs ? 'length' : ''].filter(Boolean).join(' · '),
    albumPage: (t, g) => albumSongLine2(t, pageArtist(g)),
    artistPageAlbums: g => [albumYear(g) ? String(albumYear(g)) : '', `${g.tracks.length} songs`].filter(Boolean).join(' · '),
    artistPageSingles: t => (t.album ? albumLabel(ctx, t) : ''),
  };
}

/** Album groups the way Library.buildAlbums keys them (join_albums on). */
export function groupAlbums(tracks) {
  const tagged = new Set(), map = new Map();
  for (const t of tracks) if (t.album && t.albumArtist) tagged.add(lc(t.album) + '\0' + lc(t.albumArtist));
  for (const t of tracks) {
    let key = '\u0001';
    if (t.album) {
      let aa = lc(t.albumArtist);
      if (!aa && t.artist && tagged.has(lc(t.album) + '\0' + lc(t.artist))) aa = lc(t.artist);
      key = lc(t.album) + '\0' + aa;
    }
    let a = map.get(key);
    if (!a) map.set(key, a = {kind: 'album', title: t.album || UNKNOWN_ALBUM, artist: t.albumArtist || t.artist || '', tracks: []});
    a.tracks.push(t);
  }
  return [...map.values()];
}

/** Artist groups by the whole artist tag (the list also splits on artists_split_chars). */
export function groupArtists(tracks) {
  const map = new Map();
  for (const t of tracks) {
    const k = lc(t.artist);
    let g = map.get(k);
    if (!g) map.set(k, g = {kind: 'artist', title: t.artist || UNKNOWN_ARTIST, tracks: []});
    g.tracks.push(t);
  }
  return [...map.values()];
}

const bucket = (n, edges) => edges.find(([, lo, hi]) => n >= lo && n <= hi)?.[0];
const countBy = (items, edges, size) => {
  const out = Object.fromEntries(edges.map(([k]) => [k, 0]));
  for (const x of items) out[bucket(size(x), edges)]++;
  return out;
};

/** Track numbers 1..n on each disc, none missing or repeated. */
function completeNumbers(tracks) {
  const discs = new Map();
  for (const t of tracks) {
    if (!(t.track > 0)) return false;
    const d = discs.get(t.disc || 0) ?? discs.set(t.disc || 0, []).get(t.disc || 0);
    d.push(t.track);
  }
  for (const nums of discs.values()) { nums.sort((a, b) => a - b); if (nums.some((n, i) => n !== i + 1)) return false; }
  return true;
}

function sizes(list) {
  const s = list.map(x => (typeof x === 'number' ? x : Array.isArray(x) ? x.length : (x?.ids ?? x?.tracks ?? []).length)).sort((a, b) => a - b);
  if (!s.length) return {count: 0, min: 0, median: 0, max: 0};
  const m = s.length >> 1;
  return {count: s.length, min: s[0], median: s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2, max: s.at(-1)};
}

/** Rows and second lines over the screens of one kind: with a second line, blank, unknown, the same as the row above. */
function screenRows(screens, unknown) {
  const out = {screens: 0, rows: 0, withLine2: 0, blank: 0, unknown: 0, sameAsRowAbove: 0};
  for (const lines of screens) {
    out.screens++;
    lines.forEach((l, i) => {
      out.rows++;
      if (!String(l ?? '').trim()) { out.blank++; return; }
      out.withLine2++;
      if (unknown.some(u => l.includes(u))) out.unknown++;
      if (i && l === lines[i - 1]) out.sameAsRowAbove++;
    });
  }
  return out;
}

/**
 * The report. tracks: the library's shown records; playlists: playlists (ids or tracks) or their sizes;
 * describe: {albums, artists, shelves, line2 (shelfLine2's shape), unknown} from the live library, else
 * the groups and shelves built here with the default settings.
 */
export function libraryReport(tracks = [], playlists = [], describe = {}) {
  const songs = tracks.length, line2 = describe.line2 ?? shelfLine2(), unknown = describe.unknown ?? [UNKNOWN_ARTIST, UNKNOWN_ALBUM];
  const filled = {}, filledPct = {};
  for (const [k, f] of Object.entries(FIELDS)) { filled[k] = tracks.filter(f).length; filledPct[k] = pct(filled[k], songs); }
  filled.albumArtistDiffers = tracks.filter(t => has(t.albumArtist) && has(t.artist) && lc(t.albumArtist) !== lc(t.artist)).length;
  filled.coverOnlyInFile = tracks.filter(t => !cover(t) && String(t.artId ?? '').startsWith('embedded:')).length;
  const notCarried = songs ? Object.entries(KEYS).filter(([, ks]) => !tracks.some(t => ks.some(k => k in t))).map(([k]) => k) : [];

  const allAlbums = describe.albums ?? groupAlbums(tracks);
  const albums = allAlbums.filter(a => a.tracks.some(t => t.album));
  const albumOf = new Map();
  for (const a of albums) for (const t of a.tracks) albumOf.set(t, a);
  const years = a => new Set(a.tracks.map(t => t.year).filter(y => y > 0));
  const albumReport = {
    count: albums.length, unknownRow: allAlbums.length - albums.length,
    bySize: countBy(albums, [['1', 1, 1], ['2-4', 2, 4], ['5-9', 5, 9], ['10+', 10, Infinity]], a => a.tracks.length),
    severalArtists: albums.filter(a => new Set(a.tracks.map(t => lc(t.artist)).filter(Boolean)).size > 1).length,
    noYear: albums.filter(a => !years(a).size).length,
    mixedYears: albums.filter(a => years(a).size > 1).length,
    completeTrackNumbers: albums.filter(a => completeNumbers(a.tracks)).length,
    withCover: albums.filter(a => a.tracks.some(cover)).length,
  };

  const allArtists = describe.artists ?? groupArtists(tracks);
  const artists = allArtists.filter(g => g.tracks.some(t => t.artist));
  const albumCount = g => new Set(g.tracks.map(t => albumOf.get(t)).filter(Boolean)).size;
  const splits = new Map();
  for (const g of artists) { const k = artistNorm(g.title); (splits.get(k) ?? splits.set(k, new Set()).get(k)).add(g.title); }
  const split = [...splits.values()].filter(s => s.size > 1);
  const artistReport = {
    count: artists.length, unknownRow: allArtists.length - artists.length,
    bySongs: countBy(artists, [['1', 1, 1], ['2-4', 2, 4], ['5+', 5, Infinity]], g => g.tracks.length),
    byAlbums: countBy(artists, [['0', 0, 0], ['1', 1, 1], ['2+', 2, Infinity]], albumCount),
    likelySplit: {groups: split.length, names: split.reduce((n, s) => n + s.size, 0)},
  };

  const dupes = new Map();
  for (const t of tracks) { if (!norm(t.title)) continue; const k = norm(t.title) + '\0' + norm(t.artist); dupes.set(k, (dupes.get(k) ?? 0) + 1); }
  const dupeGroups = [...dupes.values()].filter(n => n > 1);
  const fromFile = t => !!t.fileName && t.title === String(t.fileName).replace(/\.[^.]+$/, '');
  const placeholders = {
    title: {empty: tracks.filter(t => !has(t.title)).length, placeholder: tracks.filter(t => PLACEHOLDER.test(t.title ?? '')).length, fileNameLike: tracks.filter(t => FILE_LIKE.test(t.title ?? '')).length, isFileName: tracks.filter(fromFile).length},
    artist: {empty: songs - filled.artist, placeholder: tracks.filter(t => PLACEHOLDER.test(t.artist ?? '')).length},
    album: {empty: songs - filled.album, placeholder: tracks.filter(t => PLACEHOLDER.test(t.album ?? '')).length},
  };

  // The shelves' screens as the lists build them (library/shelves.js; list/sources.js).
  const sh = describe.shelves ?? buildShelves({albumGroups: allAlbums, artistGroups: allArtists});
  const pages = sh.artists.map(g => artistShelf(g.tracks, sh.albumOf));
  const screens = {
    albums: screenRows([sh.albums.map(line2.albums)], unknown),
    singles: screenRows([sh.singles.map(line2.singles)], unknown),
    artists: screenRows([sh.artists.map(line2.artists)], unknown),
    allArtists: screenRows([allArtists.map(line2.allArtists)], unknown),
    duplicates: {...screenRows([sh.duplicates.flatMap(d => d.tracks.map(line2.duplicates))], unknown), groups: sh.duplicates.length},
    albumPage: screenRows(sh.albums.map(g => albumRows(g.tracks).tracks.map(t => line2.albumPage(t, g))), unknown),
    artistPage: {albums: screenRows(pages.map(p => p.albums.map(line2.artistPageAlbums)), unknown), singles: screenRows(pages.map(p => p.singles.map(line2.artistPageSingles)), unknown)},
  };
  const shelves = {albums: sh.albums.length, albumSongs: sh.albums.reduce((n, g) => n + g.tracks.length, 0), singles: sh.singles.length,
    artists: sh.artists.length, allArtists: allArtists.length, duplicates: {groups: sh.duplicates.length, songs: sh.duplicates.reduce((n, d) => n + d.tracks.length, 0)}};

  return {version: 1, songs, filled, filledPct, notCarried, albums: albumReport, artists: artistReport,
    duplicates: {groups: dupeGroups.length, songs: dupeGroups.reduce((n, c) => n + c, 0)}, placeholders, shelves, screens, playlists: sizes(playlists)};
}

/** The report over the live library, with the settings in effect for the rows' second lines. */
export function reportFor(ctx) {
  const lib = ctx.library;
  if (!lib) return null;
  const str = (name, fallback) => ctx.res?.stringByName(name) ?? fallback;
  const unknown = [str('unknown_artist_name', UNKNOWN_ARTIST), str('unknown_album_name', UNKNOWN_ALBUM)];
  const line2 = shelfLine2(ctx, unknown[0]);
  return libraryReport(lib.tracks ?? [], ctx.playlists?.items ?? [], {albums: lib.albums(), artists: lib.artists(), shelves: lib.shelves?.(), line2, unknown});
}

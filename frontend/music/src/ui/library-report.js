// The library's shape as numbers (MUSIC.md §5.10 "Library"): "Copy report" on the playback log screen
// adds it under `library`, built only when tapped. Counts, sizes and percentages only: never a title,
// an artist, an album, a genre, a file name or an id, so the report can be pasted anywhere.
// Fields are the library records' own (library/r2.js r2Tracks, library.js USER_FIELDS); the album and
// artist groups are the lists' own (Library.albums(), Library.artists()) when `describe` gives them.
import {trackLine2} from '../library/labels.js';

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

// Which fields each screen's rows are built from (list/sources.js, list/list-widget.js, library/labels.js).
export const SCREEN_FIELDS = {
  albumList: {title: 'album', line2: 'artist of the first song (albumArtist with use_albumartist_albums)', meta: 'songs | length | earliest year'},
  artistList: {title: 'artist (split parts)', line2: 'none', meta: 'songs | length'},
  albumSongs: {title: 'title (fileName with title_filename), track number', line2: 'artist - album (albumArtist with use_albumartist)', meta: 'format, sampleRate, bits or bitrate'},
  artistAlbums: {subhead: 'All artist songs: song count', title: 'album', line2: 'artist of the album\'s first song by this artist', meta: 'songs | length | earliest year'},
  artistSongs: {title: 'title', line2: 'artist - album', meta: 'format, sampleRate, bits or bitrate'},
};

/** The rows' second lines with the default settings (sources.js groupLine2 / albumRowArtist, labels.js trackLine2). */
export function defaultLine2(screen, item) {
  if (screen === 'artistList') return '';
  if (screen === 'albumList' || screen === 'artistAlbums') return item.tracks?.[0]?.artist || UNKNOWN_ARTIST;
  return trackLine2({}, item);
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

/** Second-line counts over the screens of one kind: blank, unknown, the same as the row above or as another row, the header's name repeated. */
function screenRows(screens, line2, kind, unknown) {
  const out = {screens: 0, rows: 0, blank: 0, unknown: 0, sameAsRowAbove: 0, sameOnScreen: 0, repeatsHeader: 0};
  for (const {header, rows} of screens) {
    out.screens++;
    const lines = rows.map(r => String(line2(kind, r) ?? ''));
    const seen = new Map();
    for (const l of lines) seen.set(l, (seen.get(l) ?? 0) + 1);
    lines.forEach((l, i) => {
      out.rows++;
      if (!l.trim()) { out.blank++; return; }
      if (unknown.some(u => l.includes(u))) out.unknown++;
      if (i && l === lines[i - 1]) out.sameAsRowAbove++;
      if (seen.get(l) > 1) out.sameOnScreen++;
      if (header && lc(l).includes(lc(header))) out.repeatsHeader++;
    });
  }
  return out;
}

/**
 * The report. tracks: the library's shown records; playlists: playlists (ids or tracks) or their sizes;
 * describe: {albums, artists, line2(screen, item), unknown} from the live library, else the defaults above.
 */
export function libraryReport(tracks = [], playlists = [], describe = {}) {
  const songs = tracks.length, line2 = describe.line2 ?? defaultLine2, unknown = describe.unknown ?? [UNKNOWN_ARTIST, UNKNOWN_ALBUM];
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

  // An artist's screen: its albums (only its songs of each), then "All artist songs".
  const subAlbums = g => {
    const by = new Map();
    for (const t of g.tracks) { const a = albumOf.get(t); if (a) (by.get(a) ?? by.set(a, {kind: 'album', title: a.title, artist: a.artist, tracks: []}).get(a)).tracks.push(t); }
    return [...by.values()];
  };
  const screens = {
    fields: SCREEN_FIELDS,
    albumList: screenRows([{header: '', rows: allAlbums}], line2, 'albumList', unknown),
    artistList: screenRows([{header: '', rows: allArtists}], line2, 'artistList', unknown),
    albumSongs: screenRows(allAlbums.map(a => ({header: a.title, rows: a.tracks})), line2, 'albumSongs', unknown),
    artistAlbums: screenRows(artists.map(g => ({header: g.title, rows: subAlbums(g)})), line2, 'artistAlbums', unknown),
    artistSongs: screenRows(artists.map(g => ({header: g.title, rows: g.tracks})), line2, 'artistSongs', unknown),
  };

  return {version: 1, songs, filled, filledPct, notCarried, albums: albumReport, artists: artistReport,
    duplicates: {groups: dupeGroups.length, songs: dupeGroups.reduce((n, c) => n + c, 0)}, placeholders, screens, playlists: sizes(playlists)};
}

/** The report over the live library, with the settings in effect for the rows' second lines. */
export function reportFor(ctx) {
  const lib = ctx.library;
  if (!lib) return null;
  const str = (name, fallback) => ctx.res?.stringByName(name) ?? fallback;
  const unknown = [str('unknown_artist_name', UNKNOWN_ARTIST), str('unknown_album_name', UNKNOWN_ALBUM)];
  const line2 = (screen, item) => {
    if (screen === 'artistList') return '';
    if (screen === 'albumList' || screen === 'artistAlbums') {
      const t = item.tracks?.[0];
      return ctx.pref?.('use_albumartist_albums') && t?.albumArtist ? t.albumArtist : t?.artist || unknown[0];
    }
    return trackLine2(ctx, item);
  };
  return libraryReport(lib.tracks ?? [], ctx.playlists?.items ?? [], {albums: lib.albums(), artists: lib.artists(), line2, unknown});
}

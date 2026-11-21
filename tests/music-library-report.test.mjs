// Music's library report (frontend/music/src/ui/library-report.js): the numbers "Copy report" adds under
// `library`, over an invented library of eight songs, and none of the library's own words in it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { libraryReport, reportFor, groupAlbums, groupArtists } from '../frontend/music/src/ui/library-report.js';

const song = (n, f) => ({ id: 'r2_invented' + String(n).padStart(4, '0'), remote: true, fileName: `${n} ${f.title}.flac`, path: `Shelf/${f.album || 'Loose'}/${n}.flac`, ...f });
const art = n => ({ artUrl: `https://music.invalid/art/r2_invented${n}` });
const TRACKS = [
  song(1, { title: 'Lantern Stair', artist: 'Vellum Kite', album: 'Glass Orchard', albumArtist: 'Vellum Kite', year: 2001, track: 1, disc: 1, genre: 'Fogwave', durationMs: 200000, ...art(1), waveUrl: 'https://music.invalid/waveform/r2_invented1', rating: 5, plays: 3 }),
  song(2, { title: 'Copper Tide', artist: 'Vellum Kite', album: 'Glass Orchard', albumArtist: 'Vellum Kite', year: 2001, track: 2, disc: 1, genre: 'Fogwave', durationMs: 180000, ...art(2), waveUrl: 'https://music.invalid/waveform/r2_invented2', plays: 1 }),
  song(3, { title: 'Hollow Bell', artist: 'Vellum Kite', album: 'Glass Orchard', albumArtist: 'Vellum Kite', year: 2001, track: 3, disc: 1, durationMs: 210000, ...art(3), rating: 0 }),
  song(4, { title: 'Pale Ferry', artist: 'Vellum Kite', album: 'Sundial Rooms', albumArtist: 'Various Ospreys', year: 1998, track: 1, durationMs: 190000, artId: 'embedded:r2_invented0004' }),
  song(5, { title: 'Moth Signal', artist: 'Brindle & Fox', album: 'Sundial Rooms', albumArtist: 'Various Ospreys', year: 1999, track: 3, durationMs: 170000 }),
  song(6, { title: 'Track 01', artist: 'Brindle and Fox', album: '', durationMs: 160000 }),
  song(7, { title: 'Pale Ferry', artist: 'VELLUM  KITE', album: '', durationMs: 150000 }),
  { id: 'r2_invented0008', remote: true, title: 'Ember Gate', fileName: 'Ember Gate.mp3', path: 'Shelf/Ember Gate.mp3', artist: 'Unknown Artist', album: 'Untitled', track: 1 },
];
const PLAYLISTS = [{ name: 'Rainy Quarry', ids: ['r2_invented0001', 'r2_invented0002', 'r2_invented0003'] }, { name: 'Tin Lark', ids: ['r2_invented0004'] }, { name: 'Moss Hours', ids: ['r2_inventedx1', 'r2_inventedx2', 'r2_inventedx3', 'r2_inventedx4', 'r2_inventedx5'] }, { name: 'Empty Kiln', ids: [] }];

test('song fields: how many songs carry each, and the field no song carries', () => {
  const r = libraryReport(TRACKS, PLAYLISTS);
  assert.equal(r.songs, 8);
  assert.deepEqual(r.filled, { album: 6, albumArtist: 5, artist: 8, year: 5, trackNumber: 6, discNumber: 3, genre: 2, composer: 0, length: 7, cover: 3, waveform: 2, rating: 1, played: 2, albumArtistDiffers: 2, coverOnlyInFile: 1 });
  assert.deepEqual(r.filledPct, { album: 75, albumArtist: 62.5, artist: 100, year: 62.5, trackNumber: 75, discNumber: 37.5, genre: 25, composer: 0, length: 87.5, cover: 37.5, waveform: 25, rating: 12.5, played: 25 });
  assert.deepEqual(r.notCarried, ['composer']);
});

test('albums, artists, duplicates and placeholders', () => {
  const r = libraryReport(TRACKS, PLAYLISTS);
  assert.deepEqual(r.albums, { count: 3, unknownRow: 1, bySize: { '1': 1, '2-4': 2, '5-9': 0, '10+': 0 }, severalArtists: 1, noYear: 1, mixedYears: 1, completeTrackNumbers: 2, withCover: 1 });
  assert.deepEqual(r.artists, { count: 5, unknownRow: 0, bySongs: { '1': 4, '2-4': 1, '5+': 0 }, byAlbums: { '0': 2, '1': 2, '2+': 1 }, likelySplit: { groups: 2, names: 4 } });
  assert.deepEqual(r.duplicates, { groups: 1, songs: 2 });
  assert.deepEqual(r.placeholders, { title: { empty: 0, placeholder: 0, fileNameLike: 1, isFileName: 1 }, artist: { empty: 0, placeholder: 1 }, album: { empty: 2, placeholder: 1 } });
  assert.deepEqual(r.playlists, { count: 4, min: 0, median: 2, max: 5 });
});

test('screens: blank and repeated second lines, as the rows build them', () => {
  const s = libraryReport(TRACKS, PLAYLISTS).screens;
  assert.ok(s.fields.albumList.line2 && s.fields.artistSongs.title);
  assert.deepEqual(s.albumList, { screens: 1, rows: 4, blank: 0, unknown: 0, sameAsRowAbove: 1, sameOnScreen: 2, repeatsHeader: 0 });
  assert.deepEqual(s.artistList, { screens: 1, rows: 5, blank: 5, unknown: 0, sameAsRowAbove: 0, sameOnScreen: 0, repeatsHeader: 0 });
  assert.deepEqual(s.albumSongs, { screens: 4, rows: 8, blank: 0, unknown: 2, sameAsRowAbove: 2, sameOnScreen: 3, repeatsHeader: 8 });
  assert.deepEqual(s.artistAlbums, { screens: 5, rows: 4, blank: 0, unknown: 0, sameAsRowAbove: 1, sameOnScreen: 2, repeatsHeader: 4 });
  assert.deepEqual(s.artistSongs, { screens: 5, rows: 8, blank: 0, unknown: 2, sameAsRowAbove: 2, sameOnScreen: 3, repeatsHeader: 8 });
});

test('the live library: its own groups and settings, built only when asked', () => {
  let built = 0;
  const lib = { tracks: TRACKS, albums: () => (built++, groupAlbums(TRACKS)), artists: () => groupArtists(TRACKS) };
  const ctx = { library: lib, playlists: { items: PLAYLISTS }, pref: k => k === 'use_albumartist_albums' };
  assert.equal(built, 0);
  const r = reportFor(ctx);
  assert.equal(built, 1);
  assert.equal(r.screens.albumList.sameAsRowAbove, 0, 'the second album row leads with its album artist');
  assert.equal(reportFor({}), null);
});

test('the report holds none of the library\'s words', () => {
  const json = JSON.stringify(libraryReport(TRACKS, PLAYLISTS));
  const words = new Set();
  for (const x of [...TRACKS, ...PLAYLISTS]) for (const v of Object.values(x)) for (const w of [v].flat()) if (typeof w === 'string' && w) words.add(w);
  for (const w of words) assert.ok(!json.includes(w), `the report must not carry "${w}"`);
});

// Music's library report (frontend/music/src/ui/library-report.js): the numbers "Copy report" adds under
// `library`, over an invented library of eight songs, and none of the library's own words in it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { libraryReport, reportFor, groupAlbums, groupArtists } from '../frontend/music/src/ui/library-report.js';
import { buildShelves } from '../frontend/music/src/library/shelves.js';

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

test('the shelves and their screens: the rows the lists build, and how many have a second line', () => {
  const r = libraryReport(TRACKS, PLAYLISTS);
  // Albums are releases of 3 songs or more; the rest, and songs with no album, are Singles; an artist is
  // listed with 5 songs or an album of their own (library/shelves.js).
  assert.deepEqual(r.shelves, { albums: 1, albumSongs: 3, singles: 5, artists: 1, allArtists: 5, duplicates: { groups: 1, songs: 2 } });
  const row = (rows, withLine2, unknown = 0) => ({ screens: 1, rows, withLine2, blank: rows - withLine2, unknown, sameAsRowAbove: 0 });
  assert.deepEqual(r.screens, {
    albums: row(1, 1),
    singles: row(5, 5, 2),
    artists: row(1, 0),
    allArtists: row(5, 0),
    duplicates: { ...row(2, 2, 1), groups: 1 },
    // Every song on the one album is by its album artist: no second lines.
    albumPage: row(3, 0),
    // The artist's page: the album with "year · N songs", the other song with its release's name.
    artistPage: { albums: row(1, 1), singles: row(1, 1) },
  });
  assert.equal('fields' in r.screens || 'albumList' in r.screens, false, 'the old screens are gone');
});

test('the live library: its own groups and settings, built only when asked', () => {
  let built = 0;
  let shelved = 0;
  const lib = { tracks: TRACKS, albums: () => (built++, groupAlbums(TRACKS)), artists: () => groupArtists(TRACKS), shelves: () => (shelved++, buildShelves({ albumGroups: groupAlbums(TRACKS), artistGroups: groupArtists(TRACKS) })) };
  const ctx = { library: lib, playlists: { items: PLAYLISTS }, pref: k => k === 'use_albumartist_albums' };
  assert.equal(built, 0);
  const r = reportFor(ctx);
  assert.equal(built, 1);
  assert.equal(shelved, 1, 'the library\'s own shelves are asked for');
  assert.deepEqual(r.screens.albums, { screens: 1, rows: 1, withLine2: 1, blank: 0, unknown: 0, sameAsRowAbove: 0 });
  assert.equal(reportFor({}), null);
});

test('the report holds none of the library\'s words', () => {
  const json = JSON.stringify(libraryReport(TRACKS, PLAYLISTS));
  const words = new Set();
  for (const x of [...TRACKS, ...PLAYLISTS]) for (const v of Object.values(x)) for (const w of [v].flat()) if (typeof w === 'string' && w) words.add(w);
  for (const w of words) assert.ok(!json.includes(w), `the report must not carry "${w}"`);
});

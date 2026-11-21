// Music's shelves (frontend/music/src/library/shelves.js, MUSIC.md §2.3), over an invented library
// (tests/fixtures/music-shelves-library.mjs): what Albums, Singles, Artists and Possible duplicates
// hold, an artist's page, an album's disc order and its rows' second lines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildShelves, duplicateGroups, artistShelf, albumRows, albumSongLine2, dupKey, isAlbum, ALBUM_MIN, ARTIST_MIN } from '../frontend/music/src/library/shelves.js';
import { inventedLibrary } from './fixtures/music-shelves-library.mjs';

// The library's own grouping, as Library.buildAlbums and namedGroups key it (join_albums on, no split).
function groups(tracks) {
  const lc = (s) => (s ?? '').toLowerCase();
  const tagged = new Set(tracks.filter((t) => t.album && t.albumArtist).map((t) => lc(t.album) + '\0' + lc(t.albumArtist)));
  const albums = new Map(), artists = new Map();
  for (const t of tracks) {
    let key = '\u0001';
    if (t.album) {
      let aa = lc(t.albumArtist);
      if (!aa && t.artist && tagged.has(lc(t.album) + '\0' + lc(t.artist))) aa = lc(t.artist);
      key = lc(t.album) + '\0' + aa;
    }
    if (!albums.has(key)) albums.set(key, { kind: 'album', title: t.album || 'Unknown album', artist: t.albumArtist || t.artist || '', tracks: [] });
    albums.get(key).tracks.push(t);
    const a = lc(t.artist);
    if (!artists.has(a)) artists.set(a, { kind: 'artist', title: t.artist, tracks: [] });
    artists.get(a).tracks.push(t);
  }
  return { albumGroups: [...albums.values()], artistGroups: [...artists.values()] };
}

const lib = inventedLibrary();
const shelves = buildShelves(groups(lib));
const titles = (list) => list.map((x) => x.title);

test('Albums holds releases of three songs or more; the rest are Singles, by artist then title', () => {
  assert.equal(ALBUM_MIN, 3);
  assert.deepEqual(titles(shelves.albums).sort(), ['Coastal Roads Vol. 1', 'Lantern Season', 'Small Rooms', 'Tidewater', 'Untitled Tapes']);
  assert.ok(shelves.albums.every(isAlbum));
  assert.deepEqual(shelves.singles.map((t) => `${t.artist} / ${t.title}`), [
    'Harbor Lights / Night Ferry', 'Harbor Lights / Paper Moon', 'Juno Park / Attic (Demo)', 'Juno Park / Front Room (Demo)',
    'Mira Vale / glass  coast', 'Mira Vale / Salt', 'Mira Vale / Undertow', 'Mira Vale / Undertow (Live)', 'Mira Vale feat. Juno Park / Undertow',
  ]);
  // Every song is on exactly one shelf.
  assert.equal(shelves.singles.length + shelves.albums.reduce((n, a) => n + a.tracks.length, 0), lib.length);
  // Three untagged songs of one artist are no album.
  const loose = buildShelves(groups([1, 2, 3].map((n) => ({ id: 'l' + n, title: 'Loose ' + n, artist: 'Odd Copper', album: '' }))));
  assert.deepEqual([loose.albums.length, loose.singles.length], [0, 3]);
});

test('Artists lists artists with five songs or more or an album of their own', () => {
  assert.equal(ARTIST_MIN, 5);
  // Harbor Lights and Juno Park have albums; Mira Vale five songs; Odd Copper one song on a compilation.
  assert.deepEqual(titles(shelves.artists).sort(), ['Harbor Lights', 'Juno Park', 'Mira Vale']);
  // Four songs and no album: not listed; the fifth song lists them.
  const four = [1, 2, 3, 4].map((n) => ({ id: 'f' + n, title: 'Song ' + n, artist: 'Odd Copper', album: 'Copper ' + n }));
  assert.deepEqual(titles(buildShelves(groups(four)).artists), []);
  assert.deepEqual(titles(buildShelves(groups([...four, { id: 'f5', title: 'Song 5', artist: 'Odd Copper', album: '' }])).artists), ['Odd Copper']);
  // An album artist's split names own the album (Library.namesOf).
  const duo = [1, 2, 3].map((n) => ({ id: 'd' + n, title: 'Duet ' + n, artist: 'Juno Park', albumArtist: 'Juno Park & Mira Vale', album: 'Pairs' }));
  const split = buildShelves({ ...groups(duo), names: (s) => s.split(' & ') });
  assert.deepEqual(titles(split.artists), ['Juno Park']);
});

test("an artist's page: albums newest first (unknown years last), then their other songs", () => {
  const juno = groups(lib).artistGroups.find((g) => g.title === 'Juno Park');
  const page = artistShelf(juno.tracks, shelves.albumOf);
  assert.deepEqual(titles(page.albums), ['Coastal Roads Vol. 1', 'Small Rooms', 'Untitled Tapes']);
  assert.deepEqual(titles(page.singles), ['Attic (Demo)', 'Front Room (Demo)']);
  const harbor = groups(lib).artistGroups.find((g) => g.title === 'Harbor Lights');
  const hp = artistShelf(harbor.tracks, shelves.albumOf);
  assert.deepEqual(titles(hp.albums), ['Lantern Season', 'Coastal Roads Vol. 1', 'Tidewater']);
  assert.deepEqual(titles(hp.singles), ['Night Ferry', 'Paper Moon']);
});

test('an album of two discs: disc, track, title order with a break before each disc', () => {
  const lantern = shelves.albums.find((a) => a.title === 'Lantern Season');
  const { tracks, rows } = albumRows(lantern.tracks);
  assert.deepEqual(titles(tracks), ['Kindling', 'Ember Road', 'Wick', 'Second Wind', 'Last Lantern']);
  assert.deepEqual(rows.map((r) => (r.disc ? `Disc ${r.disc}` : `${r.at}:${r.track.title}`)), ['Disc 1', '0:Kindling', '1:Ember Road', '2:Wick', 'Disc 2', '3:Second Wind', '4:Last Lantern']);
  // One disc: no breaks.
  const tide = albumRows(shelves.albums.find((a) => a.title === 'Tidewater').tracks);
  assert.ok(tide.rows.every((r) => r.track));
  // Same track number: by title.
  assert.deepEqual(titles(albumRows([{ title: 'b', track: 1 }, { title: 'a', track: 1 }]).tracks), ['a', 'b']);
});

test("an album page's second line: the song's artist only when it is not the album's", () => {
  const tide = shelves.albums.find((a) => a.title === 'Tidewater');
  assert.deepEqual(tide.tracks.map((t) => albumSongLine2(t, tide.artist)), ['', '', '', '', 'Harbor Lights feat. Mira Vale']);
  const comp = shelves.albums.find((a) => a.title === 'Coastal Roads Vol. 1');
  assert.deepEqual(comp.tracks.map((t) => albumSongLine2(t, comp.artist)), ['Harbor Lights', 'Mira Vale', 'Odd Copper', 'Juno Park']);
  assert.equal(albumSongLine2({ artist: 'HARBOR LIGHTS' }, 'Harbor Lights'), '', 'case does not make another artist');
});

test('possible duplicates: equal title and artist once case, spacing and punctuation are left out', () => {
  assert.equal(dupKey('  Night   Ferry! '), 'night ferry');
  assert.equal(dupKey("Don't Stop"), dupKey('dont stop'));
  // Nothing else is stripped: "feat.", "(Live)", "Remastered" make another song.
  assert.notEqual(dupKey('Undertow (Live)'), dupKey('Undertow'));
  assert.notEqual(dupKey('Shoals - Remastered'), dupKey('Shoals'));
  const d = shelves.duplicates;
  assert.deepEqual(d.map((g) => `${g.title} · ${g.artist} · ${g.tracks.length}`), ['Glass Coast · Mira Vale · 2', 'Night Ferry · Harbor Lights · 2']);
  assert.deepEqual(d[1].tracks.map((t) => t.album), ['', 'Tidewater'], 'songs on different albums (or none) count');
  assert.deepEqual(duplicateGroups([{ title: 'Salt', artist: 'Mira Vale' }, { title: 'Salt', artist: 'Mira Vale feat. Juno Park' }]), [], 'another artist is another song');
  assert.deepEqual(duplicateGroups([{ title: '', artist: 'x' }, { title: '', artist: 'x' }]), [], 'songs without a title are left out');
});

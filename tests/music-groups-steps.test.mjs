// Music's category views built in slices (frontend/music/src/library/groups.js, shelves.js shelfSteps,
// Library.warmSteps; MUSIC.md §5.11 "Idle work"): the views made a step at a time are the views made at
// once, and both are the views the library made before they were sliced (the reference builders below are
// that code, with the engine's own sorts). The merge sort in steps orders as the engine's stable sort.
// Invented songs only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sortSteps, run } from '../frontend/music/src/library/groups.js';
import { buildShelves, shelfSteps } from '../frontend/music/src/library/shelves.js';

globalThis.location ??= { href: 'https://site.invalid/music/' };
const { Library } = await import('../frontend/music/src/library/library.js');

let seed = 11;
const rand = (n) => (seed = (seed * 1103515245 + 12345) % 2 ** 31) % n;
const pick = (a) => a[rand(a.length)];
const NAMES = ['Amber', 'birch', 'Cinder', 'Dune & Echo', 'Fjord; Glacier', 'Harbor feat. Iris', 'Jade', 'koi', 'Lumen', 'Moss/Nova', ''];
const songs = (n) => Array.from({ length: n }, (_, i) => ({
  id: 'id' + i, title: `${pick(NAMES)} ${rand(50)}`, artist: pick(NAMES), albumArtist: rand(3) ? pick(NAMES) : '', album: rand(8) ? `${pick(NAMES)} ${rand(30)}` : '',
  composer: rand(2) ? pick(NAMES) : '', genre: pick(['Rock', 'rock', 'Jazz; Blues', 'Ambient', '']), folder: rand(5) ? `Music/${pick(NAMES)}/${rand(40)}` : '',
  albumId: rand(6) ? undefined : 'al:' + rand(20), durationMs: 1000 * rand(400), artId: rand(2) ? 'art' + rand(30) : null, track: rand(12), disc: rand(2),
}));

function library(tracks, prefs = {}) {
  const ctx = { bus: { subscribe() {}, post() {} }, res: { stringByName: (n) => `<${n}>` }, settings: {}, pref: (k) => prefs[k] };
  const lib = new Library(ctx);
  lib.tracks = tracks;
  return lib;
}

/** Steps taken one at a time (as idle slices take them), to the end. */
function stepwise(steps) {
  let r, n = 0;
  while (!(r = steps.next()).done) n++;
  return { value: r.value, steps: n };
}

// The builders as the library had them before (library.js, one task each).
const PLAIN = new Intl.Collator();
function refAlbums(lib, tracks) {
  const unknown = lib.ctx.res?.stringByName('unknown_album_name') ?? 'Unknown album';
  const lc = (s) => (s ?? '').toLowerCase();
  const tagged = new Set();
  if (lib.ctx.pref?.('join_albums') !== false) for (const t of tracks) if (t.album && t.albumArtist) tagged.add(lc(t.album) + '\u0000' + lc(t.albumArtist));
  const map = new Map();
  for (const t of tracks) {
    let key;
    if (t.albumId) key = '\u0002' + t.albumId;
    else if (!t.album) key = '\u0001';
    else { let aa = lc(t.albumArtist); if (!aa && t.artist && tagged.has(lc(t.album) + '\u0000' + lc(t.artist))) aa = lc(t.artist); key = lc(t.album) + '\u0000' + aa; }
    let a = map.get(key);
    if (!a) map.set(key, (a = { kind: 'album', title: t.album || unknown, artist: t.albumArtist || t.artist || '', tracks: [], artId: t.artId }));
    a.tracks.push(t);
    a.artId ||= t.artId;
  }
  return [...map.values()].sort((x, y) => PLAIN.compare(x.title, y.title));
}
function refNamed(lib, tracks, field, kind, unknownName, unknownFallback) {
  const unknown = lib.ctx.res?.stringByName(unknownName) ?? unknownFallback;
  const showUnsplit = field !== 'genre' && !!lib.ctx.pref?.('show_unsplit_cats');
  const map = new Map();
  const add = (name, t) => { const k = name.toLowerCase(); let g = map.get(k); if (!g) map.set(k, (g = { kind, title: name || unknown, tracks: [] })); if (g.tracks[g.tracks.length - 1] !== t) g.tracks.push(t); };
  const splitters = lib.splitters();
  for (const t of tracks) { const { names, unsplit } = lib.namesOf(t, field, splitters); for (const n of names) add(n, t); if (unsplit && showUnsplit) add(unsplit, t); }
  return [...map.values()].sort((x, y) => PLAIN.compare(x.title, y.title));
}
function refAlbumArtists(lib, tracks) {
  const unknown = lib.ctx.res?.stringByName('unknown_artist_name') ?? 'Unknown artist';
  const showUnsplit = !!lib.ctx.pref?.('show_unsplit_cats');
  const map = new Map(), splitters = lib.splitters();
  for (const t of tracks) {
    const field = t.albumArtist ? 'albumArtist' : 'artist';
    const { names, unsplit } = lib.namesOf(t, field, splitters);
    for (const n of unsplit && showUnsplit ? [...names, unsplit] : names) { const k = n.toLowerCase(); let g = map.get(k); if (!g) map.set(k, (g = { kind: 'albumArtist', title: n || unknown, tracks: [] })); g.tracks.push(t); }
  }
  return [...map.values()].sort((x, y) => PLAIN.compare(x.title, y.title));
}
function refFolders(tracks) {
  const map = new Map();
  for (const t of tracks) { const k = t.folder || '/'; (map.get(k) ?? map.set(k, { kind: 'folder', title: k.split('/').pop() || k, path: k, tracks: [] }).get(k)).tracks.push(t); }
  return [...map.values()].sort((x, y) => PLAIN.compare(x.path, y.path));
}

for (const prefs of [{}, { join_albums: false, show_unsplit_cats: true, artists_split_chars: '&;/' }]) {
  test(`every view built in steps is the view built before (${JSON.stringify(prefs)})`, () => {
    const tracks = songs(3000);
    const lib = library(tracks, prefs);
    const want = {
      albums: refAlbums(lib, tracks), artists: refNamed(lib, tracks, 'artist', 'artist', 'unknown_artist_name', 'Unknown artist'),
      albumArtists: refAlbumArtists(lib, tracks), composers: refNamed(lib, tracks, 'composer', 'composer', 'unknown_composer_name', 'Unknown composer'),
      genres: refNamed(lib, tracks, 'genre', 'genre', 'unknown_genre_name', 'Unknown genre'), folders: refFolders(tracks),
    };
    for (const [kind, expected] of Object.entries(want)) {
      const { value, steps } = stepwise(library(tracks, prefs).groupedSteps(kind));
      assert.ok(steps > 1, `${kind} yields along the way`);
      assert.deepEqual(value, expected, kind + ' (steps)');
      assert.deepEqual(library(tracks, prefs)[kind](), expected, kind + ' (at once)');
    }
    const shelvesBefore = buildShelves({ albumGroups: want.albums, artistGroups: want.artists, names: (s) => lib.namesOf({ albumArtist: s }, 'albumArtist').names });
    const sliced = library(tracks, prefs);
    assert.deepEqual(stepwise(sliced.warmSteps()).value, undefined);
    assert.deepEqual(sliced.shelves(), shelvesBefore, 'the shelves');
    assert.equal(sliced.shelves(), sliced.shelves(), 'kept once built');
  });
}

test('the shelves in steps are the shelves at once', () => {
  const lib = library(songs(2500));
  const groups = { albumGroups: lib.albums(), artistGroups: lib.artists() };
  assert.deepEqual(stepwise(shelfSteps(groups)).value, buildShelves(groups));
});

test('a view built ahead for songs not yet shown is kept for them, beside the shown ones', () => {
  const shown = songs(800), next = songs(900);
  const lib = library(shown);
  const albums = lib.albums();
  lib._nextTracks = next;
  const ahead = stepwise(lib.groupedSteps('albums', next)).value;
  assert.equal(lib.albums(), albums, 'the shown view stays');
  lib.tracks = next;
  lib._nextTracks = null;
  assert.equal(lib.albums(), ahead, 'the view built ahead is taken once they show');
});

test("the merge sort in steps orders as the engine's stable sort", () => {
  for (const n of [0, 1, 100, 129, 1000, 5003]) {
    const items = Array.from({ length: n }, (_, i) => ({ k: rand(40), i }));
    const cmp = (a, b) => a.k - b.k;
    const want = items.slice().sort(cmp);
    const got = items.slice();
    const r = stepwise(sortSteps(got, cmp));
    assert.deepEqual(got, want, `n=${n}`);
    assert.equal(r.value, got, 'in place');
    assert.deepEqual(run(sortSteps(items.slice(), cmp)), want);
  }
});

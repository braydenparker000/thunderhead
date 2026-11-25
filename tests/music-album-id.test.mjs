// Albums grouped by the catalog's album id (frontend/music/src/library/r2.js and library.js): the
// catalog's `metadata.albumId` goes onto the track, and songs that share one are one album however
// their album tags are spelled; songs without one group by album name and album artist, as before.
// Invented songs only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { r2Tracks } from '../frontend/music/src/library/r2.js';
import { Library } from '../frontend/music/src/library/library.js';

const URL_ = 'https://worker.invalid/music/library.json';
const song = (n, metadata) => ({ id: `r2_native_${String(n).repeat(64)}`, path: `Library/Song ${n}.opus`, metadata: { dur: 180, ...metadata } });

function albums(tracks) {
  globalThis.location ??= { href: 'https://site.invalid/music/' };
  const lib = new Library({ bus: { subscribe() {}, post() {} }, res: { stringByName: () => 'Unknown album' }, settings: {} });
  lib.tracks = r2Tracks({ tracks }, URL_);
  return lib.buildAlbums().map((a) => [a.title, a.tracks.map((t) => t.title)]);
}

test("the catalog's album id goes onto the track; none, none", () => {
  const [a, b] = r2Tracks({ tracks: [song(1, { title: 'One', albumId: 'rg:0f1e2d3c-0000-4000-8000-000000000001' }), song(2, { title: 'Two' })] }, URL_);
  assert.equal(a.albumId, 'rg:0f1e2d3c-0000-4000-8000-000000000001');
  assert.equal('albumId' in b, false);
});

test('two spellings of one album with the same album id are one album', () => {
  const id = 'rg:0f1e2d3c-0000-4000-8000-000000000002';
  const got = albums([
    song(1, { title: 'First Light', album: 'Harbour Lights', albumArtist: 'The Invented Band', albumId: id }),
    song(2, { title: 'Second Wind', album: 'Harbour Lights (Deluxe)', albumArtist: 'Invented Band', albumId: id }),
    song(3, { title: 'Elsewhere', album: 'Harbour Lights', albumArtist: 'Someone Else', albumId: 'al:someone-else-harbour-lights' }),
  ]);
  assert.deepEqual(got, [
    ['Harbour Lights', ['First Light', 'Second Wind']],
    ['Harbour Lights', ['Elsewhere']],
  ]);
});

test('without an album id, albums group by name and album artist as before', () => {
  const got = albums([
    song(1, { title: 'First Light', album: 'Harbour Lights', albumArtist: 'The Invented Band' }),
    song(2, { title: 'Second Wind', album: 'harbour lights', albumArtist: 'the invented band' }),
    song(3, { title: 'Third Rail', album: 'Harbour Lights (Deluxe)', albumArtist: 'Invented Band' }),
    song(4, { title: 'Loose', artist: 'Nobody' }),
  ]);
  assert.deepEqual(got, [
    ['Harbour Lights', ['First Light', 'Second Wind']],
    ['Harbour Lights (Deluxe)', ['Third Rail']],
    ['Unknown album', ['Loose']],
  ]);
});

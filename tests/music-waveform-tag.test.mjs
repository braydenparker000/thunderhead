// A waveform registered again on the Worker reaches the phone (frontend/music/src/library/r2.js and
// library.js): the catalog's `waveformAt` (the track row's last change) goes onto the track, and a
// stored waveform tagged with an older one is not used, so the new one is fetched; the same time
// keeps the stored copy. Invented songs only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { r2Tracks } from '../frontend/music/src/library/r2.js';
import { Library } from '../frontend/music/src/library/library.js';

const ID = `r2_native_${'a'.repeat(64)}`;
const catalog = (at) => ({
  tracks: [{ id: ID, path: 'Library/An invented song.opus', metadata: { title: 'An invented song', dur: 200 }, waveformBars: true, waveformKind: 'rms', waveformAt: at }],
});

function library() {
  globalThis.location ??= { href: 'https://site.invalid/music/' };
  const ctx = { bus: { subscribe() {}, post() {} }, res: { stringByName: () => 'Playlist' }, settings: {} };
  return new Library(ctx);
}

test("the catalog's waveformAt goes onto the track", () => {
  const [t] = r2Tracks(catalog(1_790_000_000_123), 'https://worker.invalid/music/library.json');
  assert.equal(t.waveAt, 1_790_000_000_123);
  assert.equal(t.waveKind, 'rms');
});

test('a stored waveform from before the waveform was registered again is fetched again; the same is kept', () => {
  const lib = library();
  const url = 'https://worker.invalid/music/library.json';
  // Stored when the catalog said 1_790_000_000_123.
  lib.userData.set(ID, { wave: [1, 2, 3], waveSrc: 'rms2:1790000000123', plays: 4 });
  const [same] = lib.withUserData(r2Tracks(catalog(1_790_000_000_123), url));
  assert.deepEqual([same.wave, same.plays], [[1, 2, 3], 4]);
  const [redone] = lib.withUserData(r2Tracks(catalog(1_790_000_999_000), url));
  assert.deepEqual([redone.wave, redone.plays], [undefined, 4]);
});

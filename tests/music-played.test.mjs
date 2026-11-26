// Songs kept from playing them (frontend/music/src/library/played-cache.js, through audio-cache.js; the
// bytes from th/music/stream/track.js `keep`): a song whose stream read every byte is kept whole with no
// download of its own, and playing it again makes no audio request (it opens as a blob URL, which the
// player plays from the phone); a seek that left a gap keeps nothing; the 200 MB cap drops the song played
// longest ago first; a kept copy of another length than the catalogue's (a replaced file) is not used. Fake
// caches and fetch; node only, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TrackReader } from '../frontend/th/music/stream/track.js';
import { AudioCache } from '../frontend/music/src/library/audio-cache.js';
import { PLAYED_BUDGET, PLAYED_CACHE, PlayedCache } from '../frontend/music/src/library/played-cache.js';
import { TONE, longTone } from './fixtures/ogg-make.mjs';

const SONG = 'https://example.test/music/audio/song-1';

/** Caches in memory. */
function fakeCaches() {
  const stores = new Map();
  return {
    stores,
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const m = stores.get(name);
      return {
        async match(k) { return m.get(String(k))?.clone() ?? undefined; },
        async put(k, r) { m.set(String(k), r); },
        async delete(k) { return m.delete(String(k)); },
        async keys() { return [...m.keys()].map((url) => ({ url })); },
      };
    },
    async delete(name) { return stores.delete(name); },
  };
}

/** localStorage in memory. */
function fakeStorage() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

/** A bucket answering Range requests on `bytes`, counting every request. */
function bucket(bytes) {
  const asked = [];
  const fetch = async (url, init) => {
    const [, a, b] = /^bytes=(\d+)-(\d+)$/.exec(init?.headers?.Range ?? 'bytes=0-0').map(Number);
    asked.push([url, a, b]);
    if (a >= bytes.length) return new Response(null, { status: 416 });
    const end = Math.min(b, bytes.length - 1);
    return new Response(bytes.slice(a, end + 1), { status: 206, headers: { 'content-range': `bytes ${a}-${end}/${bytes.length}` } });
  };
  return { fetch, asked };
}

const signal = () => new AbortController().signal;

test('a song its stream read to the end is kept whole, and playing it again makes no audio request', async () => {
  const net = bucket(TONE);
  const reader = new TrackReader({ url: () => SONG, bytes: TONE.length }, { fetch: net.fetch, keep: true });
  while (!reader.done) await reader.fill(4096, () => reader.take(Infinity), signal());
  const whole = reader.whole();
  assert.ok(whole, 'every byte was read');
  assert.deepEqual(whole, TONE, 'the file as the bucket holds it');
  const streamed = net.asked.length;

  const caches = fakeCaches();
  const cache = new AudioCache({ caches, storage: fakeStorage(), fetch: async () => { throw new Error('no download for a kept song'); }, online: () => true });
  await cache.ready;
  assert.equal(await cache.keepPlayed(SONG, whole, TONE.length), true);
  assert.ok(cache.has(SONG), 'counts as on the phone (heads, preloads and the stall guard ask has())');
  assert.equal(caches.stores.get(PLAYED_CACHE).size, 1);

  // The replay: the player's sourceFor asks the cache before the network, and plays a blob URL.
  const local = await cache.open(SONG);
  assert.match(local, /^blob:/);
  assert.equal(cache.sourceOf(local), SONG);
  assert.equal(net.asked.length, streamed, 'no audio request for the replay');
  const blob = await cache.played.open(SONG);
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), TONE, 'the kept copy is the song');
  cache.release(local);

  // A size other than the catalog's is not kept.
  assert.equal(await cache.keepPlayed('https://example.test/music/audio/song-2', whole, TONE.length + 1), false);
});

test('a seek that skipped bytes keeps nothing (filling the gap would cost a download)', async () => {
  const bytes = longTone(20); // 60 s
  const reader = new TrackReader({ url: () => SONG, durationMs: 60_000, bytes: bytes.length }, { fetch: bucket(bytes).fetch, keep: true });
  await reader.fill(16 * 1024, () => {}, signal());
  await reader.seek(reader.origin + 312 + 40 * 48000, signal());
  while (!reader.done) await reader.fill(32 * 1024, () => reader.take(Infinity), signal());
  assert.equal(reader.whole(), null);
  // Without `keep`, nothing is held at all.
  const plain = new TrackReader({ url: () => SONG }, { fetch: bucket(TONE).fetch });
  while (!plain.done) await plain.fill(32 * 1024, () => plain.take(Infinity), signal());
  assert.equal(plain.pieces, null);
  assert.equal(plain.whole(), null);
});

test('the cap drops the song played longest ago first; playing one again makes it the newest', async () => {
  assert.equal(PLAYED_BUDGET, 200 * 1024 * 1024);
  let clock = 1000;
  const caches = fakeCaches();
  const played = new PlayedCache({ caches, storage: fakeStorage(), budget: 300, now: () => clock });
  await played.ready;
  const song = (n) => `https://example.test/music/audio/s${n}`;
  const bytes = (n) => new Uint8Array(100).fill(n);
  for (const n of [1, 2, 3]) { clock += 10; assert.equal(await played.keep(song(n), bytes(n)), true); }
  assert.equal(played.bytes, 300);
  // s1 is played again: s2 is now the one played longest ago.
  clock += 10;
  assert.ok(await played.open(song(1)));
  clock += 10;
  assert.equal(await played.keep(song(4), bytes(4)), true);
  assert.deepEqual([1, 2, 3, 4].map((n) => played.has(song(n))), [true, false, true, true]);
  assert.equal(played.bytes, 300, 'never over the cap');
  assert.equal(caches.stores.get(PLAYED_CACHE).size, 3);
  // A song larger than the whole cap is not kept, and nothing goes for it.
  assert.equal(await played.keep(song(5), new Uint8Array(301)), false);
  assert.equal(played.index.size, 3);
  // Settings › On this phone clears it all.
  await played.clear();
  assert.equal(played.index.size, 0);
  assert.equal(caches.stores.has(PLAYED_CACHE), false);
});

test('a kept song of another length than the catalogue says (its file replaced, its id the same) is not used, and goes', async () => {
  const caches = fakeCaches();
  const cache = new AudioCache({ caches, storage: fakeStorage(), fetch: async () => { throw new Error('no download'); }, online: () => true });
  await cache.ready;
  assert.equal(await cache.keepPlayed(SONG, TONE, TONE.length), true);
  // The catalogue's size agrees: it plays from the phone.
  const local = await cache.open(SONG, { expected: TONE.length });
  assert.match(local, /^blob:/);
  cache.release(local);
  // The file was replaced upstream (another size, the same URL): the old bytes are not played, and the copy goes,
  // so the song streams again (and is kept again, whole).
  assert.equal(await cache.open(SONG, { expected: TONE.length + 100 }), null);
  assert.equal(cache.has(SONG), false);
  assert.equal(caches.stores.get(PLAYED_CACHE).size, 0);
  assert.equal(await cache.keepPlayed(SONG, new Uint8Array(TONE.length + 100).fill(1), TONE.length + 100), true);
  assert.ok(await cache.played.open(SONG, { expected: TONE.length + 100 }), 'the new file is kept and used');
  // A size the catalogue does not know (0) checks nothing.
  assert.ok(await cache.played.open(SONG));
});

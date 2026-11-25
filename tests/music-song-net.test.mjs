// Each streamed song's network figures in Music's report (frontend/music/src/player/song-net.js; the reader's
// `net`, frontend/th/music/stream/track.js; the bridge's TH-Sign-Ms; MUSIC.md §6.3): sign ms, first-byte ms
// from its first request, kbps received, its first range's size, and other requests at its start by kind.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TrackReader } from '../frontend/th/music/stream/track.js';
import { SongNet } from '../frontend/music/src/player/song-net.js';
import { TONE } from './fixtures/ogg-make.mjs';

test("a song's reader keeps its first request, first byte, bytes and the worker's sign ms; the report reads them", async () => {
  const fetch = async (url, init) => {
    const m = /bytes=(\d+)-(\d+)/.exec(init.headers.Range);
    const a = Number(m[1]), b = Math.min(Number(m[2]), TONE.length - 1);
    await new Promise((r) => setTimeout(r, 20));
    return new Response(TONE.subarray(a, b + 1), { status: 206, headers: { 'Content-Range': `bytes ${a}-${b}/${TONE.length}`, 'TH-Sign-Ms': '412' } });
  };
  const reader = new TrackReader({ url: () => 'https://old.example.test/music/library/audio/r2_native_aaaabbbbcccc' }, { fetch });
  await reader.fill(8192, () => {}, new AbortController().signal);
  await reader.fill(8192, () => {}, new AbortController().signal);
  const net = reader.net;
  assert.equal(net.signMs, 412);
  assert.equal(net.firstRange, 8192);
  assert.equal(net.bytes, TONE.length, 'the whole file in two reads');
  assert.ok(net.firstByteAt >= net.firstAt + 15 && net.lastByteAt >= net.firstByteAt);

  const sn = new SongNet();
  sn.add('r2_native_aaaabbbbcccc', { items: [{ reader }] });
  const real = performance.getEntriesByType;
  performance.getEntriesByType = () => [
    { name: 'https://old.example.test/music/library/audio/r2_native_aaaabbbbcccc', startTime: net.firstAt, responseEnd: net.lastByteAt },
    { name: 'https://old.example.test/music/library/audio/r2_native_ddddeeeeffff', startTime: net.firstAt - 50, responseEnd: net.firstAt + 500 },
    { name: 'https://api.example.test/v1/music/marks', startTime: net.firstAt + 1, responseEnd: net.firstAt + 300 },
    { name: 'https://api.example.test/v1/music/marks', startTime: net.firstAt - 5000, responseEnd: net.firstAt - 4000 },
  ];
  try {
    const [r] = sn.report(0);
    assert.deepEqual({ ...r, at: 0, firstByteMs: 0, kbps: 0 }, { at: 0, signMs: 412, firstByteMs: 0, kbps: 0, bytes: TONE.length, firstRange: 8192, othersAtStart: 2, othersKinds: { 'song bytes': 1, sync: 1 } });
    assert.ok(r.firstByteMs >= 15 && r.kbps > 0);
  } finally {
    performance.getEntriesByType = real;
  }
});

test("grid covers wait for the playing song's stream before a slot; the player's cover goes at once, and one cover is read once (lab: two reads of the tapped song's first 64 KB)", async () => {
  const { Library } = await import('../frontend/music/src/library/library.js');
  let free;
  const asked = [];
  const gate = new Promise((r) => { free = r; });
  const lib = Object.create(Library.prototype);
  Object.assign(lib, { ctx: { player: { linkFree: () => gate } }, byId: new Map(), coverPuts: 0 });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => { asked.push(url); return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } }); };
  const A = 'https://api.example.test/v1/music/art/r2_native_aaaabbbbcccc', B = 'https://api.example.test/v1/music/art/r2_native_ddddeeeeffff';
  try {
    const row = lib.remoteCover(A);
    const other = lib.remoteCover(B);
    for (let i = 0; i < 20; i++) await null;
    assert.equal(asked.length, 0, 'grid covers wait while the playing song is short of its stream');
    assert.equal(lib.slotsBusy ?? 0, 0, 'no slot held while waiting');
    // The playing song's cover, its row's read waiting: it goes now, and the row's read is the same one.
    const player = lib.remoteCover(A, { priority: true });
    const [x, y] = await Promise.all([row, player]);
    assert.deepEqual(asked, [A], "the player's cover while the link is busy, read once for both");
    assert.equal(x.size, 3);
    assert.equal(y.size, 3);
    free(true);
    await other;
    assert.deepEqual(asked, [A, B], 'the other grid cover once the link is free');
  } finally {
    globalThis.fetch = realFetch;
  }
});

/** A Library with only its cover parts, Cache Storage as plain maps, and fetch answering from `answer(url)`. */
async function coverLab(answer, player = { linkFree: async () => true }) {
  const { Library } = await import('../frontend/music/src/library/library.js');
  const lib = Object.create(Library.prototype);
  const posts = [];
  Object.assign(lib, { ctx: { player, bus: { post: (...a) => posts.push(a) } }, byId: new Map(), coverPuts: 0, artCache: new Map(), thumbCache: new Map(), customArt: new Map(), userData: new Map() });
  const stores = new Map();
  const real = { fetch: globalThis.fetch, caches: globalThis.caches, location: globalThis.location };
  globalThis.caches = {
    open: async (name) => {
      if (!stores.has(name)) {
        const m = new Map();
        stores.set(name, { m, match: async (k) => m.get(k)?.clone(), put: async (k, r) => void m.set(k, r), keys: async () => [...m.keys()] });
      }
      return stores.get(name);
    },
  };
  globalThis.location = { href: 'https://site.example.test/music/' };
  const asked = [];
  globalThis.fetch = async (url) => (asked.push(url), answer(url));
  const restore = () => Object.assign(globalThis, real);
  return { lib, posts, asked, stores, restore };
}
const image = () => new Response(new Uint8Array([9, 9, 9]), { headers: { 'content-type': 'image/jpeg' } });

test('a cover that fails is not remembered: asked again after 2 s, it appears; a 404 stays final', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  let down = true;
  const { lib, posts, asked, restore } = await coverLab((url) => (url.endsWith('none') ? new Response('', { status: 404 }) : down ? new Response('', { status: 503 }) : image()));
  try {
    const song = { id: 'r2_native_aaaabbbbcccc', remote: true, artId: 'https://api.example.test/v1/music/art/r2_native_aaaabbbbcccc' };
    assert.equal(await lib.artFor(song), null, 'not now');
    assert.equal(lib.artCache.size, 0, 'the failure is not kept');
    assert.equal(await lib.thumbFor(song), null, 'before its time: not asked again');
    assert.equal(asked.length, 1);
    down = false;
    t.mock.timers.tick(1999);
    assert.equal(posts.length, 0);
    t.mock.timers.tick(1);
    assert.deepEqual(posts.map(([bus, msg, , d]) => [bus, msg, d.tracks]), [['bus_data', 'msg_data_art_changed', [song]]], 'its song asks again');
    const art = await lib.artFor(song);
    assert.ok(art?.url, 'it appears');
    assert.equal(asked.length, 2);

    const none = { id: 'r2_native_nnnnoooonnnn', remote: true, artId: 'https://api.example.test/v1/music/art/none' };
    assert.equal(await lib.artFor(none), null);
    assert.equal(await lib.artFor(none), null);
    assert.equal(asked.length, 3, 'a 404 is asked once');
    assert.equal(lib.coverFails?.has(none.artId) ?? false, false, 'and never again');
  } finally {
    restore();
  }
});

test('songs sharing one coverKey make one cover request, one thumbnail; a thumbnail kept under the song is still found', async () => {
  const { r2Tracks } = await import('../frontend/music/src/library/r2.js');
  const { lib, asked, stores, restore } = await coverLab(() => image());
  try {
    const song = (id, coverKey) => ({ id, path: `Invented/${id}.opus`, size: 1000, metadata: { title: id, dur: 1 }, coverKey });
    const KEY = 'native/art/0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0.jpg';
    const [a, b, c] = lib.withUserData(r2Tracks({ tracks: [song('r2_native_aaaaaaaaaaaa', KEY), song('r2_native_bbbbbbbbbbbb', KEY), song('r2_native_cccccccccccc', null)] }, 'https://old.example.test/music/library.json'));
    assert.equal(a.coverKey, KEY);
    assert.notEqual(a.artId, b.artId, 'each song keeps its own address (the Worker signs music:<id>#art)');
    const [x, y, z] = await Promise.all([lib.artFor(a), lib.artFor(b), lib.thumbFor(b)]);
    assert.equal(asked.length, 1, 'one request for the two songs');
    assert.equal(x, y, 'one image');
    assert.ok(z?.url);
    assert.equal(await lib.thumbFor(a), z, 'one thumbnail');
    assert.equal(asked.length, 1);
    assert.equal(c.artUrl, null, 'no coverKey: its embedded cover, by its own key');

    // A thumbnail kept the old way (under the song's address) is found, not fetched again.
    const d = lib.withUserData(r2Tracks({ tracks: [song('r2_native_dddddddddddd', 'native/art/other.jpg')] }, 'https://old.example.test/music/library.json'))[0];
    await (await globalThis.caches.open('claude-player-thumbs')).put(d.artId, image());
    assert.ok((await lib.thumbFor(d))?.url);
    assert.equal(asked.length, 1, 'the old thumbnail, no download');
    assert.ok(stores.get('claude-player-thumbs').m.has(`https://site.example.test/music/covers/shared/${encodeURIComponent('native/art/other.jpg')}`), 'and kept under the cover too');
  } finally {
    restore();
  }
});

test("the playing song's cover is asked while the link is busy; a grid thumbnail is not", async () => {
  const { lib, asked, restore } = await coverLab(() => image(), { linkFree: () => new Promise(() => {}) });
  try {
    const playing = { id: 'r2_native_pppppppppppp', remote: true, artId: 'https://api.example.test/v1/music/art/r2_native_pppppppppppp' };
    const row = { id: 'r2_native_rrrrrrrrrrrr', remote: true, artId: 'https://api.example.test/v1/music/art/r2_native_rrrrrrrrrrrr' };
    lib.thumbFor(row);
    assert.ok((await lib.artFor(playing))?.url);
    assert.deepEqual(asked, [playing.artId]);
  } finally {
    restore();
  }
});

test('a link that never gets 10 s ahead: covers load after the wait, one at a time, at low priority', async () => {
  const { Library } = await import('../frontend/music/src/library/library.js');
  const lib = Object.create(Library.prototype);
  Object.assign(lib, { ctx: { player: { linkFree: async () => false } }, byId: new Map(), coverPuts: 0 });
  const realFetch = globalThis.fetch;
  let open = 0, most = 0;
  const inits = [];
  globalThis.fetch = async (url, init) => {
    inits.push(init);
    most = Math.max(most, ++open);
    await new Promise((r) => setTimeout(r, 5));
    open--;
    return new Response(new Uint8Array([7]), { headers: { 'content-type': 'image/jpeg' } });
  };
  try {
    const got = await Promise.all([1, 2, 3].map((k) => lib.remoteCover(`https://api.example.test/v1/music/art/r2_native_${String(k).repeat(12)}`)));
    assert.deepEqual(got.map((b) => b.size), [1, 1, 1], 'they load');
    assert.equal(most, 1, 'one at a time');
    assert.ok(inits.every((i) => i.priority === 'low'));
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("the player's link wait: its deck's own events, never longer than 3 s, one wait for every caller, no polling", async () => {
  const { waitLinkFree, MAX_MS } = await import('../frontend/music/src/player/link-free.js');
  assert.equal(MAX_MS, 3000);
  const el = new EventTarget();
  const player = { audio: el };
  let ok = false;
  const a = waitLinkFree(player, () => ok, 200), b = waitLinkFree(player, () => ok, 200);
  assert.equal(a, b, 'shared');
  ok = true;
  el.dispatchEvent(new Event('progress'));
  assert.equal(await a, true, 'the buffer event answers it');
  ok = false;
  const t0 = Date.now();
  assert.equal(await waitLinkFree(player, () => ok, 60), false, 'gives up at its limit');
  assert.ok(Date.now() - t0 < 1000);
  ok = false;
  const p = waitLinkFree(player, () => ok, 5000);
  ok = true; // e.g. paused
  el.dispatchEvent(new Event('pause'));
  assert.equal(await p, true);
});

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

test("covers wait for the playing song's stream before a slot, and one cover is read once (lab: two reads of the tapped song's first 64 KB)", async () => {
  const { Library } = await import('../frontend/music/src/library/library.js');
  let free, asked = 0;
  const gate = new Promise((r) => { free = r; });
  const lib = Object.create(Library.prototype);
  Object.assign(lib, { ctx: { player: { linkFree: () => gate } }, byId: new Map(), coverPuts: 0 });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { asked++; return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } }); };
  try {
    const a = lib.remoteCover('https://api.example.test/v1/music/art/r2_native_aaaabbbbcccc', { priority: true });
    const b = lib.remoteCover('https://api.example.test/v1/music/art/r2_native_aaaabbbbcccc');
    for (let i = 0; i < 20; i++) await null;
    assert.equal(asked, 0, 'nothing while the playing song is short of its stream');
    assert.equal(lib.slotsBusy ?? 0, 0, 'no slot held while waiting');
    free(true);
    const [x, y] = await Promise.all([a, b]);
    assert.equal(asked, 1, 'read once for both');
    assert.equal(x.size, 3);
    assert.equal(y.size, 3);
  } finally {
    globalThis.fetch = realFetch;
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

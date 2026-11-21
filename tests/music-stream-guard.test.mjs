// The ported player's stream guard (frontend/music/src/player/stream-guard.js) with a stand-in player
// and deck: a stream that keeps failing with the network up is reloaded where it was, with growing
// pauses, asked whether its file answers past the head kept on the phone (which the service worker
// would answer even offline), and after 6 failed reloads the player pauses and says so instead of
// trying for ever; Play reloads it. Node only, with mocked clocks.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { StreamGuard } from '../frontend/music/src/player/stream-guard.js';
import { TrackReader, linkOf } from '../frontend/th/music/stream/track.js';
import { longTone } from './fixtures/ogg-make.mjs';

const SRC = 'https://old.example.test/music/library/audio/r2_native_x';

function setup() {
  const el = { error: { code: 2, message: 'network' }, currentSrc: SRC, getAttribute: () => SRC, addEventListener() {} };
  const out = { reloads: [], toasts: [], probes: [], paused: 0 };
  const player = {
    audio: el,
    track: { id: 't1', src: SRC, title: 'A song' },
    playing: true,
    ctx: {
      bus: { post: (bus, msg, src, data) => out.toasts.push([msg, data]) },
      audioHeads: { kept: new Map([[SRC, { head: 300_000, tailStart: 900_000, total: 1_000_000 }]]) },
      audioCache: { has: () => false, sourceOf: () => null },
    },
    reloadAt: (pos) => out.reloads.push(pos),
    pause() { out.paused++; this.playing = false; },
    skipTrack() { throw new Error('not expected'); },
    trackAt: () => null,
  };
  const guard = new StreamGuard(player, { online: () => true, probe: async (url, from) => (out.probes.push([url, from]), 'unreachable') });
  return { el, player, guard, out };
}

test('a stream that keeps failing online: 6 reloads, probed past the head, then paused with a toast; Play reloads', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  try {
    const { el, player, guard, out } = setup();
    guard.pos = 42;
    for (let k = 0; k < 6; k++) {
      guard.failed(el);
      mock.timers.tick(30_000);
      // (The probe answers after a turn of the event loop.)
      for (let i = 0; i < 5; i++) await null;
    }
    assert.equal(out.reloads.length, 6, 'six reloads');
    assert.deepEqual(out.reloads, [42, 42, 42, 42, 42, 42]);
    assert.ok(out.probes.length >= 1);
    assert.deepEqual(out.probes[0], [SRC, 300_000], 'asked past the head kept on the phone');
    assert.equal(out.paused, 0);
    guard.failed(el);
    mock.timers.tick(30_000);
    assert.equal(out.reloads.length, 6, 'no seventh reload');
    assert.equal(out.paused, 1, 'the player pauses');
    assert.deepEqual(out.toasts.at(-1), ['cmd_gui_show_toast', { title: 'Lost the connection', line2: 'Tap play to try again' }]);
    assert.equal(guard.summary().gaveUp, 1);
    player.playing = true;
    assert.equal(guard.resume(), true, 'Play reloads the track where it was');
    assert.equal(out.reloads.at(-1), 42);
  } finally {
    mock.timers.reset();
  }
});

test('a song streamed through the feed is logged as the stream, not the device (its Media Source is a blob URL too)', async () => {
  const { deckSource } = await import('../frontend/music/src/player/playback-log.js');
  const cache = { sourceOf: (u) => u === 'blob:copy' };
  assert.equal(deckSource({ currentSrc: 'blob:media-source', _stream: { feed: {} } }, cache), 'stream', 'the feed: the network');
  assert.equal(deckSource({ currentSrc: 'blob:copy' }, cache), 'offline copy');
  assert.equal(deckSource({ currentSrc: 'blob:file' }, cache), 'device', 'a stored file');
  assert.equal(deckSource({ currentSrc: SRC }, cache), 'stream');
});

test("a stream's stall waits on its request while it is alive, and acts 2 s after it goes idle (the lab's 15 s tunnel)", () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  try {
    const { el, player, out } = setup();
    let clock = 0, link = { busy: true, quietMs: 0 };
    const guard = new StreamGuard(player, { online: () => true, now: () => clock });
    Object.assign(el, { error: null, paused: false, readyState: 2, _stream: { feed: { link: () => link } } });
    guard.pos = 5;
    const tick = (ms) => { for (let t = 0; t < ms; t += 1000) { clock += 1000; if (link.busy) link.quietMs += 1000; mock.timers.tick(1000); } };
    guard.waiting(el);
    // In the lab a dead link 3 s into a song: the reload at 10 s re-sought the file and played 7 s after
    // the link came back; the request under way would have played on as soon as its bytes came.
    tick(20_000);
    assert.deepEqual(out.reloads, [], 'no reload while its request is under way');
    // The request ends with nothing more under way (the feed stuck): 2 s later, a reload where it was.
    link = { busy: false, quietMs: Infinity };
    tick(1000);
    assert.deepEqual(out.reloads, []);
    tick(2000);
    mock.timers.tick(0);
    assert.deepEqual(out.reloads, [5]);
    // A request that hangs (no byte for 15 s, linkOf's STILL_MS) counts as gone.
    const g2 = setup();
    let c2 = 0;
    const guard2 = new StreamGuard(g2.player, { online: () => true, now: () => c2 });
    Object.assign(g2.el, { error: null, paused: false, readyState: 2, _stream: { feed: { link: () => ({ busy: c2 < 15_000, quietMs: c2 }) } } });
    guard2.waiting(g2.el);
    for (let t = 0; t < 15_000; t += 1000) { c2 += 1000; mock.timers.tick(1000); }
    assert.deepEqual(g2.out.reloads, []);
    for (let t = 0; t < 2000; t += 1000) { c2 += 1000; mock.timers.tick(1000); }
    mock.timers.tick(0);
    assert.equal(g2.out.reloads.length, 1);
  } finally {
    mock.timers.reset();
  }
});

test("a seek on a slow link (6 s of probes) is the link alive: no reload; a dead request is not; one reload per stall, then a wait", async () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  try {
    const SONG = longTone(20);
    let clock = 0, dead = false;
    // A slow link: each request answers after 1.5 s; dead, it never answers.
    const fetch = (url, init) => new Promise((resolve, reject) => {
      if (dead) { init.signal?.addEventListener('abort', () => reject(init.signal.reason)); return; }
      setTimeout(() => {
        const m = /bytes=(\d+)-(\d+)/.exec(init.headers.Range), a = Number(m[1]), b = Math.min(Number(m[2]), SONG.length - 1);
        resolve(new Response(SONG.subarray(a, b + 1), { status: 206, headers: { 'Content-Range': `bytes ${a}-${b}/${SONG.length}` } }));
      }, 1500);
    });
    const reader = new TrackReader({ url: () => 'https://old.example.test/a', durationMs: 60_000, bytes: SONG.length }, { fetch, now: () => clock });
    const { el, player, out } = setup();
    const guard = new StreamGuard(player, { online: () => true, now: () => clock });
    Object.assign(el, { error: null, paused: false, readyState: 2, _stream: { feed: { link: () => linkOf([reader], clock) } } });
    const step = async (ms) => { for (let t = 0; t < ms; t += 250) { clock += 250; mock.timers.tick(250); for (let i = 0; i < 20; i++) await null; } };
    const ctrl = new AbortController();
    const first = reader.fill(16 * 1024, () => {}, ctrl.signal);
    await step(2000);
    await first;
    guard.pos = 40;
    guard.waiting(el);
    let seeking = true;
    const seek = reader.seek(reader.origin + 312 + 40 * 48000, ctrl.signal).finally(() => { seeking = false; });
    const t0 = clock;
    while (seeking && clock - t0 < 20_000) await step(250);
    await seek;
    assert.ok(clock - t0 >= 4000, `the seek took ${clock - t0} ms`);
    assert.deepEqual(out.reloads, [], 'no reload while the seek probes the file');
    // Now a request that never answers: 15 s without life, then idle, then one reload.
    dead = true;
    const hung = reader.fill(16 * 1024, () => {}, ctrl.signal).catch(() => {});
    await step(16_000);
    assert.deepEqual(out.reloads, []);
    await step(3000);
    assert.deepEqual(out.reloads, [40], 'one reload');
    // The reloaded deck waits again at once: no second reload before the gap.
    guard.waiting(el);
    await step(10_000);
    assert.deepEqual(out.reloads, [40], 'one reload per stall: the next waits');
    ctrl.abort();
    await hung;
  } finally {
    mock.timers.reset();
  }
});

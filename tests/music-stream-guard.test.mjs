// The ported player's stream guard (frontend/music/src/player/stream-guard.js) with a stand-in player
// and deck: a stream that keeps failing with the network up is reloaded where it was, with growing
// pauses, asked whether its file answers past the head kept on the phone (which the service worker
// would answer even offline), and after 6 failed reloads the player pauses and says so instead of
// trying for ever; Play reloads it. Node only, with mocked clocks.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { StreamGuard } from '../frontend/music/src/player/stream-guard.js';

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

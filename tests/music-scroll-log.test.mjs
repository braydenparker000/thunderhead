// Music's scroll recorder (frontend/music/src/ui/scroll-log.js; MUSIC.md §5.10 "Scrolling"): its math with a
// clock and frames the test gives. A gesture's entry counts its frames, those over 20 ms and over 50 ms and the
// worst; it ends two frames after the list is at rest; a new target ends the one before; the session's summary
// adds them up a screen, layout and zoom with the 95th percentile from the histogram; the screen of a list is
// one of the fixed names, never a list's own; nothing runs (no frame asked for) while nothing scrolls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ScrollLog, SCREENS, bound, p95, screenOf } from '../frontend/music/src/ui/scroll-log.js';

/** A recorder whose frames the test runs: `frame(dt)` advances the clock and runs the frame asked for. */
function setup() {
  let t = 1000, asked = null, frames = 0;
  const log = new ScrollLog({ now: () => t, raf: (f) => { asked = f; } });
  return {
    log,
    get pending() { return !!asked; },
    get ran() { return frames; },
    frame(dt) { t += dt; const f = asked; asked = null; frames++; f?.(t); },
  };
}
const target = (info = { screen: 'library-songs', layout: 'list', zoom: 3 }) => ({ moving: true, scrollMoving() { return this.moving; }, scrollInfo: () => info });

test('one gesture: frames, late and janky frames and the worst, ended two frames after rest', () => {
  const s = setup(), list = target();
  assert.equal(s.pending, false, 'no frame asked for before a scroll');
  const rows0 = bound.rows;
  s.log.begin(list);
  s.log.begin(list); // the same gesture goes on
  assert.equal(s.pending, true);
  s.frame(16); // the first frame only starts the count
  for (const dt of [16, 17, 25, 16, 60, 16]) s.frame(dt);
  bound.rows += 5;
  bound.covers += 2;
  list.moving = false;
  s.frame(16);
  assert.equal(s.log.entries.length, 0, 'one frame at rest: not ended yet');
  s.frame(16);
  assert.equal(s.pending, false, 'no frame asked for once it ended');
  assert.equal(s.log.entries.length, 1);
  const e = s.log.entries[0];
  assert.deepEqual({ ...e, ms: undefined }, { screen: 'library-songs', layout: 'list', zoom: 3, ms: undefined, frames: 8, late: 2, jank: 1, worstMs: 60, rows: 5, covers: 2 });
  assert.equal(e.ms, 16 + 150 + 32, 'from its start to its end');
  assert.equal(bound.rows - rows0, 5);
});

test('the summary adds gestures up a screen, layout and zoom, with the 95th percentile and the late share', () => {
  const s = setup();
  for (let g = 0; g < 2; g++) {
    const list = target();
    s.log.begin(list);
    s.frame(16);
    for (let i = 0; i < 19; i++) s.frame(16);
    s.frame(40);
    list.moving = false;
    s.frame(16); s.frame(16);
  }
  const grid = target({ screen: 'albums', layout: 'grid', zoom: 5 });
  s.log.begin(grid);
  s.frame(16); s.frame(16);
  // Another target begins: the grid's gesture ends there.
  const shelf = target({ screen: 'shelf', layout: 'list', zoom: 0 });
  s.log.begin(shelf);
  assert.equal(s.log.entries.length, 3);
  s.frame(16); s.frame(16); shelf.moving = false; s.frame(16); s.frame(16);
  const sum = s.log.summary();
  const songs = sum.find((x) => x.screen === 'library-songs');
  assert.equal(songs.scrolls, 2);
  assert.equal(songs.frames, 2 * 22);
  assert.equal(songs.late, 2);
  assert.equal(songs.latePct, Math.round((2 / 44) * 1000) / 10);
  assert.equal(songs.p95Ms, 17, '95 % of frames in the 16 ms bin');
  assert.equal(songs.worstMs, 40);
  assert.deepEqual(sum.map((x) => x.screen).sort(), ['albums', 'library-songs', 'shelf']);
  assert.equal(sum.find((x) => x.screen === 'albums').layout, 'grid');
});

test('p95 of a histogram, and an empty one', () => {
  const h = new Uint32Array(128);
  h[16] = 90; h[33] = 10;
  assert.equal(p95(h, 100), 34);
  assert.equal(p95(new Uint32Array(128), 0), 0);
});

test('a list\'s screen is one of the fixed names, from its kind, never its own name', () => {
  assert.equal(screenOf({ isHomeV2: true }), 'home');
  assert.equal(screenOf({ isLibraryV2: true, libraryChip: 'albums' }), 'library-albums');
  assert.equal(screenOf({ optsKey: 'tracks:all' }), 'songs');
  assert.equal(screenOf({ optsKey: 'tracks:album@Some Album Name' }), 'album');
  assert.equal(screenOf({ optsKey: 'cat:albums' }), 'albums');
  assert.equal(screenOf({ optsKey: 'cat:albumArtists' }), 'artists');
  assert.equal(screenOf({ optsKey: 'tracks:playlist@x' }), 'playlist');
  assert.equal(screenOf({ optsKey: 'whatever:Private Name' }), 'other');
  assert.equal(screenOf(null), 'other');
  for (const src of [{ isLibraryV2: true, libraryChip: 'My Secret' }, { optsKey: 'tracks:Secret' }]) assert.ok(SCREENS.includes(screenOf(src)));
});

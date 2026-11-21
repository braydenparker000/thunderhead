// Music's layout height with the keyboard (frontend/music/src/ui/layout-height.js), a scene turned back
// before it moved (view/scene.js) and the recorder's missing play/pause rule (ui/feel-log.js), as plain
// logic in Node. The numbers are the owner's phone's: full height 731, keyboard up 424.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LayoutHeight, CLOSE_MS, TALL_MS } from '../frontend/music/src/ui/layout-height.js';
import { SceneController } from '../frontend/music/src/view/scene.js';
import { missingButton, FULL_PX } from '../frontend/music/src/ui/feel-log.js';

test('opening the keyboard is one relayout: the step above the full height is not taken', () => {
  const h = new LayoutHeight(731, 390);
  const seen = [731, 759, 424].map((inner, i) => h.next(inner, 390, true, i * 50));
  assert.deepEqual(seen, [731, 731, 424]);
});

test('a field let go lays out at the full height at once, through the keyboard closing', () => {
  const h = new LayoutHeight(731, 390);
  h.next(424, 390, true, 0);
  assert.equal(h.leave(100), 731, 'the full height, not the keyboard-shrunk one');
  assert.equal(h.next(424, 390, false, 150), 731, 'a step down while it closes is not taken');
  assert.equal(h.next(600, 390, false, 200), 731);
  assert.equal(h.next(731, 390, false, 300), 731);
  // A real shrink later counts.
  assert.equal(h.next(700, 390, false, 300 + CLOSE_MS), 700);
});

test('a step above the full height while the keyboard closes is not taken (the player laid out at 759 of 731)', () => {
  const h = new LayoutHeight(731, 390);
  h.next(424, 390, true, 0);
  h.leave(100);
  // Home's toolbar moves while the keyboard closes: its viewport reads 759 for a moment.
  assert.equal(h.next(759, 390, false, 150), 731, 'the full height, not 759');
  assert.equal(h.next(731, 390, false, 400), 731);
  assert.equal(h.full, 731, 'the full height is still 731');
  assert.equal(h.next(731, 390, false, 100 + CLOSE_MS + TALL_MS), 731);
});

test('a taller window that lasts past the closing time is taken', () => {
  const h = new LayoutHeight(731, 390);
  h.leave(0);
  assert.equal(h.next(759, 390, false, 500), 731, 'held while the keyboard closes');
  assert.equal(h.next(759, 390, false, CLOSE_MS + TALL_MS - 1), 731, 'and just after');
  assert.equal(h.next(759, 390, false, CLOSE_MS + TALL_MS), 759, 'still there: taken');
  assert.equal(h.full, 759);
});

test('after the closing time the window height holds; a turn of the phone starts over', () => {
  const h = new LayoutHeight(731, 390);
  h.leave(0);
  assert.equal(h.next(500, 390, false, CLOSE_MS + 1), 500);
  assert.equal(h.next(390, 731, false, CLOSE_MS + 2), 390, 'a new width: its height');
  assert.equal(h.next(370, 731, true, CLOSE_MS + 3), 370);
});

test('a scene turned back before its first frame ends at once (it took 1 s showing both buttons)', () => {
  const root = { children: [], width: 100, height: 100, left: 0, top: 0, right: 100, bottom: 100, forceLayoutTree() {}, requestLayout() {}, measure() {}, layout() {}, ctx: { animate() {} } };
  const sc = new SceneController(root);
  sc.go('scene_playing', { duration: 0.25 });
  assert.ok(sc.running, 'the change runs');
  sc.go('defaultScene', { duration: 0.25 });
  assert.equal(sc.running, null, 'turned back at ratio 0: nothing left to animate');
  assert.equal(sc.scene, 'defaultScene');
  // Turned back part way, it still animates the part it moved, over the time it took to get there:
  // 0.4 of the way is 30 ms into a 250 ms decelerating change (it was 0.4 × 250 = 100 ms before, longer
  // than the way there).
  sc.go('scene_playing', { duration: 0.25 });
  sc.ratio = 0.4;
  sc.go('defaultScene', { duration: 0.25 });
  assert.ok(sc.running && Math.abs(sc.running.duration - 30) < 1, `back over 30 ms (${sc.running?.duration})`);
});

test('quick play and pause taps: each turn back takes at most the time travelled, and it ends soon after the last', () => {
  // The owner's taps, 150–500 ms apart (a 1436 ms defaultscene>scene_playing where 321 ms is normal).
  const TAPS = [0, 193, 381, 548, 716, 880, 995], FULL = 321, FRAME = 16;
  const root = { children: [], width: 100, height: 100, left: 0, top: 0, right: 100, bottom: 100, forceLayoutTree() {}, requestLayout() {}, measure() {}, layout() {}, ctx: { animate() {} } };
  const sc = new SceneController(root);
  let legStart = 0, ended = null, now = 0;
  const legs = [];
  for (let k = 0; ended === null && k < 1000; k++, now += FRAME) {
    const tap = TAPS.findIndex((t) => t > now - FRAME && t <= now);
    if (tap >= 0) {
      const ran = now - legStart, before = sc.running;
      sc.go(tap % 2 ? 'defaultScene' : 'scene_playing', { duration: FULL / 1000 });
      if (tap > 0 && before && sc.running) legs.push({ ran, planned: sc.running.duration });
      legStart = now;
    }
    if (sc.running && !sc.tick(now)) ended = now;
  }
  assert.ok(legs.length >= 5, `the taps turned the change back (${legs.length} times)`);
  for (const l of legs) {
    assert.ok(l.planned <= l.ran + FRAME, `a turn back takes at most the time travelled (${Math.round(l.planned)} ms after ${l.ran} ms)`);
    assert.ok(l.planned <= FULL, 'never longer than the whole change');
  }
  assert.ok(ended !== null && ended <= TAPS.at(-1) + FULL, `at rest by ${TAPS.at(-1) + FULL} ms (${ended})`);
  assert.equal(sc.scene, 'scene_playing', 'where the last tap goes');
});

test('the recorder notes a player scene with neither button at full size', () => {
  const big = { id: 'pause', visible: true, w: 80, h: 25 }, small = { id: 'play', visible: true, w: 38, h: 38 }, hidden = { id: 'pause', visible: false, w: 80, h: 25 };
  assert.equal(missingButton([small, hidden], 'nav_main', 'scene_playing'), true);
  assert.equal(missingButton([{ ...small, visible: false }, hidden], 'nav_main', 'defaultScene'), true);
  assert.equal(missingButton([small, big], 'nav_main', 'scene_playing'), false);
  assert.equal(missingButton([small, hidden], 'nav_search', 'scene_search'), false, 'search has no player buttons');
  assert.equal(missingButton([small, hidden], 'nav_main', 'scene_vis'), false, 'full-screen visualisation hides them');
  assert.ok(FULL_PX > 49 && FULL_PX < 56);
});

test('the recorder notes what ran during a transition: relayouts, resizes and a song starting', async () => {
  const { watchFrameWork } = await import('../frontend/music/src/ui/frame-work.js');
  const subs = [];
  let laid = 0;
  const ctx = { layoutNow() { laid++; }, bus: { subscribe: (bus, fn) => subs.push(fn) } };
  const log = { ctx, running: new Map(), runs: [], t0: 0 };
  watchFrameWork(log);
  ctx.layoutNow();
  assert.equal(laid, 1, 'the layout still runs');
  const run = { start: performance.now() };
  log.running.set('scene', run);
  ctx.layoutNow();
  ctx.layoutNow();
  for (const fn of subs) fn('msg_player_track_changed', null, {});
  for (const fn of subs) fn('msg_player_playing_state_changed', null, {});
  assert.equal(laid, 3);
  assert.equal(run.work.relayouts, 2, 'two relayouts while it ran (none counted before it)');
  assert.ok(run.work.songAt >= 0, 'a song started during it');
});

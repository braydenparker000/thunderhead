// Music's layout height with the keyboard (frontend/music/src/ui/layout-height.js), a scene turned back
// before it moved (view/scene.js) and the recorder's missing play/pause rule (ui/feel-log.js), as plain
// logic in Node. The numbers are the owner's phone's: full height 731, keyboard up 424.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LayoutHeight, CLOSE_MS } from '../frontend/music/src/ui/layout-height.js';
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
  // Turned back part way, it still animates the part it moved.
  sc.go('scene_playing', { duration: 0.25 });
  sc.ratio = 0.4;
  sc.go('defaultScene', { duration: 0.25 });
  assert.ok(sc.running && Math.abs(sc.running.duration - 100) < 1, 'back over 0.4 of 250 ms');
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

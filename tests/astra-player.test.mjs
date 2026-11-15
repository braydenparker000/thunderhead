// The player's pure rules: what a finger on the picture is doing (player/gestures.js), when a progress
// report may overwrite the saved place, and the next episode's sources through the owner's filters
// (app/playing.js). The same player is driven in a real browser by astra-player-browser.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Gesture, classifyDrag, HOLD_MS } from '../frontend/astra/src/player/gestures.js';
import { keepProgress, filterSources } from '../frontend/astra/src/app/playing.js';

const screen = { w: 390, h: 844 }; // portrait: the vertical threshold is 6 % of the height, 50 px
const down = (g, o = {}) => g.down({ id: 1, x: 300, y: 400, ...screen, gestures: true, canHold: true, ...o });

test('a press that does not move is a hold once the timer runs out, and its lift ends the hold', () => {
  const g = new Gesture();
  assert.deepEqual(down(g), { holdIn: HOLD_MS });
  assert.deepEqual(g.move({ id: 1, x: 303, y: 404 }), [], 'within the 8 px slop');
  assert.deepEqual(g.hold(), { type: 'hold' });
  assert.deepEqual(g.up({ id: 1 }), { type: 'end', kind: 'hold', cancelled: false });
  assert.equal(g.active, false);
});

test('a second finger is ignored: the first finger’s lift still ends the hold it started', () => {
  const g = new Gesture();
  down(g);
  g.hold();
  assert.equal(g.down({ id: 2, x: 100, y: 300, ...screen }), null, 'the second finger starts nothing');
  assert.equal(g.up({ id: 2 }), null, 'and its lift ends nothing');
  assert.equal(g.kind, 'hold');
  assert.deepEqual(g.up({ id: 1 }), { type: 'end', kind: 'hold', cancelled: false });
});

test('a slow swipe is never a hold: moving past the slop rules the hold out before the threshold is met', () => {
  const g = new Gesture();
  down(g);
  for (let y = 398; y >= 370; y -= 2) assert.deepEqual(g.move({ id: 1, x: 300, y }), [], 'still under the 50 px vertical threshold');
  assert.equal(g.hold(), null, 'the hold timer, firing now, finds a moving finger');
  assert.deepEqual(g.move({ id: 1, x: 300, y: 340 }), [{ type: 'drag', kind: 'volume' }, { type: 'level', kind: 'volume', dy: -60 }]);
  assert.deepEqual(g.up({ id: 1 }), { type: 'end', kind: 'volume', cancelled: false });
});

test('a release after movement is not a tap, even when the drag was never classified', () => {
  assert.equal(classifyDrag({ dx: 300, dy: 330, startX: 100, startY: 300, width: 844, height: 390 }), null, 'between 45° and 50° nothing is decided');
  const g = new Gesture();
  g.down({ id: 1, x: 100, y: 300, width: 844, w: 844, h: 390 });
  assert.deepEqual(g.move({ id: 1, x: 400, y: 630 }), []);
  assert.equal(g.up({ id: 1 }), null, 'a diagonal drag, then a lift: nothing');
  const off = new Gesture(); // gestures turned off in Settings: movement still rules out the tap
  off.down({ id: 1, x: 100, y: 100, ...screen, gestures: false });
  off.move({ id: 1, x: 160, y: 100 });
  assert.equal(off.up({ id: 1 }), null);
  const tap = new Gesture();
  tap.down({ id: 1, x: 100, y: 100, ...screen, gestures: false });
  tap.move({ id: 1, x: 104, y: 103 });
  assert.deepEqual(tap.up({ id: 1 }), { type: 'tap', x: 100, w: 390 }, 'a wobble within the slop is still a tap');
});

test('every way out ends what was going on: a cancel ends a hold or a seek, and a cancelled press is no tap', () => {
  const g = new Gesture();
  down(g); g.hold();
  assert.deepEqual(g.cancel(1), { type: 'end', kind: 'hold', cancelled: true });
  down(g);
  assert.deepEqual(g.move({ id: 1, x: 340, y: 400 }).map((a) => a.type), ['drag', 'seek']);
  assert.deepEqual(g.cancel(), { type: 'end', kind: 'seek', cancelled: true }, 'no id: whatever is going on (a menu, the lock, closing)');
  down(g);
  assert.equal(g.cancel(1), null);
  assert.equal(g.cancel(), null, 'nothing going on: nothing to end');
});

test('a paused film has no hold, and a drag from the top or bottom edge does nothing', () => {
  const g = new Gesture();
  assert.deepEqual(down(g, { canHold: false }), { holdIn: 0 });
  assert.equal(g.hold(), null);
  g.cancel();
  g.down({ id: 1, x: 300, y: 30, ...screen });
  assert.deepEqual(g.move({ id: 1, x: 300, y: 120 }), [], 'an edge swipe (the system’s) is "none": no level bar');
  assert.equal(g.up({ id: 1 }), null);
});

test('progress before a resume point is reached is not saved; after it, or a minute in, it is', () => {
  const load = { startTime: 600 };
  assert.equal(keepProgress(0.4, load), false, 'the clock at 0 while the resume loads');
  assert.equal(keepProgress(12, load), false);
  assert.equal(keepProgress(597, load), true, 'the keyframe just before the resume point counts as there');
  assert.equal(keepProgress(30, load), true, 'once there, a seek back is the viewer’s and is saved');
  assert.equal(keepProgress(70, { startTime: 600 }), true, 'a start that was ignored: after a minute the place is real');
  assert.equal(keepProgress(3, { startTime: 0 }), true, 'from the start, everything counts');
  assert.equal(keepProgress(3, undefined), true);
});

test('the next episode’s sources go through the owner’s filters, per add-on, and the hidden are counted', () => {
  const src = (addonUrl, title, n) => ({ id: `${addonUrl}#${n}`, addonUrl, label: title, stream: { name: 'X', title, url: `https://cdn.example/${n}.mkv` } });
  const all = [src('a', '1080p x264 1.4 GB', 1), src('a', '720p 600 MB', 2), src('b', '2160p HEVC 9 GB', 3), src('b', '1080p 900 MB', 4)];
  const none = filterSources(all, null);
  assert.deepEqual(none.sources, all, 'no filters: all, in the add-ons’ order');
  assert.deepEqual(none.hidden, []);
  const small = filterSources(all, { small: true, maxMb: 1500, res: [], codec: [] });
  assert.deepEqual(small.sources.map((s) => s.id), ['a#2', 'a#1', 'b#4'], 'smallest first within each add-on');
  assert.deepEqual(small.hidden.map((s) => s.id), ['b#3']);
  assert.deepEqual(filterSources(all, { res: ['1080'] }).sources.map((s) => s.id), ['a#1', 'b#4']);
  assert.deepEqual(filterSources(all, null, 1000).sources.map((s) => s.id), ['a#2', 'b#4'], 'the Thunderhead’s size limit too');
});

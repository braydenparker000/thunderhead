// The player's pure rules: what a finger on the picture is doing (player/gestures.js), when a progress
// report may overwrite the saved place, and the next episode's sources through the owner's filters
// (app/playing.js), and the newer features' rules (player/rules.js: speed, sleep timer, A–B repeat,
// zoom, chapters, subtitle search, stills, the source line). The same player is driven in a real browser
// by astra-player-browser.test.mjs and astra-features-browser.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Gesture, classifyDrag, HOLD_MS } from '../frontend/astra/src/player/gestures.js';
import { keepProgress, filterSources } from '../frontend/astra/src/app/playing.js';
import * as R from '../frontend/astra/src/player/rules.js';
import { SPEEDS } from '../frontend/astra/src/player/prefs.js';

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

// ——— The newer features' rules (player/rules.js) and the gesture machine's pinch and pan ———

test('a second finger before the first has moved or held starts a pinch, which rules out the hold', () => {
  const g = new Gesture();
  assert.deepEqual(down(g, { zoom: true }), { holdIn: HOLD_MS });
  assert.deepEqual(g.down({ id: 2, x: 400, y: 400, ...screen }), { holdIn: 0, pinch: true });
  assert.equal(g.hold(), null, 'the hold timer, firing now, finds a pinch');
  const [a] = g.move({ id: 2, x: 500, y: 400 });
  assert.equal(a.type, 'pinch');
  assert.equal(a.ratio, 2, 'the fingers 100 px apart, now 200');
  assert.deepEqual(a.focus, { x: 350, y: 400 });
  assert.deepEqual(g.down({ id: 3, x: 10, y: 10, ...screen }), null, 'a third finger is ignored');
  assert.deepEqual(g.up({ id: 1 }), { type: 'end', kind: 'pinch', cancelled: false }, 'either lift ends the pinch');
  assert.equal(g.active, true, 'the other finger is still down');
  assert.deepEqual(g.move({ id: 2, x: 200, y: 300 }), [], 'and does nothing');
  assert.equal(g.up({ id: 2 }), null, 'nor does its lift: no tap, no seek');
  assert.equal(g.active, false);
});

test('once a hold or a drag is under way, or with zoom off (locked), a second finger is still ignored', () => {
  const held = new Gesture();
  down(held, { zoom: true }); held.hold();
  assert.equal(held.down({ id: 2, x: 100, y: 300, ...screen }), null);
  assert.deepEqual(held.up({ id: 1 }), { type: 'end', kind: 'hold', cancelled: false });
  const dragging = new Gesture();
  down(dragging, { zoom: true });
  dragging.move({ id: 1, x: 340, y: 400 });
  assert.equal(dragging.down({ id: 2, x: 100, y: 300, ...screen }), null, 'past the slop: too late to pinch');
  const locked = new Gesture();
  down(locked, { zoom: false });
  assert.equal(locked.down({ id: 2, x: 100, y: 300, ...screen }), null);
  const cancelled = new Gesture();
  down(cancelled, { zoom: true }); cancelled.down({ id: 2, x: 400, y: 400, ...screen });
  assert.deepEqual(cancelled.cancel(), { type: 'end', kind: 'pinch', cancelled: true }, 'a menu or the lock ends a pinch outright');
  assert.equal(cancelled.active, false);
});

test('zoomed, a one-finger drag pans the picture; a tap is still a tap (double tap keeps seeking)', () => {
  const g = new Gesture();
  down(g, { zoomed: true, zoom: true });
  assert.deepEqual(g.move({ id: 1, x: 340, y: 380 }), [{ type: 'drag', kind: 'pan' }, { type: 'pan', dx: 40, dy: -20 }]);
  assert.deepEqual(g.up({ id: 1 }), { type: 'end', kind: 'pan', cancelled: false });
  down(g, { zoomed: true });
  assert.deepEqual(g.up({ id: 1 }), { type: 'tap', x: 300, w: 390 });
});

test('zoom stays between 1x and 4x, keeps the point under the fingers, and never shows past the picture’s edge', () => {
  const W = 800, H = 400;
  assert.deepEqual(R.clampPan({ x: 500, y: -500 }, 2, W, H), { x: 400, y: -200 }, 'at 2x an edge may move half the box');
  assert.deepEqual(R.clampPan({ x: 30, y: 30 }, 1, W, H), { x: 0, y: 0 }, 'at 1x nothing moves');
  assert.equal(R.pinchZoom({ scale: 1, x: 0, y: 0 }, 9, { x: 0, y: 0 }, W, H).scale, R.MAX_ZOOM);
  assert.equal(R.pinchZoom({ scale: 2, x: 0, y: 0 }, 0.2, { x: 0, y: 0 }, W, H).scale, 1);
  const z = R.pinchZoom({ scale: 1, x: 0, y: 0 }, 2, { x: 100, y: 50 }, W, H);
  assert.deepEqual(z, { scale: 2, x: -100, y: -50 }, 'the point 100 px right of centre stays where it was');
});

test('speeds: the menu’s seven, and a damaged saved speed becomes the nearest', () => {
  assert.deepEqual(SPEEDS, [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]);
  assert.equal(R.normalSpeed(1.25), 1.25);
  assert.equal(R.normalSpeed(16), 2);
  assert.equal(R.normalSpeed(1.3), 1.25);
  assert.equal(R.normalSpeed(NaN), 1);
  assert.equal(R.normalSpeed(-1), 1);
});

test('the sleep timer counts the wall clock; "end of episode" the film’s time left at its speed', () => {
  assert.equal(R.sleepTimer(0, 1000), null);
  const t = R.sleepTimer(15, 1000);
  assert.deepEqual(t, { minutes: 15, until: 901000 });
  assert.equal(R.sleepLeft(t, { now: 1000 }), 900);
  assert.equal(R.sleepLeft(t, { now: 2_000_000 }), 0, 'never below zero');
  const e = R.sleepTimer('episode', 0);
  assert.equal(R.sleepLeft(e, { now: 0, time: 1200, duration: 3000, rate: 1.5 }), 1200);
  assert.equal(R.sleepLeft(e, { now: 0, time: 10, duration: Infinity }), null, 'a live stream has no end');
  assert.equal(R.sleepLabel(900), '15:00');
  assert.equal(R.sleepLabel(0.2), '0:01', 'rounded up: it never reads 0:00 before it fires');
  assert.equal(R.sleepLabel(3600), '1:00:00');
});

test('A–B repeat: either order, at least a second, and a seek outside the part leaves it', () => {
  assert.deepEqual(R.repeatRange(10, 25), { start: 10, end: 25 });
  assert.deepEqual(R.repeatRange(25, 10), { start: 10, end: 25 });
  assert.equal(R.repeatRange(10, 10.5), null);
  assert.equal(R.outsideRange(12, { start: 10, end: 25 }), false);
  assert.equal(R.outsideRange(25.3, { start: 10, end: 25 }), false, 'half a second of slack');
  assert.equal(R.outsideRange(40, { start: 10, end: 25 }), true);
  assert.equal(R.outsideRange(40, null), false);
});

test('chapters: the one at a time, and ticks no closer than 6 px', () => {
  const ch = [{ start: 0, end: 100, title: 'One' }, { start: 100, end: 102, title: 'Two' }, { start: 102, end: 600, title: 'Three' }];
  assert.equal(R.chapterAt(ch, 101).title, 'Two');
  assert.equal(R.chapterAt(ch, 700), null);
  assert.equal(R.chapterAt(null, 5), null);
  assert.deepEqual(R.chapterTicks(ch, 600, 600), [100 / 600], 'Two’s end is 2 px after its start: dropped');
  assert.deepEqual(R.chapterTicks(ch, 600, 0), []);
  assert.deepEqual(R.chapterTicks([], 600, 600), []);
});

test('finding a subtitle line ignores case and accents, keeps time order, and draws at most the limit', () => {
  const cue = (start, text) => ({ start, end: start + 2, spans: [{ text }] });
  const cues = [cue(30, 'Où est la gare ?'), cue(10, 'Bonjour'), cue(50, 'La GARE est là'), cue(70, '')];
  assert.deepEqual(R.findLines(cues, 'gare'), { rows: [{ start: 30, text: 'Où est la gare ?' }, { start: 50, text: 'La GARE est là' }], total: 2 });
  assert.equal(R.findLines(cues, 'ou est').total, 1, 'accents ignored');
  assert.equal(R.findLines(cues, '').total, 3, 'empty: every line with text');
  const many = Array.from({ length: 1500 }, (_, i) => cue(i, 'line ' + i));
  const found = R.findLines(many, 'line', 200);
  assert.equal(found.rows.length, 200);
  assert.equal(found.total, 1500);
});

test('a still is named after the title and the time; frame steps use the frame rate or 24', () => {
  const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  assert.equal(R.stillName('Invented: a film?', 125, clock), 'Invented a film 2.05.png');
  assert.equal(R.stillName('', 0, clock), 'Astra 0.00.png');
  assert.equal(R.frameStep(10, 1, 25), 10.04);
  assert.equal(R.frameStep(10, -1, undefined), 10 - 1 / 24);
  assert.equal(R.frameStep(0, -1, 24), 0);
});

test('the source line names the add-on once', () => {
  assert.equal(R.viaName('Example Example 1080p'), 'Example 1080p');
  assert.equal(R.viaName('Example · Example\n4K HDR'), 'Example 4K HDR');
  assert.equal(R.viaName('Example Addon [RD] Example Addon 1080p'), '[RD] Example Addon 1080p');
  assert.equal(R.viaName('Example 1080p WEB'), 'Example 1080p WEB', 'nothing twice: as it was');
  assert.equal(R.viaName(''), '');
});

// ——— The wiring (player/sound-menu.js, app/skip.js, screens/streams.js) ———
import { mergeSkipSegments } from '../frontend/astra/src/app/skip.js';
import { skipEpisode } from '../frontend/astra/src/app/playing.js';
import { sourceName } from '../frontend/astra/src/screens/streams.js';
import { nudgeDelay, delayLabel, plainWhy } from '../frontend/astra/src/player/sound-menu.js';

test('skip segments merge by kind: the lookup wins, a recap only from the lookup, empty ones dropped', () => {
  const sound = [{ type: 'intro', start: 100, end: 190 }, { type: 'outro', start: 1300, end: 1390 }, { type: 'recap', start: 0, end: 40 }, { type: 'credits', start: 5, end: 5 }];
  const lookup = [{ type: 'intro', start: 95, end: 185 }, { type: 'recap', start: 0, end: 50 }];
  assert.deepEqual(mergeSkipSegments(sound, lookup), [{ type: 'recap', start: 0, end: 50 }, { type: 'intro', start: 95, end: 185 }, { type: 'outro', start: 1300, end: 1390 }]);
  assert.deepEqual(mergeSkipSegments(sound.slice(2)), [], 'without a lookup, no recap');
  assert.deepEqual(mergeSkipSegments(null, null), []);
});

test('skip times are looked for in episodes only', () => {
  const meta = { type: 'series', id: 'kitsu:1' };
  assert.deepEqual(skipEpisode(meta, { id: 'kitsu:1:2', season: 1, episode: 2 }), { series: { type: 'series', id: 'kitsu:1' }, video: 'kitsu:1:2', season: 1, episode: 2 });
  assert.equal(skipEpisode({ type: 'movie', id: 'tt1' }, null), null);
  assert.equal(skipEpisode({ type: 'movie', id: 'tt1' }, { id: 'tt1' }), null);
});

test('a source is named once when the stream already starts with its add-on\'s name', () => {
  assert.equal(sourceName('Example', 'Example 1080p'), 'Example 1080p');
  assert.equal(sourceName('Example', 'example\n4K', ' · '), 'example 4K');
  assert.equal(sourceName('Example', 'Examples 4K', ' · '), 'Example · Examples 4K', 'a longer word is not the add-on\'s name');
  assert.equal(sourceName('Example', '1080p', ' · '), 'Example · 1080p');
  assert.equal(sourceName('Example', ''), 'Example');
  assert.equal(R.viaName(sourceName('Example', 'Example · Example 4K')), 'Example 4K', 'the player\'s viaName still tidies a name repeated further in');
});

test('the sound delay steps by 0.05 s within its range and reads as earlier or later', () => {
  assert.equal(nudgeDelay(0, -0.05), -0.05);
  assert.equal(nudgeDelay(0, -0.05, 0), 0, 'no earlier sound without the engine');
  assert.equal(nudgeDelay(0.95, 0.05), 1);
  assert.equal(nudgeDelay(1, 0.05), 1);
  assert.equal(nudgeDelay(-1, -0.05), -1);
  assert.equal(nudgeDelay(0.1 + 0.2, 0.05), 0.35, 'kept on the grid');
  assert.deepEqual([delayLabel(0), delayLabel(0.25), delayLabel(-0.5)], ['0.00 s', '+0.25 s', '−0.50 s']);
  assert.match(plainWhy('The software decoder plays the sound through its own audio graph, not the video element.'), /cannot change its sound yet/);
  assert.match(plainWhy('This film comes straight from its host, which does not let the page read it.'), /does not let Astra change its sound/);
});

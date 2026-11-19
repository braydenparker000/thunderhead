// The feel report's "what froze" (ui/feel-frames.js): a long frame is kept scrubbed (a script by its file's name
// when it is Astra's own, else "other"; a function's name only in Astra's own code; the kind of call; numbers),
// kept with the runs it fell in, and printed for the ten worst gaps after the table.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scriptFile, callKind, frameOf, keep, frozeText, KEEP } from '../frontend/astra/src/ui/feel-frames.js';
import { reportText } from '../frontend/astra/src/ui/feel-log.js';

const ROOT = 'https://phone.example/astra/';
const loaf = (over = {}) => ({
  entryType: 'long-animation-frame', startTime: 1000, duration: 1180, blockingDuration: 1130, styleAndLayoutStart: 2140,
  scripts: [
    { sourceURL: 'https://phone.example/astra/src/app/app.js?v=12#top', sourceFunctionName: 'loadPlayer', invokerType: 'resolve-promise', invoker: 'Window.fetch.then', duration: 300, forcedStyleAndLayoutDuration: 0 },
    { sourceURL: 'https://phone.example/astra/src/player/player-screen.js', sourceFunctionName: '', invokerType: 'module-script', invoker: 'https://phone.example/astra/src/player/player-screen.js', duration: 610, forcedStyleAndLayoutDuration: 0 },
    { sourceURL: 'chrome-extension://abcdef/content.js', sourceFunctionName: 'secretAddonThing', invokerType: 'event-listener', invoker: 'VIDEO[src="blob:https://phone.example/9f1c"].ontimeupdate', duration: 40, forcedStyleAndLayoutDuration: 0 },
    { sourceURL: 'https://phone.example/astra/src/screens/stream-card.js', sourceFunctionName: 'onclick', invokerType: 'event-listener', invoker: 'BUTTON.onclick', duration: 12, forcedStyleAndLayoutDuration: 9 },
  ],
  ...over,
});

test('a script is named by its file name when it is Astra\'s own, else "other"; never an address or a query', () => {
  assert.equal(scriptFile('https://phone.example/astra/src/player/player-screen.js?v=3#x', ROOT), 'player-screen.js');
  assert.equal(scriptFile('https://phone.example/astra/vendor/mediabunny.js', ROOT), 'mediabunny.js');
  assert.equal(scriptFile('https://addon.example/astra/src/app.js', ROOT), 'other', 'another host');
  assert.equal(scriptFile('chrome-extension://abcdef/content.js', ROOT), 'other');
  assert.equal(scriptFile('blob:https://phone.example/1234', ROOT), 'other');
  assert.equal(scriptFile('https://phone.example/astra/src/app/app.js/../../../x?film=Some%20Title', ROOT), 'other', 'not a file name');
  assert.equal(scriptFile('', ROOT), 'other');
  assert.equal(scriptFile('https://phone.example/other/thing.js', ROOT), 'other', 'outside Astra');
});

test('the kind of call is a fixed word: an event listener says only its event', () => {
  assert.equal(callKind('user-callback', 'TimerHandler:setTimeout'), 'timer');
  assert.equal(callKind('user-callback', 'FrameRequestCallback'), 'frame');
  assert.equal(callKind('user-callback', 'IdleRequestCallback'), 'idle');
  assert.equal(callKind('user-callback', 'ResizeObserverCallback'), 'observer');
  assert.equal(callKind('resolve-promise', 'Window.fetch.then'), 'promise');
  assert.equal(callKind('module-script', 'https://phone.example/astra/src/main.js'), 'module');
  assert.equal(callKind('event-listener', 'VIDEO[src="blob:https://phone.example/9f1c"].ontimeupdate'), 'event timeupdate');
  assert.equal(callKind('event-listener', 'IMG#Some Title.load'), 'event');
  assert.equal(callKind('something-new', 'x'), 'other');
});

test('a frame is kept as numbers and fixed names: its top three scripts, longest first', () => {
  const f = frameOf(loaf(), ROOT);
  assert.deepEqual({ ms: f.ms, blocked: f.blocked, style: f.style }, { ms: 1180, blocked: 1130, style: 40 });
  assert.deepEqual(f.scripts.map((s) => [s.file, s.fn, s.kind, s.ms]), [['player-screen.js', '', 'module', 610], ['app.js', 'loadPlayer', 'promise', 300], ['other', '', 'event timeupdate', 40]]);
  assert.doesNotMatch(JSON.stringify(f), /https?:|blob:|chrome-extension|secretAddonThing|\?v=|9f1c/);
  const task = frameOf({ entryType: 'longtask', startTime: 5, duration: 120 }, ROOT);
  assert.deepEqual([task.ms, task.blocked, task.style, task.scripts.length, task.task], [120, 70, null, 0, true]);
});

test('a run keeps its longest frames; the report prints what froze for the ten worst gaps', () => {
  const run = {};
  for (const [at, duration] of [[0, 60], [100, 400], [600, 90], [100, 400]]) keep(run, frameOf(loaf({ startTime: at, duration, blockingDuration: duration - 50, styleAndLayoutStart: 0 }), ROOT));
  assert.deepEqual(run.froze.map((f) => f.ms), [400, 90].slice(0, KEEP), 'the longest, once each');
  const runs = Array.from({ length: 12 }, (_, i) => ({ name: `rise:row-${i}`, ms: 300, frames: 10, worstGap: 60 + i * 10, interrupted: false, froze: [] }));
  runs.push({ name: 'player:open', ms: 1342, frames: 3, worstGap: 1107, interrupted: false, froze: [frameOf(loaf(), ROOT)] });
  const lines = frozeText(runs, 'long-animation-frame');
  assert.equal(lines.filter((l) => /^\S+ gap \d+$/.test(l)).length, 10, 'ten worst gaps');
  assert.equal(lines[1], 'player:open gap 1107');
  assert.deepEqual(lines.slice(2, 6), ['  frame 1180 ms, blocked 1130, style and layout 40', '    player-screen.js module 610', '    app.js loadPlayer promise 300', '    other event timeupdate 40']);
  assert.ok(!lines.includes('rise:row-0 gap 60') && lines.includes('rise:row-11 gap 170'));
  assert.match(lines.join('\n'), /rise:row-11 gap 170\n {2}no long frame seen/);
  assert.deepEqual(frozeText(runs, 'none'), ['what froze: not known (this browser does not report long frames)']);
  // In the report, after the table and before the last runs; only numbers and fixed names.
  const text = reportText(runs, { motion: 'full' }, null, 'long-animation-frame');
  assert.ok(text.indexOf('what froze') > text.indexOf('player:open ') && text.indexOf('what froze') < text.indexOf('last runs'));
  assert.doesNotMatch(text, /https?:|blob:|chrome-extension|secretAddonThing/);
});

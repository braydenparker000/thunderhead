// The shell's feel report (frontend/ui/feel/): a named movement is timed into a ring in memory (parts sharing a
// name and overlapping are one movement; a cancelled one is a cut); the report starts with the screen's refresh
// rate, then the table, then what froze for the ten worst gaps; a long frame is scrubbed to the site's own file
// names, functions, kinds of call and numbers, never an address, a query or anything else.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scriptFile, frameOf } from '../frontend/ui/feel/frames.js';
import { timed, feelEntries, clearFeelLog, cleanName, level } from '../frontend/ui/feel/log.js';
import { reportText } from '../frontend/ui/feel/report.js';

const ROOT = 'https://phone.example/';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('a script is named by its file when it is the site\'s own (not vendored), else "other"; never an address', () => {
  assert.equal(scriptFile('https://phone.example/apps/home/home.js?v=3#x', ROOT), 'home.js');
  assert.equal(scriptFile('https://phone.example/th/motion.js', ROOT), 'motion.js');
  assert.equal(scriptFile('https://phone.example/vendor/pdf.js', ROOT), 'other', 'vendored');
  assert.equal(scriptFile('https://phone.example/astra/vendor/hls.js', ROOT), 'other', 'vendored in an app');
  assert.equal(scriptFile('https://phone.example/assets/libmedia/384.avplayer.js', ROOT), 'other', 'a ported bundle');
  assert.equal(scriptFile('https://other.example/th/motion.js', ROOT), 'other', 'another host');
  assert.equal(scriptFile('chrome-extension://abc/content.js', ROOT), 'other');
  assert.equal(scriptFile('https://phone.example/?q=Dinner%20with%20Sam', ROOT), 'other', 'a query is not a file');
  assert.equal(scriptFile('', ROOT), 'unknown');
  const f = frameOf({ entryType: 'long-animation-frame', startTime: 10, duration: 140, blockingDuration: 90, styleAndLayoutStart: 120, scripts: [
    { sourceURL: 'https://phone.example/apps/home/home.js', sourceFunctionName: 'fan', invokerType: 'user-callback', invoker: 'FrameRequestCallback', duration: 61, forcedStyleAndLayoutDuration: 7 },
    { sourceURL: 'https://addon.example/x.js?token=abc', sourceFunctionName: 'secretThing', invokerType: 'event-listener', invoker: 'DIV#Dinner with Sam.onclick', duration: 30, forcedStyleAndLayoutDuration: 0 },
  ] }, ROOT);
  assert.deepEqual(f.scripts.map((s) => [s.file, s.fn, s.kind, s.ms]), [['home.js', 'fan', 'frame', 61], ['other', '', 'event click', 30]]);
  assert.doesNotMatch(JSON.stringify(f), /https?:|token|secretThing|Sam/);
});

test('timed: overlapping parts with one name are one movement; a cancelled part makes it a cut; nothing moved is not kept', async () => {
  clearFeelLog();
  const animation = (ms, cancel = false) => ({ finished: wait(ms).then(() => { if (cancel) throw new Error('cancelled'); }) });
  timed('ring:close', animation(30));
  timed('ring:close', animation(45));
  timed('Briefing open!', animation(25, true));
  timed('menu:open', Promise.resolve()); // already where it was sent
  const spring = { value: 0, whenResting: () => wait(25).then(() => { spring.value = 0.4; }) };
  timed('settings:in', spring, 1); // a finger took it at 0.4
  await wait(80);
  const got = feelEntries();
  assert.deepEqual(got.map((e) => [e.name, e.interrupted]).sort(), [['briefing-open-', true], ['ring:close', false], ['settings:in', true]]);
  assert.ok(got.find((e) => e.name === 'ring:close').ms >= 40, 'until its last part ends');
  assert.equal(cleanName('Island: Expand'), 'island:-expand');
  assert.equal(level(), 'full', 'no Motion setting and no document: full');
});

test('the report: the refresh rate first, then the table, then what froze for the ten worst gaps, then the last ones', () => {
  const froze = [frameOf({ entryType: 'long-animation-frame', startTime: 100, duration: 180, blockingDuration: 130, styleAndLayoutStart: 250, scripts: [
    { sourceURL: 'https://phone.example/th/chat/view.js', sourceFunctionName: 'render', invokerType: 'resolve-promise', invoker: 'Response.json.then', duration: 120, forcedStyleAndLayoutDuration: 0 },
  ] }, ROOT)];
  const list = [
    ...Array.from({ length: 12 }, (_, i) => ({ name: `toast`, ms: 300, frames: 18, worstGap: 55 + i, interrupted: false, froze: [] })),
    { name: 'ring:open', ms: 410, frames: 20, worstGap: 183, interrupted: false, froze },
    { name: 'menu:open', ms: 600, frames: 34, worstGap: 33, interrupted: true, froze: [] },
    { name: 'home:start', ms: 900, frames: 0, worstGap: 70, interrupted: false, froze: [] },
  ];
  const text = reportText(list, { motion: 'full', haptics: 'light' }, { hz: 90, ms: 11.1 }, 'long-animation-frame');
  const lines = text.split('\n');
  assert.equal(lines[0], 'Thunderhead feel report · screen 90 Hz (median frame 11.1 ms over a quiet second)');
  assert.equal(lines[1], 'motion full · haptics light');
  assert.match(text, /^ring:open\s+1\s+410\s+410\s+49\s+183\s+0$/m);
  assert.match(text, /^menu:open\s+1\s+600\s+600\s+57\s+33\s+1$/m);
  assert.match(text, /^home:start\s+1\s+900\s+900\s+-\s+70\s+0$/m, 'frames not counted: fps is -');
  const froze0 = lines.findIndex((l) => l.startsWith('what froze'));
  assert.ok(froze0 > lines.findIndex((l) => l.startsWith('ring:open ')) && froze0 < lines.indexOf('last movements (name, ms, frames, worst gap, cut)'));
  assert.deepEqual(lines.slice(froze0 + 1, froze0 + 4), ['ring:open gap 183', '  frame 180 ms, blocked 130, style and layout 30', '    view.js render promise 120']);
  assert.equal(lines.filter((l) => / gap \d+$/.test(l)).length, 10, 'the ten worst');
  assert.equal(reportText([], {}, null, 'none').split('\n')[0], 'Thunderhead feel report · screen not measured yet');
  assert.doesNotMatch(text, /https?:|phone\.example/);
});

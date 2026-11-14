// What home passes on of the editor's timings, without a browser (frontend/th/workshop/timings-core.js): only
// known fields of known kinds, so nothing else in the editor's storage can ride along; sent when there is a new
// one and the last send was ten minutes ago or more; the file says the build and the phone in a few words.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clean, cleanMarks, due, EVERY_MS, fileOf } from '../frontend/th/workshop/timings-core.js';

test('only timings of known kinds, with their known fields, are kept', () => {
  const stored = [
    { at: 1000, kind: 'open', ms: 8127.4, file: 'raf', quick: false, heard: 7001, decode: 1399, threads: 8, code: 40, wasm: 300, pool: 5000, waited: 5400, age: 12, px: 39814656, first: 41.6, kept: 1, name: 'DSCF0042.RAF' },
    { at: 2000, kind: 'save', ms: 57685, files: 1, px: 39806928, bytes: 7900000, kinds: 'JPEG', note: 'a caption', op0: 3.4, op11: 812.6, op16: 5, alt3: 402.2, alt0: -1, wid4: -2 },
    { at: 2500, kind: 'tune', ms: 61234, px: 968256, op0: 12.2, op5: 1893.4, alt5: 1410, wid5: 980.6, one5: -2, whole: 5641, chosen: 3200, floats: 7000, after: 5900, ways: 2112112110, apart: 250, apartc: 262, cpu1: 210, cpun: 890, fuse1: 240, fusen: 1010, threads: 8, why: 'line 12: a message' },
    { at: 2700, kind: 'check', ms: 6100.4, shots: 10, same: 9, diff: 32, offdb: 41, offgrid: 12, netdb: 3954, netndb: 3612, gpu: 'arm valhall', different: ['network'] },
    { at: 2800, kind: 'move', ms: 1432.7, frames: 81, worst: 48.2, slow: 2, busy: 1, where: 'the photo' },
    { at: 2900, kind: 'fine', ms: 2310, px: 1000000, parts: 96, part: 17.6, left: 1 },
    { at: 2950, kind: 'turn', ms: 1810.2, frames: 61, worst: 171.4, slow: 40, busy: 0, pct: 100, label: 'Exposure' },
    { at: 3000, kind: 'open', ms: 900, file: '../../secret' },
    { at: 4000, kind: 'spy', ms: 1 },
    { kind: 'open', ms: 5 },
    'words', null,
  ];
  assert.deepEqual(clean(stored), [
    { kind: 'open', at: 1000, ms: 8127, heard: 7001, decode: 1399, threads: 8, code: 40, wasm: 300, pool: 5000, waited: 5400, age: 12, px: 39814656, first: 42, kept: 1, file: 'raf', quick: false },
    { kind: 'save', at: 2000, ms: 57685, px: 39806928, files: 1, bytes: 7900000, op0: 3, op11: 813, alt0: -1, alt3: 402, wid4: -2, kinds: 'JPEG' },   // the network's passes timed apart: sixteen at most
    { kind: 'tune', at: 2500, ms: 61234, threads: 8, px: 968256, op0: 12, op5: 1893, alt5: 1410, wid5: 981, one5: -2, whole: 5641, chosen: 3200, floats: 7000, after: 5900, ways: 2112112110, apart: 250, apartc: 262, cpu1: 210, cpun: 890, fuse1: 240, fusen: 1010 },   // the engine test page's measure of the network: numbers only
    { kind: 'check', at: 2700, ms: 6100, shots: 10, same: 9, diff: 32, offdb: 41, offgrid: 12, netdb: 3954, netndb: 3612 },   // the picture check: numbers only (the chip's name and the pictures' names stay on the phone)
    { kind: 'move', at: 2800, ms: 1433, frames: 81, worst: 48, slow: 2, busy: 1 },   // a gesture on the photo: how its frames went, and whether a full-size view was being made
    { kind: 'fine', at: 2900, ms: 2310, px: 1000000, parts: 96, part: 18, left: 1 },   // a view made a part at a time: how many, the longest, whether it was left for a touch
    { kind: 'turn', at: 2950, ms: 1810, frames: 61, worst: 171, slow: 40, busy: 0, pct: 100 },   // a turn of the dial: how the page kept up, and how far in the photo was (never which control)
    { kind: 'open', at: 3000, ms: 900 },
  ]);
  assert.deepEqual(clean('not a list'), []);
  assert.equal(clean(Array.from({ length: 300 }, (_, i) => ({ at: i + 1, kind: 'full', ms: 1 }))).length, 120);
});

test('sent when there is a new timing, at most once in ten minutes', () => {
  const list = [{ at: 5000 }];
  assert.equal(due({}, list, Date.UTC(2026, 10, 12)), true);
  assert.equal(due({}, [], 10_000), false);
  assert.equal(due({ last: 5000, when: 0 }, list, EVERY_MS * 2), false, 'nothing new');
  assert.equal(due({ last: 4000, when: 10_000 }, list, 10_000 + EVERY_MS - 1), false, 'too soon');
  assert.equal(due({ last: 4000, when: 10_000 }, list, 10_000 + EVERY_MS), true);
});

test('the file says the build and the phone in a few words, then the timings', () => {
  const file = JSON.parse(fileOf([{ kind: 'full', at: 1, ms: 2 }], { build: 'abc1234', agent: 'Browser/1 '.repeat(40), cores: 8, memory: 8 }));
  assert.deepEqual(Object.keys(file), ['v', 'build', 'agent', 'cores', 'memory', 'timings', 'marks']);
  assert.deepEqual([file.v, file.build, file.cores, file.memory, file.agent.length], [1, 'abc1234', 8, 8, 200]);
  assert.deepEqual(file.timings, [{ kind: 'full', at: 1, ms: 2 }]);
});

test('the compare page’s verdicts: where, how far in, which two and which was picked, and nothing else', () => {
  const stored = [
    { at: 1000.4, x: 0.123456, y: 0.5, zoom: 3, a: 'network', b: 'classic', picked: 'network', photo: 'DSCF0042.RAF' },
    { at: 2000, x: 0.2, y: 0.3, zoom: 2, a: 'camera', b: 'file', picked: 'file' },
    { at: 3000, x: 0.2, y: 0.3, zoom: 2, a: 'lightroom-export', b: 'classic', picked: 'classic' },
    { at: 4000, x: 'left', y: 0.3, zoom: 2, a: 'faster', b: 'classic', picked: 'classic' },
    null, 'words',
  ];
  assert.deepEqual(cleanMarks(stored), [
    { at: 1000, x: 0.1235, y: 0.5, zoom: 3, a: 'network', b: 'classic', picked: 'network' },
    { at: 2000, x: 0.2, y: 0.3, zoom: 2, a: 'camera', b: 'file', picked: 'file' },
  ]);
  assert.deepEqual(cleanMarks({}), []);
  assert.equal(cleanMarks(Array.from({ length: 300 }, (_, i) => ({ at: i + 1, x: 0, y: 0, zoom: 1, a: 'classic', b: 'faster', picked: 'faster' }))).length, 200);
  assert.deepEqual(JSON.parse(fileOf([], { build: 'abc1234', agent: 'x', cores: 8, memory: 8 }, cleanMarks(stored))).marks.length, 2);
});

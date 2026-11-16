// What Astra remembers per device about a route that failed (frontend/astra/src/engine/route-memory.js),
// the lab's plain words on Dolby and DTS sound (capabilities.js) and the phone settings hls.js and dash.js
// get (adaptive-tuning.js). The storage is a stand-in; nothing here needs a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as memory from '../frontend/astra/src/engine/route-memory.js';
import { surroundWords } from '../frontend/astra/src/engine/capabilities.js';
import { hlsTuning, dashTuning, saverCeiling, capNow } from '../frontend/astra/src/engine/adaptive-tuning.js';

const fakeStore = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), m }; };
const DAY = 864e5;

test('a picture that fell back routes later films to software only once software played it, for 30 days', () => {
  const s = fakeStore(), t0 = Date.UTC(2026, 0, 1);
  memory.rememberFallback('hvc1.2.4.L120.90', s, t0);
  assert.equal(memory.failedRoute('hvc1.2.4.L120.90', s, t0), false, 'not until the software decoder has played it');
  memory.confirmRoute('hvc1.2.4.L120.90', s, t0 + 1000);
  assert.equal(memory.failedRoute('hvc1.2.4.L120.90', s, t0 + 2000), true);
  assert.equal(memory.failedRoute('hvc1.1.6.L120.90', s, t0 + 2000), false, 'another codec string is not touched');
  assert.equal(memory.failedRoute('hvc1.2.4.L120.90', s, t0 + 29 * DAY), true);
  assert.equal(memory.failedRoute('hvc1.2.4.L120.90', s, t0 + 30 * DAY), false, 'a month later the browser gets another chance');
  // Software failed too, or "Try again": forgotten.
  memory.rememberFallback('av01.0.08M.10', s, t0); memory.confirmRoute('av01.0.08M.10', s, t0);
  memory.forgetRoute('av01.0.08M.10', s, t0);
  assert.equal(memory.failedRoute('av01.0.08M.10', s, t0), false);
});

test('at most 40 pictures are remembered, the oldest dropped; broken or missing storage remembers nothing', () => {
  const s = fakeStore(), t0 = Date.UTC(2026, 0, 1);
  for (let i = 0; i < 45; i++) { memory.rememberFallback(`codec.${i}`, s, t0 + i); memory.confirmRoute(`codec.${i}`, s, t0 + i); }
  const kept = Object.keys(memory.readRoutes(s, t0 + 100).fallback);
  assert.equal(kept.length, 40);
  assert.ok(!kept.includes('codec.0') && kept.includes('codec.44'));
  s.m.set('astra-routes', '{not json');
  assert.deepEqual(memory.readRoutes(s, t0), { fallback: {}, pass: {} });
  const refusing = { getItem: () => { throw Error('denied'); }, setItem: () => { throw Error('denied'); } };
  memory.rememberPass('ac3', true, refusing);
  assert.equal(memory.passFailed('ac3', refusing), false);
  assert.equal(memory.passFailed('ac3', null), false);
});

test('sound that failed when passed through is remembered per codec, and taken back when it was not the sound', () => {
  const s = fakeStore(), t0 = Date.UTC(2026, 0, 1);
  memory.rememberPass('ac3', true, s, t0);
  assert.equal(memory.passFailed('ac3', s, t0 + DAY), true);
  assert.equal(memory.passFailed('eac3', s, t0 + DAY), false);
  memory.rememberPass('ac3', false, s, t0 + DAY);
  assert.equal(memory.passFailed('ac3', s, t0 + DAY), false);
  memory.rememberPass('eac3', true, s, t0);
  assert.equal(memory.passFailed('eac3', s, t0 + 31 * DAY), false, 'expires like the rest');
  assert.ok(!s.m.get('astra-routes').includes('http'), 'nothing about the film is stored');
});

test("the lab says in plain words what happens to Dolby and DTS sound on this phone", () => {
  const no = { 'AC-3': false, 'E-AC-3': false, DTS: false };
  assert.equal(surroundWords({ mse: no, opusEncoder: true }), 'Dolby Digital, Dolby Digital Plus and DTS are converted to stereo on this phone.');
  assert.equal(surroundWords({ mse: { ...no, 'AC-3': true, 'E-AC-3': true }, opusEncoder: true }),
    "Dolby Digital and Dolby Digital Plus play as they are, through the phone's own decoder; DTS is converted to stereo on this phone.");
  assert.match(surroundWords({ mse: { ...no, 'AC-3': true }, passFailed: { ac3: true }, opusEncoder: true }), /^Dolby Digital failed when played as it is, so it is converted/);
  assert.match(surroundWords({ mse: no, opusEncoder: false }), /cannot convert sound/);
});

test('hls.js and dash.js get a phone\'s settings: capped to the player, 40 s ahead (20 with the saver), 30 s behind', () => {
  assert.deepEqual(hlsTuning(false), { capLevelToPlayerSize: true, capLevelOnFPSDrop: true, maxBufferLength: 40, maxMaxBufferLength: 40, backBufferLength: 30 });
  assert.equal(hlsTuning(true).maxBufferLength, 20);
  assert.equal(hlsTuning(true).maxMaxBufferLength, 20, 'no reading past the target on a low-bitrate stream');
  const off = dashTuning(false);
  assert.deepEqual(off.streaming.buffer, { bufferTimeDefault: 40, bufferTimeAtTopQuality: 40, bufferTimeAtTopQualityLongForm: 40, bufferToKeep: 30 });
  assert.equal(off.streaming.abr.limitBitrateByPortal, true);
  assert.equal(off.streaming.abr.usePixelRatioInLimitBitrateByPortal, true);
  assert.equal(off.streaming.abr.maxBitrate.video, -1, 'no ceiling without the saver');
  assert.equal(dashTuning(true).streaming.buffer.bufferTimeAtTopQuality, 20);
});

test('with the saver on, the ceiling is 720p\'s worth of picture', () => {
  const levels = [[426, 240, 4e5], [854, 480, 1.2e6], [1280, 720, 2.8e6], [1920, 1080, 5e6], [3840, 2160, 16e6]].map(([width, height, bitrate]) => ({ width, height, bitrate }));
  assert.equal(saverCeiling(levels), 2);
  assert.equal(saverCeiling([{ bitrate: 1e6 }, { bitrate: 2.5e6 }, { bitrate: 8e6 }]), 1, 'by bitrate where sizes are unknown');
  assert.equal(saverCeiling([{ height: 1080 }, { height: 2160 }]), 0, 'the lowest when none fits');
  const player = { getRepresentationsByType: () => levels.map(({ width, height, bitrate }) => ({ width, height, bandwidth: bitrate })) };
  assert.equal(dashTuning(true, player).streaming.abr.maxBitrate.video, 2800, 'dash.js counts kbit/s');
  assert.equal(dashTuning(true).streaming.abr.maxBitrate.video, 3000);
  // hls.js: put on at once, taken away again when the saver goes off; a lower cap of its own is kept.
  const hls = { levels, autoLevelCapping: -1 };
  capNow(hls, true); assert.equal(hls.autoLevelCapping, 2);
  capNow(hls, false); assert.equal(hls.autoLevelCapping, -1);
  hls.autoLevelCapping = 1; capNow(hls, true); assert.equal(hls.autoLevelCapping, 1);
});

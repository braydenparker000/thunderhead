// An export's numbers, without a browser: how long it should take from this phone's own past exports and how long
// is left while it runs (frontend/lab/editor/app/eta.js); the encoder's quality for the Export board's
// (frontend/lab/engine/files.js `encoderQuality`); and the line a file carries on how it was made
// (app/export-note.js), written by the PNG and TIFF writers and read back by scripts/export-note.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { about, countdown, estimate, left, perMp } from '../frontend/lab/editor/app/eta.js';
import { encoderQuality, jpeg, png, tiff } from '../frontend/lab/engine/files.js';
import { MOST, noteLine } from '../frontend/lab/editor/app/export-note.js';
import { noteIn } from '../scripts/export-note.mjs';

const save = (ms, mp, net = 0, more = {}) => ({ at: 1, kind: 'save', ms, px: mp * 1e6, net, files: 2, ...more });

test('the estimate is this phone\'s median ms a megapixel for that way, from its last five exports, times the megapixels', () => {
  const t = [save(9e6, 10), save(30_000, 10), save(40_000, 10), save(50_000, 10), save(60_000, 10), save(70_000, 10), save(80_000, 10),   // the first is too old to count
    save(200_000, 10, 1), save(240_000, 12, 1), { kind: 'open', ms: 900 }, save(0, 0, 1, { fell: 2 }), save(500_000, 10, 0, { fell: 1, net: 0 })];
  assert.equal(perMp(t, false), 6000, 'classic: 4 000 to 8 000 ms a megapixel, the median of the last five; the cut-off and the fallen-back say nothing');
  assert.equal(perMp(t, true), 20_000, 'by the network: 20 000 both times');
  assert.equal(estimate(t, false, 48e6), 288_000);
  assert.equal(estimate(t, true, 6e6), 120_000);
  assert.deepEqual([perMp([], false), estimate([], true, 40e6), estimate([save(30_000, 10, 0)], true, 40e6), estimate(t, false, 0)], [null, null, null, null], 'no past export that way: nothing to say');
  assert.deepEqual([about(2_000), about(41_000), about(54_000), about(61_000), about(120_000), about(150_000), about(15 * 60_000)], ['about 5 s', 'about 40 s', 'about 55 s', 'about 1 min', 'about 2 min', 'about 3 min', 'about 15 min']);
  assert.deepEqual([left(0), left(2_000), left(12_000), left(80_000), left(120_000), left(125_000), left(599_000), left(12 * 60_000)],
    ['almost done', 'almost done', '15 s left', '1 min 20 s left', '2 min left', '2 min 10 s left', '10 min left', '12 min left']);
});

test('the time left follows the rate measured so far, at most once a second, and never jumps up by more than a fifth', () => {
  // a steady export of 100 s, read every 100 ms, with no estimate to start from
  const c = countdown(null), seen = [];
  for (let t = 0; t <= 100_000; t += 100) seen.push([t, c(t / 100_000, t)]);
  assert.equal(seen[0][1], null, 'nothing to go by at the start');
  const changes = seen.filter(([, v], i) => i && v !== seen[i - 1][1]);
  for (let i = 1; i < changes.length; i++) assert.ok(changes[i][0] - changes[i - 1][0] >= 1000, `changed ${changes[i][0] - changes[i - 1][0]} ms apart`);
  const mid = seen.find(([t]) => t === 50_000)[1];
  assert.ok(Math.abs(mid - 50_000) < 3000, `half way: ${mid} ms left`);
  assert.ok(seen.at(-1)[1] < 2000, `at the end: ${seen.at(-1)[1]} ms`);
  // a stall (the phone busy) then a burst: what is shown never rises more than 20 % at a step
  const s = countdown(60_000);
  let last = null;
  const steps = [[0, 0], [0.05, 3000], [0.1, 6000], [0.11, 16_000], [0.12, 30_000], [0.5, 40_000], [0.9, 50_000]];
  for (const [d, t] of steps) {
    const v = s(d, t);
    if (last !== null && v !== null) assert.ok(v <= last * 1.2 + 1e-9, `${last} to ${v} at ${t} ms`);
    if (v !== null) last = v;
  }
  assert.equal(countdown(60_000)(0, 0), 60_000, 'with an estimate, that is the start');
});

test('the board\'s quality 100 is the encoder\'s 97; up to 90 they are the same', () => {
  assert.deepEqual([1, 50, 85, 89, 90, 91, 93, 95, 97, 99, 100].map(encoderQuality), [1, 50, 85, 89, 90, 91, 92, 94, 95, 96, 97]);
  for (let q = 50; q < 100; q++) assert.ok(encoderQuality(q + 1) >= encoderQuality(q) && encoderQuality(q + 1) - encoderQuality(q) <= 1, `smooth at ${q}`);
});

test('a JPEG writer asks the encoder for the mapped quality and puts the note just after the Exif', async () => {
  // a stand-in encoder: a band as a small JPEG of the shape the writer expects (tables, frame, scan)
  const asked = [], band = async (rgb, w, h, q, fine) => {
    asked.push([q, fine]);
    return new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0, 4, 0, 1, 0xff, 0xc0, 0, 11, 8, 0, h, 0, w, 1, 1, 0x11, 0, 0xff, 0xda, 0, 8, 1, 1, 0, 0, 63, 0, 9, 9, 0xff, 0xd9]);
  };
  const line = noteLine({ build: '7.abc1234', way: 'classic', values: { Exposure: 0.5 }, wb: 'As shot', profile: 'PROVIA', crop: false, masks: 0, spots: 1, q: 100 });
  const exif = new Uint8Array([0x49, 0x49, 42, 0, 8, 0, 0, 0, 0, 0]);
  const w = jpeg(4, 2, 100, band, exif, line);
  await w.rows(new Uint16Array(4 * 2 * 3), 2);
  const b = new Uint8Array(await (await w.done()).arrayBuffer());
  assert.deepEqual(asked, [[97, true]], 'the encoder is asked for 97, colour kept whole');
  const com = [...b].findIndex((v, i) => v === 0xff && b[i + 1] === 0xfe), app1 = [...b].findIndex((v, i) => v === 0xff && b[i + 1] === 0xe1);
  assert.equal(com, app1 + 2 + ((b[app1 + 2] << 8) | b[app1 + 3]), 'the comment follows the Exif');
  assert.equal(noteIn(b), line);
  assert.equal(noteIn(b.subarray(0, com + 40 + line.length)), line, 'read from a file cut off soon after it');
  const plain = jpeg(4, 2, 90, band, null);
  await plain.rows(new Uint16Array(4 * 2 * 3), 2);
  assert.equal(noteIn(new Uint8Array(await (await plain.done()).arrayBuffer())), '', 'no note given, none written');
  assert.deepEqual(asked.at(-1), [90, true]);
});

test('the note is one line of JSON under 1,500 bytes, written into a PNG and a TIFF and read back', async () => {
  const many = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`Grade Zone ${i} Sat`, i + 0.123]));
  const big = noteLine({ build: '0.dev', way: 'network', values: many, wb: 'Custom', profile: 'CLASSIC CHROME', crop: true, masks: 3, spots: 12, q: 95 });
  const o = JSON.parse(big);
  assert.ok(big.length < MOST && !big.includes('\n'), `${big.length} bytes`);
  assert.deepEqual([o.th, o.way, o.crop, o.masks, o.spots, o.q, o.values['Grade Zone 0 Sat'], o.cut > 0], [1, 'network', true, 3, 12, 95, 0.12, true]);
  const line = noteLine({ build: '0.dev', way: 'faster', values: { Exposure: 1, Grain: 9 }, wb: 'Daylight', profile: 'ÉTERNA', crop: false, masks: 0, spots: 0, q: 85 });
  for (const make of [(n) => png(3, 2, null, n), (n) => tiff(3, 2, null, n)]) {
    const w = make(line);
    await w.rows(new Uint16Array(3 * 2 * 3).fill(30000), 2);
    const b = new Uint8Array(await (await w.done()).arrayBuffer()), read = noteIn(b);
    assert.deepEqual(JSON.parse(read), { th: 1, build: '0.dev', way: 'faster', values: { Exposure: 1, Grain: 9 }, wb: 'Daylight', profile: 'ÉTERNA', crop: false, masks: 0, spots: 0, q: 85 });
    assert.ok(/^[\x20-\x7e]+$/.test(read), 'plain ASCII in the file');
    const none = make(undefined);
    await none.rows(new Uint16Array(3 * 2 * 3), 2);
    assert.equal(noteIn(new Uint8Array(await (await none.done()).arrayBuffer())), '');
  }
});

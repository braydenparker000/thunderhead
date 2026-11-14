// The picture check's verdict in words and numbers (frontend/lab/engine/checked.js): what the editor keeps and notes
// with the timings once it has developed the known photo on the phone (the check itself runs in a browser:
// tests/lab-engine-pictures-browser.test.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { line, numbers, summed } from '../frontend/lab/engine/checked.js';

const shots = { demosaic: { psnr: 36.1, grid: [] }, network: { psnr: 39.54, grid: [] }, networkNoisy: { psnr: 36.12, grid: [] }, frame: { grid: [] } };

test('a check sums to how many pictures are the reference\'s, which are not, and the furthest off', () => {
  const all = summed(shots, { demosaic: { same: true, db: 0.01, grid: 0.0002 }, network: { same: true, db: 0.04, grid: 0.0001 }, networkNoisy: { same: true, db: 0.02, grid: 0 }, frame: { same: true, grid: 0.0004 } });
  assert.deepEqual(all, { shots: 4, same: 4, different: [], db: 0.04, grid: 0.0004, net: 39.54, netNoisy: 36.12 });
  const one = summed(shots, { demosaic: { same: true, db: 0, grid: 0 }, network: { same: false, db: 0.41, grid: 0.0012 }, networkNoisy: { same: true, db: 0.1, grid: 0 }, frame: { same: false, why: 'no reference' } });
  assert.deepEqual([one.same, one.different, one.db, one.grid], [2, ['network', 'frame'], 0.41, 0.0012]);
  // as a timing: numbers only, the pictures that differ a bit each in the order they are made
  const c = { build: 'abc1234', at: 5000, ms: 6100.4, gpu: 'a chip', ...one };
  assert.deepEqual(numbers(c, Object.keys(shots)), { at: 5000, kind: 'check', ms: 6100, shots: 4, same: 2, diff: 0b1010, offdb: 41, offgrid: 12, netdb: 3954, netndb: 3612 });
  // and in a sentence
  assert.equal(line(null), 'The pictures have not been checked on this phone yet.');
  assert.equal(line({ ...c, ...all }), "Checked on this phone, build abc1234: all 4 pictures are the reference's.");
  assert.equal(line(c), "Checked on this phone, build abc1234: network, frame are not the reference's (off by 0.41 dB and 0.0012).");
  assert.match(line({ ...c, different: ['network'] }), /: network is not the reference's /);
});

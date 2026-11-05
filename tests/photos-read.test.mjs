// The camera's own rating (PHOTOS.md, culling): read.js finds it in Fujifilm's MakerNote (Rating,
// 0x1431) beside the film simulation, 1–5 or none; the star row offers it while a photo is unrated.
// On a synthetic EXIF block (tests/fixtures/make-raf.mjs), never a camera's file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jpegWords } from '../frontend/apps/photos/read.js';
import { withExif } from './fixtures/make-raf.mjs';

const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
const words = { make: 'FUJIFILM', model: 'X-E5', taken: '2026:10:30 17:00:05', zone: '+00:00', width: 640, height: 427, film: 0x600 };

test('the MakerNote rating is read beside the film simulation; none or out of range is 0', async () => {
  const rated = await jpegWords(withExif(jpeg, { ...words, rating: 3 }));
  assert.equal(rated?.rating, 3);
  assert.equal(rated?.film, 'Classic Chrome');
  assert.equal((await jpegWords(withExif(jpeg, words)))?.rating, 0);
  assert.equal((await jpegWords(withExif(jpeg, { ...words, rating: 9 })))?.rating, 0);
});

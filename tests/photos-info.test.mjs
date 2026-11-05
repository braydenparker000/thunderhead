// A photo's info (PHOTOS.md § Info): exif.js and fuji.js on synthetic bytes only (fixtures/make-exif.mjs
// builds the TIFF and the maker note here; no real photo). The EXIF and the maker note read in either
// byte order, put into the camera's words; an unknown value shows as its number, a damaged file never
// throws, the contract's ranges hold, and the GPS IFD is never read: no byte of it, no key, no value.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowed, bias, cameraRows, flash, imageRows, jpegInfo, shutter, tiffInfo } from '../frontend/apps/photos/exif.js';
import { filmOf, filmRows, fujiNote } from '../frontend/apps/photos/fuji.js';
import { bytesRead } from '../frontend/apps/photos/read.js';
import { fujiNote as note, fullSet, jpegWith, makeTiff } from './fixtures/make-exif.mjs';

const FULL = {
  orientation: 6, software: 'Digital Camera X-E5 Ver1.00', exposure: 0.004, fnumber: 2.8, program: 3, bias: -0.666667,
  metering: 5, flash: 16, focal: 23, width: 7728, height: 5152, wb_mode: 0, focal35: 35, iso: 400, lens: 'XF23mmF2 R WR',
  sharpness: 0x84, wb: 0xff0, saturation: 0x80, wb_kelvin: 5600, nr: 0x280, clarity: 2000, shadow: 16, highlight: -16,
  grain: 64, chrome: 64, grain_size: 32, chrome_blue: 32, film_mode: 0x600, dr_setting: 1, dr_dev: 400, dr_priority: 0,
  dr_priority_auto: 2, wb_fine_r: 40, wb_fine_b: -20, stab: 2, stab_mode: 1,
};

/** A Read that remembers every byte range asked for. @param {Uint8Array} u8 */
function tracked(u8) {
  const asked = [];
  const read = bytesRead(u8);
  return { asked, read: (o, n) => { asked.push([o, o + n]); return read(o, n); } };
}

test('a JPEG’s EXIF and Fujifilm maker note, little-endian, read whole', async () => {
  const { tiff } = fullSet(true);
  assert.deepEqual(await jpegInfo(jpegWith(tiff)), FULL);
});

test('a big-endian TIFF (a DNG’s own IFDs) reads the same; the maker note stays little-endian', async () => {
  const { tiff } = fullSet(false);
  assert.deepEqual(await tiffInfo(bytesRead(tiff), 0), FULL);
});

test('the GPS IFD is never followed: no byte of it read, no key, no value', async () => {
  for (const le of [true, false]) {
    const { tiff, gpsAt, end } = fullSet(le);
    const t = tracked(tiff);
    const info = await tiffInfo(t.read, 0);
    // The GPS IFD's entries and its values (the last thing in the block) are never asked for.
    const gpsEnd = gpsAt + 2 + 4 * 12 + 4;
    for (const [a, b] of t.asked) assert.ok(b <= gpsAt || a >= gpsEnd, `read ${a}–${b} inside the GPS IFD`);
    assert.ok(t.asked.every(([a]) => a < end - 48), 'the GPS values at the end are never read');
    const json = JSON.stringify(info);
    assert.doesNotMatch(json, /gps|lat|lon|\b35\b.*\b39\b|139|3105|4344/i);
  }
});

test('the camera’s words: Camera, Film and Image rows', () => {
  const p = { camera: 'FUJIFILM X-E5', width: null, height: null, format: 'raf', bytes: 31_457_280, taken_at: Date.UTC(2026, 9, 30, 17, 0, 5) };
  assert.deepEqual(cameraRows(FULL, p), [
    ['Body', 'FUJIFILM X-E5'], ['Lens', 'XF23mmF2 R WR'], ['Focal length', '23 mm (35 mm full frame)'],
    ['Exposure', '1/250 s · f/2.8 · ISO 400'], ['Bias', '−2/3 EV'], ['Program', 'Aperture priority'],
    ['Metering', 'Multi'], ['Flash', 'Off, did not fire'],
  ]);
  assert.deepEqual(filmRows(FULL), [
    ['Film simulation', 'Classic Chrome'], ['Dynamic range', 'DR400'], ['DR priority', 'Auto, Strong'],
    ['Highlights', '+1'], ['Shadows', '−1'], ['Colour', '+1'], ['Sharpness', '+1'], ['Noise reduction', '−1'],
    ['Clarity', '+2'], ['Grain', 'Strong, large'], ['Colour chrome', 'Strong'], ['Colour chrome blue', 'Weak'],
    ['White balance', 'Colour temperature 5600 K'], ['WB shift', 'R +2, B −1'], ['Stabilisation', 'Sensor-shift, continuous'],
  ]);
  const image = Object.fromEntries(imageRows(FULL, p));
  assert.equal(image.Size, '7728 × 5152 · 39.8 MP');
  assert.equal(image.Orientation, 'Turned 90° right');
  assert.equal(image.Format, 'RAF (RAW)');
  assert.equal(image['File size'], '31.5 MB');
  assert.match(image.Taken, /2026/);
  assert.equal(image.Software, 'Digital Camera X-E5 Ver1.00');
});

test('black and white, half steps, Auto DR, and the formats of exposure, bias and flash', () => {
  const mono = { film_mode: 0x0, saturation: 0x501, mono_warm: 2, mono_green: -1, highlight: -24, shadow: 8, dr_setting: 0, dr_dev: 200, grain: 0 };
  assert.equal(filmOf(mono), 'Acros + R Filter');
  assert.deepEqual(filmRows(mono), [
    ['Film simulation', 'Acros + R Filter'], ['Dynamic range', 'DR200 (Auto)'], ['Highlights', '+1.5'], ['Shadows', '−0.5'],
    ['Warm–cool', '+2'], ['Magenta–green', '−1'], ['Grain', 'Off'],
  ]);
  assert.equal(shutter(2), '2 s');
  assert.equal(shutter(1 / 8000), '1/8000 s');
  assert.equal(bias(0), '0 EV');
  assert.equal(bias(4 / 3), '+1 1/3 EV');
  assert.equal(bias(1), '+1 EV');
  assert.equal(bias(0.5), '+0.5 EV');
  assert.equal(flash(0x19), 'Auto, fired');
  assert.equal(flash(0x20), 'No flash');
});

test('a value it does not know shows as its number; the range check and the names hold', async () => {
  assert.deepEqual(filmRows({ film_mode: 0x999, sharpness: 0x77, nr: 5, chrome: 7, highlight: 5, stab: 9, stab_mode: 1 }), [
    ['Film simulation', '2457'], ['Highlights', '5'], ['Sharpness', '119'], ['Noise reduction', '5'], ['Colour chrome', '7'], ['Stabilisation', '9, continuous'],
  ]);
  assert.deepEqual(cameraRows({ program: 42, metering: 77 }, { camera: null }), [['Program', '42'], ['Metering', '77']]);
  assert.deepEqual(allowed({ iso: -5, rating: 9, exposure: Number.NaN, fnumber: 2.8, lat: 35.6, lens: `\u0001Lens\u0085 ${'x'.repeat(100)}`, software: '\n' }),
    { fnumber: 2.8, lens: `Lens ${'x'.repeat(75)}` });
});

test('a damaged file never throws: no TIFF, a cut note, a note that is not Fujifilm’s, offsets past the end', async () => {
  assert.equal(await jpegInfo(Uint8Array.from([1, 2, 3])), null);
  assert.deepEqual(await jpegInfo(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])), {});
  const cut = note([[0x1401, 3, 0x600], [0x100a, 9, [40, -20]]]).slice(0, 20);
  const odd = [...new TextEncoder().encode('OTHERMAKE   '), 0, 0, 0, 0];
  for (const n of [cut, odd]) {
    const { tiff } = makeTiff({ exif: [[0x829d, 5, [[56, 10]]], [0x927c, 7, n]] });
    assert.deepEqual(await tiffInfo(bytesRead(tiff), 0), { fnumber: 5.6 });
  }
  const { tiff } = fullSet(true);
  const short = tiff.slice(0, 200);
  const info = await tiffInfo(bytesRead(short), 0).catch((e) => e);
  assert.ok(!(info instanceof Error) || info instanceof RangeError, String(info));
  assert.deepEqual(await fujiNote(bytesRead(Uint8Array.from([0, 1])), 0), {});
});

// The recipe inside an export (PHOTOS.md, Export: the XMP names): a recipe written as XMP and read back
// is the same canonical recipe (numbers, switches, white balance, curves, crop and geometry), the
// crs: names where Lightroom has them and ours for the flips; and the streaming JPEG encoder's file has
// the XMP in its APP1, its tables whole, and its markers in order at both chroma samplings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalRecipe } from '../shared/contract/photos-recipe.ts';
import { jpegEncoder, TABLES } from '../frontend/apps/photos/edit/jpeg.js';
import { findXmp, OURS, recipeOfXmp, xmpOf, xmpSegment } from '../frontend/apps/photos/edit/xmp.js';

const RECIPE = {
  Exposure2012: 0.45, Contrast2012: -12, Shadows2012: 30, Vibrance: 0, WhiteBalance: 'Custom', Temperature: 5600, Tint: -4,
  HueAdjustmentOrange: -8, SplitToningShadowHue: 220, SplitToningShadowSaturation: 15, ConvertToGrayscale: false,
  ToneCurvePV2012: [[0, 0], [64, 52], [192, 205], [255, 255]], ToneCurvePV2012Blue: [[0, 10], [255, 245]],
  CropLeft: 0.1, CropTop: 0.05, CropRight: 0.9, CropBottom: 0.95, CropAngle: -3.5, PerspectiveVertical: 20,
  CropConstrainToWarp: true, AutoLateralCA: true, FlipHorizontal: true, LensManualDistortionAmount: 8, VignetteAmount: 15, Sharpness: 40,
};

test('a recipe round-trips through XMP into the same canonical recipe', () => {
  const xml = xmpOf(canonicalRecipe(RECIPE));
  assert.deepEqual(canonicalRecipe(recipeOfXmp(xml)), canonicalRecipe(RECIPE));
  for (const k of ['crs:Exposure2012="+0.45"', 'crs:CropAngle="-3.5"', 'crs:HasCrop="True"', 'crs:AlreadyApplied="True"', 'crs:AutoLateralCA="1"', 'crs:CropConstrainToWarp="1"', 'th:FlipHorizontal="True"', 'crs:WhiteBalance="Custom"', '<rdf:li>64, 52</rdf:li>', `xmlns:th="${OURS}"`])
    assert.ok(xml.includes(k), k);
  assert.ok(!xml.includes('crs:FlipHorizontal') && !xml.includes('Vibrance') && !xml.includes('Sharpness'), 'defaults and our own keys stay out of crs:');
  assert.deepEqual(recipeOfXmp(xmpOf({})), {});
});

test('the JPEG encoder: whole tables, the XMP in APP1, markers in order, 4:2:0 and 4:4:4', () => {
  for (const t of Object.values(TABLES)) assert.equal(t.bits.reduce((a, b) => a + b, 0), t.vals.length);
  const w = 37, h = 21, xml = xmpOf(canonicalRecipe(RECIPE));
  for (const [quality, sampling] of [[80, 0x22], [95, 0x11]]) {
    const enc = jpegEncoder({ width: w, height: h, quality, segments: [xmpSegment(xml)] });
    const parts = [enc.head()];
    for (let y = 0; y < h; y += 16) {
      const n = Math.min(16, h - y), rows = new Uint8Array(w * n * 4);
      for (let i = 0; i < w * n; i++) rows.set([(i % w) * 6, (y + i / w) * 10, 128, 255], i * 4);
      parts.push(enc.rows(rows, n));
    }
    parts.push(enc.finish());
    const b = Buffer.concat(parts);
    assert.deepEqual([...b.subarray(0, 4)], [0xff, 0xd8, 0xff, 0xe0]);
    assert.deepEqual([...b.subarray(-2)], [0xff, 0xd9]);
    assert.equal(findXmp(b), xml);
    const markers = [];
    for (let i = 2; b[i] === 0xff && b[i + 1] !== 0xda; i += 2 + ((b[i + 2] << 8) | b[i + 3])) markers.push(b[i + 1]);
    assert.deepEqual(markers, [0xe0, 0xe1, 0xdb, 0xdb, 0xc0, 0xc4, 0xc4, 0xc4, 0xc4]);
    const sof = b.indexOf(Buffer.from([0xff, 0xc0]));
    assert.deepEqual([b.readUInt16BE(sof + 5), b.readUInt16BE(sof + 7), b[sof + 11]], [h, w, sampling]);
  }
});

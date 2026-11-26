// Music's wide covers with filler sides (frontend/music/src/library/cover-crop.js; owner, 2026-11-26): a
// 16:9 (or 4:3) cover whose real picture is the square in the middle, its sides plain, a blurred stretched
// copy, a smear of its edge columns or a mirror, is cut to that square, exactly where its edge is; a
// genuinely wide picture, a square one and a tall one stay whole. Every image is generated here, at the
// 64 px height the phone looks at a cover with.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coverCrop, cropPixels, isWide, packRect, smallSize, unpackRect } from '../frontend/music/src/library/cover-crop.js';

let seed = 1;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const img = (W, H) => ({ width: W, height: H, data: new Uint8ClampedArray(W * H * 4).fill(255) });
const set = (im, x, y, c) => { const i = (y * im.width + x) * 4; im.data[i] = c[0]; im.data[i + 1] = c[1]; im.data[i + 2] = c[2]; };
const get = (im, x, y) => { const i = (y * im.width + x) * 4; return [im.data[i], im.data[i + 1], im.data[i + 2]]; };

/** A detailed picture: coloured discs over waves, with grain. */
function picture(W, H, s = 7) {
  seed = s;
  const im = img(W, H);
  const discs = Array.from({ length: 14 }, () => ({ x: rnd() * W, y: rnd() * H, r: 4 + rnd() * 14, c: [rnd() * 255, rnd() * 255, rnd() * 255] }));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let c = [120 + 60 * Math.sin(x / 3), 90 + 50 * Math.cos(y / 4), 140];
    for (const d of discs) if ((x - d.x) ** 2 + (y - d.y) ** 2 < d.r ** 2) c = d.c;
    const n = (rnd() - 0.5) * 40;
    set(im, x, y, c.map((v) => v + n));
  }
  return im;
}
const paste = (dst, src, ox) => { for (let y = 0; y < src.height; y++) for (let x = 0; x < src.width; x++) if (ox + x >= 0 && ox + x < dst.width) set(dst, ox + x, y, get(src, x, y)); };
function blur(im, r) {
  const out = img(im.width, im.height);
  for (let y = 0; y < im.height; y++) for (let x = 0; x < im.width; x++) {
    const s = [0, 0, 0];
    let n = 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const c = get(im, Math.min(im.width - 1, Math.max(0, x + dx)), Math.min(im.height - 1, Math.max(0, y + dy)));
      s[0] += c[0]; s[1] += c[1]; s[2] += c[2]; n++;
    }
    set(out, x, y, s.map((v) => v / n));
  }
  return out;
}
/** The square picture on plain bars (with a little grain), its left edge at `ox`. */
function plainBars(W, H, ox = (W - H) / 2, colour = [24, 26, 40]) {
  const im = img(W, H);
  seed = 3;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) set(im, x, y, colour.map((v) => v + (rnd() - 0.5) * 3));
  paste(im, picture(H, H), Math.round(ox));
  return im;
}
/** The square picture over itself stretched to the width and blurred (the usual video thumbnail). */
function blurredBars(W, H, r = 3) {
  const sq = picture(H, H), bg = img(W, H), k = W / H;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) set(bg, x, y, get(sq, Math.min(H - 1, Math.floor(x / k)), Math.min(H - 1, Math.floor((y + (H * k - H) / 2) / k))));
  const b = blur(blur(bg, r), r);
  paste(b, sq, Math.round((W - H) / 2));
  return b;
}
/** The sides a mirror of the picture's own edge, or its edge columns smeared sideways. */
function sideBars(W, H, kind) {
  const sq = picture(H, H), im = img(W, H), ox = Math.round((W - H) / 2);
  paste(im, sq, ox);
  for (let y = 0; y < H; y++) for (let i = 0; i < ox; i++) {
    set(im, ox - 1 - i, y, get(sq, kind === 'mirror' ? i : 0, y));
    set(im, ox + H + i, y, get(sq, kind === 'mirror' ? H - 1 - i : H - 1, y));
  }
  return im;
}
/** Plain bars drawn four times larger and averaged down, so the picture's edge falls inside a pixel. */
function finePlainBars(quarter) {
  const k = 4, W = 114, H = 64, big = img(W * k, H * k), sq = picture(H, H);
  for (let y = 0; y < H * k; y++) for (let x = 0; x < W * k; x++) set(big, x, y, [24, 26, 40]);
  for (let y = 0; y < H * k; y++) for (let x = 0; x < H * k; x++) set(big, quarter + x, y, get(sq, x >> 2, y >> 2));
  const out = img(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const s = [0, 0, 0];
    for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) { const c = get(big, x * k + dx, y * k + dy); s[0] += c[0]; s[1] += c[1]; s[2] += c[2]; }
    set(out, x, y, s.map((v) => v / (k * k)));
  }
  return out;
}
const px = (im) => { const r = coverCrop(im); return r && { why: r.why, crop: r.crop && cropPixels(r.crop, im.width, im.height) }; };

test('plain bars: the centred square, cut exactly', () => {
  assert.deepEqual(px(plainBars(114, 64)), { why: 'plain', crop: { sx: 25, sy: 0, sw: 64, sh: 64 } });
  assert.deepEqual(px(plainBars(114, 64, 25, [235, 235, 230])), { why: 'plain', crop: { sx: 25, sy: 0, sw: 64, sh: 64 } }, 'light bars');
  // 4:3 takes the same test.
  assert.deepEqual(px(plainBars(85, 64)), { why: 'plain', crop: { sx: 11, sy: 0, sw: 64, sh: 64 } });
});

test('blurred, mirrored and smeared sides are filler too', () => {
  for (const r of [2, 3, 6]) assert.deepEqual(px(blurredBars(114, 64, r)), { why: 'blur', crop: { sx: 25, sy: 0, sw: 64, sh: 64 } }, `blur ${r}`);
  assert.deepEqual(px(blurredBars(85, 64)), { why: 'blur', crop: { sx: 11, sy: 0, sw: 64, sh: 64 } }, '4:3');
  assert.deepEqual(px(sideBars(114, 64, 'mirror')), { why: 'mirror', crop: { sx: 25, sy: 0, sw: 64, sh: 64 } });
  assert.deepEqual(px(sideBars(114, 64, 'smear')), { why: 'stretched', crop: { sx: 25, sy: 0, sw: 64, sh: 64 } });
});

test('slightly off-centre bars: the edge found where it is, to the sub-pixel', () => {
  assert.deepEqual(px(plainBars(114, 64, 29)), { why: 'plain', crop: { sx: 29, sy: 0, sw: 64, sh: 64 } }, '4 px right');
  assert.deepEqual(px(plainBars(114, 64, 22)), { why: 'plain', crop: { sx: 22, sy: 0, sw: 64, sh: 64 } }, '3 px left');
  for (const q of [101, 102, 103]) {
    const r = coverCrop(finePlainBars(q));
    assert.equal(r.why, 'plain');
    assert.ok(Math.abs(r.crop.x * 114 - q / 4) < 0.1, `left edge ${r.crop.x * 114} near ${q / 4}`);
    assert.ok(Math.abs((r.crop.x + r.crop.w) * 114 - (q / 4 + 64)) < 0.1, 'right edge');
  }
});

test('a genuinely wide picture stays whole; so do a square and a tall one', () => {
  for (const s of [7, 99]) {
    const r = coverCrop(picture(114, 64, s));
    assert.equal(r.why, 'wide');
    assert.equal(r.crop, null);
    assert.ok(r.square, 'the square is still offered (Crop Cover)');
  }
  // A smooth sky (a vertical gradient with a sun): smooth sides are not filler by themselves.
  const sky = img(114, 64);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 114; x++) { const sun = (x - 57) ** 2 + (y - 21) ** 2 < 64 ? 80 : 0; set(sky, x, y, [90 + y + sun, 140 + y / 2 + sun, 220 - y]); }
  assert.equal(coverCrop(sky).crop, null, 'sky');
  // A sharp subject on a soft background (no edge where the square's would be).
  const bokeh = blur(picture(114, 64, 11), 4), subject = picture(64, 64, 5);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 114; x++) if ((x - 57) ** 2 + (y - 32) ** 2 < 22 ** 2) set(bokeh, x, y, get(subject, x - 57 + 32, y));
  assert.equal(coverCrop(bokeh).crop, null, 'bokeh');
  assert.equal(coverCrop(picture(64, 64)), null, 'square');
  assert.equal(coverCrop(picture(64, 100)), null, 'tall');
  assert.equal(coverCrop(plainBars(80, 64)), null, '5:4 is not wide enough to look at');
  // An empty frame (the middle plain too) is left alone.
  const empty = img(114, 64);
  assert.equal(coverCrop(empty).crop, null);
});

test('sizes, pixels and the kept form', () => {
  assert.deepEqual(smallSize(1920, 1080), { width: 114, height: 64 });
  assert.deepEqual(smallSize(40, 30), { width: 40, height: 30 }, 'never larger than the image');
  assert.equal(isWide(1920, 1080), true);
  assert.equal(isWide(1000, 1000), false);
  // Rounded inward, then made square about its centre when within 3 %.
  assert.deepEqual(cropPixels({ x: 0.2193, y: 0, w: 0.5614, h: 1 }, 640, 360), { sx: 140, sy: 0, sw: 360, sh: 360 });
  assert.deepEqual(cropPixels({ x: 0.25, y: 0, w: 0.4, h: 1 }, 1000, 500), { sx: 250, sy: 0, sw: 400, sh: 500 }, 'far from square: as found');
  const r = { x: 0.21875, y: 0, w: 0.5625, h: 1 };
  assert.deepEqual(unpackRect(packRect(r)), { x: 0.2188, y: 0, w: 0.5625, h: 1 });
  assert.equal(unpackRect([0.5, 0, 0.7, 1]), null, 'past the edge');
  assert.equal(unpackRect('x'), null);
});

test('the same pixels always decide the same', () => {
  const a = coverCrop(blurredBars(114, 64)), b = coverCrop(blurredBars(114, 64));
  assert.deepEqual(a, b);
});

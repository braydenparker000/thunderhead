// The develop pass's tone in Chromium (PHOTOS.md, the colour pipeline), on synthetic linear images built in
// the page (never a photograph), through the WebGL2 renderer the phones fall back to:
// - a backlit edge (a dark subject against a bright sky) at Highlights −100 and Shadows +100: no halo, the
//   band beside the edge within 2/255 of each side's plateau far from it;
// - clouds in that sky keep their local contrast when Highlights pulls the sky down;
// - Exposure +2 EV on a ramp compresses into white rather than clipping, and a saturated orange keeps its hue.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

const live = Boolean(process.env.SITE_URL);
let site, browser, page;

before(async () => {
  if (live) return;
  site = await serve(0, { api: 'http://127.0.0.1:9' });
  const exe = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
  browser = await chromium.launch({ ...exe, args: ['--disable-features=WebGPU'] });
  page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${site.address().port}/no-such-page`);
});
after(async () => { await browser?.close(); site?.close(); });

const f16 = (/** @type {number} */ v) => { const b = new DataView(new ArrayBuffer(4)); b.setFloat32(0, v); const i = b.getUint32(0); const e = ((i >>> 23) & 0xff) - 112; return e <= 0 ? 0 : ((i >>> 16) & 0x8000) | (e << 10) | ((i & 0x7fffff) >>> 13); };
/** Renders `fill(x, y) → [r, g, b]` (linear Rec.2020) at w × h with `recipe` as a RAW; RGBA bytes back. */
async function render(w, h, fill, recipe) {
  const data = new Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) fill(x, y).forEach((v, c) => { data[c * w * h + y * w + x] = f16(v); });
  return page.evaluate(async ([w, h, planes, recipe]) => {
    const [{ webgl2 }, { pack, toneLut }] = await Promise.all(['gl', 'uniforms'].map((m) => import(`/apps/photos/edit/${m}.js`)));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const r = await webgl2(c);
    r.source({ kind: 'planar', width: w, height: h, data: Uint16Array.from(planes) }, w, h);
    const img = { raw: true, asShot: [0.3127, 0.329], shot: { temperature: 6500, tint: 0 }, width: w, height: h };
    const u = pack(recipe, img, { scale: [1 / w, 1 / h], offset: [0, 0], size: [w, h], flip: 0, p0: [1 / w, 1 / h], tile: null });
    return [...(await r.read(u, toneLut(recipe, true), w, h))];
  }, [w, h, data, recipe]);
}
const at = (px, w, x, y, c = 1) => px[(y * w + x) * 4 + c];
const mean = (a) => a.reduce((n, v) => n + v, 0) / a.length;

test('a backlit edge at Highlights −100 and Shadows +100 has no halo (≤ 2/255 beside the edge)', { skip: live && 'local only' }, async () => {
  const W = 256, H = 32, EDGE = 128;
  const sky = (/** @type {number} */ x) => (x < 128 ? [0.004, 0.004, 0.004] : [0.6, 0.62, 0.66]);
  const recipe = { Highlights2012: -100, Shadows2012: 100, Sharpness: 0, ColorNoiseReduction: 0 };
  const px = await render(W, H, sky, recipe);
  const row = Array.from({ length: W }, (_, x) => mean(Array.from({ length: 8 }, (_, k) => at(px, W, x, 12 + k))));
  const dark = mean(row.slice(4, 24)), bright = mean(row.slice(W - 24, W - 4));
  const near = (/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ p) => Math.max(...row.slice(a, b).map((v) => Math.abs(v - p)));
  const halo = { dark: near(EDGE - 40, EDGE - 2, dark), bright: near(EDGE + 2, EDGE + 40, bright) };
  console.log(`# backlit edge: plateaus ${dark.toFixed(1)} and ${bright.toFixed(1)} of 255; beside the edge ${halo.dark.toFixed(2)} (dark side) and ${halo.bright.toFixed(2)} (bright side)`);
  assert.ok(bright - dark > 100, 'the edge is still an edge');
  assert.ok(halo.dark <= 2 && halo.bright <= 2, JSON.stringify(halo));
  // and the sliders still move each side
  const plain = await render(W, H, sky, { Sharpness: 0, ColorNoiseReduction: 0 });
  assert.ok(at(px, W, 10, 16) > at(plain, W, 10, 16) + 10, 'Shadows lifted the subject');
  assert.ok(at(px, W, W - 10, 16) < at(plain, W, W - 10, 16) - 10, 'Highlights pulled the sky down');
});

test('clouds keep their local contrast when Highlights pulls the sky down', { skip: live && 'local only' }, async () => {
  const W = 256, H = 64;
  const clouds = (/** @type {number} */ x, /** @type {number} */ y) => { const v = 0.55 * (1 + 0.3 * Math.sin(x / 5) * Math.sin(y / 4)); return [v, v * 1.02, v * 1.08]; };
  const spread = (/** @type {number[]} */ px) => { const v = []; for (let y = 16; y < 48; y++) for (let x = 32; x < 224; x++) v.push(Math.log2(Math.max(1, at(px, W, x, y)))); const m = mean(v); return Math.sqrt(mean(v.map((q) => (q - m) ** 2))); };
  const base = await render(W, H, clouds, { Sharpness: 0 }), pulled = await render(W, H, clouds, { Highlights2012: -100, Sharpness: 0 });
  const kept = spread(pulled) / spread(base);
  console.log(`# clouds at Highlights −100: mean ${mean(pulled.filter((_, i) => i % 4 === 1)).toFixed(1)} from ${mean(base.filter((_, i) => i % 4 === 1)).toFixed(1)}, local contrast ×${kept.toFixed(2)}`);
  assert.ok(mean(pulled.filter((_, i) => i % 4 === 1)) < mean(base.filter((_, i) => i % 4 === 1)) - 8, 'the sky came down');
  assert.ok(kept > 0.85, `local contrast ×${kept.toFixed(2)}`);
});

test('Exposure +2 EV compresses into white rather than clipping, and keeps hue', { skip: live && 'local only' }, async () => {
  const W = 256, H = 8;
  const ramp = (/** @type {number} */ x, /** @type {number} */ y) => (y < 4 ? [x / 255, x / 255, x / 255] : [0.6, 0.18, 0.02].map((v) => v * (0.25 + x / 340)));
  const px = await render(W, H, ramp, { Exposure2012: 2, Sharpness: 0, ColorNoiseReduction: 0 });
  const grey = Array.from({ length: W }, (_, x) => at(px, W, x, 1));
  const firstWhite = grey.findIndex((v) => v >= 254);
  console.log(`# +2 EV ramp: reaches 254 at input ${(firstWhite / 255).toFixed(2)} (a hard clip would at 0.25), at 0.2 it is ${grey[51]}`);
  assert.ok(firstWhite > 90, `white from ${firstWhite}`);
  for (let x = 40; x < firstWhite; x += 8) assert.ok(grey[x + 8] > grey[x], `the ramp still rises at ${x}`);
  // the orange row: red stays the largest channel and green does not catch it up
  for (const x of [60, 160, 250]) {
    const [r, g, b] = [0, 1, 2].map((c) => at(px, W, x, 6, c));
    assert.ok(r > g + 30 && g > b, `orange at ${x}: ${r} ${g} ${b}`);
  }
});

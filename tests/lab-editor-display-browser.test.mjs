// How the photo is shown (frontend/lab/engine/present.js, proxy-hq.js): fitted, the canvas is the screen's own pixels and
// the frame is shrunk to them with a proper filter, so detail past the screen's limit is not folded back as false rings
// (a zone plate's ripple there was 16.5 of 255 when the browser did the shrinking); zoomed in, the canvas is the
// editing copy's size, so a pinch stays sharp; and once the sensor's pixels are on the GPU the editing copy is made
// again from them, with less false colour than the decoder's quick one (the known photo, against its truth).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { until } from './fixtures/waits.mjs';

const opts = { skip: Boolean(process.env.SITE_URL) && 'local only (a software GPU)', timeout: 300_000 };
let server, browser, base;
before(async () => {
  if (opts.skip) return;
  server = await serve(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const exe = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
  browser = await chromium.launch({ ...exe, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader'] });
});
after(async () => { await browser?.close(); server?.close(); });

test('fitted, the photo is shrunk to the screen\'s own pixels without false rings; zoomed, the canvas is the editing copy', opts, async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, serviceWorkers: 'block' });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/lab/editor/?readback`, { waitUntil: 'load' });
  await page.waitForSelector('#stage header');
  await page.evaluate(async () => {
    const W = 4800, H = 3200, c = new OffscreenCanvas(W, H), g = c.getContext('2d'), im = g.createImageData(W, H), d = im.data;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = Math.round(127.5 + 127.5 * Math.cos((Math.PI * ((x - W / 2) ** 2 + (y - H / 2) ** 2)) / W * 0.9)), i = (y * W + x) * 4; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
    g.putImageData(im, 0, 0);
    const store = await import('/lab/editor/app/store.js'), photo = await import('/lab/editor/app/session.js');
    await store.add([new File([await c.convertToBlob({ type: 'image/png' })], 'IMG_0013.jpg', { type: 'image/jpeg', lastModified: 1_700_000_000_000 })], () => {});
    await photo.open(store.photos()[0].id);
    document.dispatchEvent(new CustomEvent('editor:open', { detail: 'Edit' }));
  });
  const quiet = () => until(() => page.evaluate(async () => { const p = await import('/lab/editor/app/session.js'); return p.ready && !!p.whole() && !p.busy(); }), { timeout: 120_000, message: 'the photo is open and quiet' });
  await quiet(); await page.waitForTimeout(600); await quiet();
  const sized = () => page.evaluate(async () => { const p = await import('/lab/editor/app/session.js'), r = p.canvas.getBoundingClientRect(); return { cw: p.canvas.width, onScreen: Math.round(r.width * devicePixelRatio), copy: p.eng.size()[0] }; });
  const fitted = await sized();
  assert.equal(fitted.cw, fitted.onScreen, `fitted, the canvas is the screen's pixels (${JSON.stringify(fitted)})`);
  // the ripple left past the screen's limit, read off the canvas
  const ripple = await page.evaluate(async () => {
    const p = await import('/lab/editor/app/session.js'), c = p.canvas, d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, k = 4800 / c.width;
    let s = 0, s2 = 0, n = 0;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      const r = Math.hypot((x + 0.5) * k - 2400, (y + 0.5) * k - 1600), f = (0.9 * r / 4800) * k;
      if (f > 0.6 && f < 0.9 * 0.5 * k * 0.98) { const v = d[(y * c.width + x) * 4]; s += v; s2 += v * v; n++; }
    }
    return Math.sqrt(s2 / n - (s / n) ** 2);
  });
  assert.ok(ripple < 11, `little false ripple past the screen's limit (${ripple.toFixed(1)} of 255; the browser's own shrink left 16.5)`);
  await page.evaluate(async () => (await import('/lab/editor/app/zoom.js')).toggle());
  await until(async () => { const s = await sized(); return s.cw === s.copy; }, { timeout: 60_000, message: 'zoomed in, the canvas is the editing copy\'s size' });
  await page.evaluate(async () => (await import('/lab/editor/app/zoom.js')).toggle());
  await until(async () => { const s = await sized(); return s.cw === s.onScreen; }, { timeout: 60_000, message: 'fitted again, the screen\'s pixels' });
  assert.deepEqual(errors, []);
  await context.close();
});

test('the editing copy made again from the sensor has less false colour than the decoder\'s, against the known photo\'s truth', opts, async () => {
  const page = await browser.newPage({ serviceWorkers: 'block' });
  await page.goto(`${base}/lab/engine/?readback`, { waitUntil: 'load' });
  await page.waitForSelector('html[data-bench=ready]');
  const r = await page.evaluate(async () => {
    const { known, CAMERA } = await import('/lab/engine/known.js'), { engine } = await import('/lab/engine/gpu.js'), { full } = await import('/lab/engine/full.js');
    const N = 720, k = known(N), eng = await engine(document.createElement('canvas'), k, true), quick = k.proxy.slice(), big = await full(eng, k, k.mosaic.slice()), made = k.proxy;
    // the truth brought to the copy's size, each colour the mean of its 3 x 3, on the copy's scale
    const w = N / 3, err = (/** @type {Uint16Array} */ p) => { let e = 0, n = 0;
      for (let y = 8; y < w - 8; y++) for (let x = 8; x < w - 8; x++) {
        const t = [0, 0, 0]; for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) for (let c = 0; c < 3; c++) t[c] += k.truth[((y * 3 + j) * N + x * 3 + i) * 3 + c] / 9;
        const o = (y * w + x) * 4, v = [0, 1, 2].map((c) => p[o + c] / 65535);
        for (const c of [0, 2]) { const d = (v[c] * CAMERA.wb[c] - v[1]) - (t[c] * CAMERA.wb[c] - t[1]); e += d * d; n++; }
      }
      return Math.sqrt(e / n); };
    const out = { quick: err(quick), made: err(made), changed: made !== quick && made.some((v, i) => v !== quick[i]) };
    big?.dispose(); eng.dispose();
    return out;
  });
  assert.ok(r.changed, 'the copy was made again');
  assert.ok(r.made < r.quick * 0.9, `less false colour than the decoder's copy (${r.made.toFixed(4)} against ${r.quick.toFixed(4)})`);
});

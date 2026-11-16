// How the photo's editing copy is made (frontend/lab/engine/proxy-hq.js): once the sensor's pixels are on the GPU the
// copy is made again from them, with less false colour than the decoder's quick one and as sharp (the known photo,
// against its truth). (The fitted photo shrunk to the screen's pixels on the GPU, tried 2026-11-16, looked softer on
// the owner's phone than the browser's own shrink, and was taken out the same day.)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

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

test('the editing copy made again from the sensor has less false colour than the decoder\'s and is as sharp, against the known photo\'s truth', opts, async () => {
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
    // sharpness: the mean step in green from one pixel to the next, the copies' and the truth's brought to the copy's size
    const step = (/** @type {(x: number, y: number) => number} */ g) => { let t = 0, n = 0; for (let y = 8; y < w - 8; y++) for (let x = 8; x < w - 9; x++) { t += Math.abs(g(x + 1, y) - g(x, y)); n++; } return t / n; };
    const box = (x, y) => { let t = 0; for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) t += k.truth[((y * 3 + j) * N + x * 3 + i) * 3 + 1] / 9; return t; };
    const out = { quick: err(quick), made: err(made), changed: made !== quick && made.some((v, i) => v !== quick[i]), quickStep: step((x, y) => quick[(y * w + x) * 4 + 1] / 65535), step: step((x, y) => made[(y * w + x) * 4 + 1] / 65535), truthStep: step(box) };
    big?.dispose(); eng.dispose();
    return out;
  });
  assert.ok(r.changed, 'the copy was made again');
  assert.ok(r.made < r.quick * 0.9, `less false colour than the decoder's copy (${r.made.toFixed(4)} against ${r.quick.toFixed(4)})`);
  assert.ok(r.step >= r.quickStep * 0.98, `as sharp as the decoder's copy: the step from one pixel to the next ${r.step.toFixed(4)} against ${r.quickStep.toFixed(4)} (the truth's ${r.truthStep.toFixed(4)})`);
});

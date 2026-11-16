// A zoomed photo's edits (AUDIT.md P.1): from 100 % the full-size view covers the window, so an edit's frame draws that
// view alone and leaves the fitted photo under it; the fitted photo is drawn once edits rest, and is right then and once
// zoomed out. What is checked is the fitted photo's own canvas (the page runs with ?readback, so its pixels can be read):
// unchanged just after an edit's frame at 100 %, changed by the edit once it rests. The photo is a JPEG drawn by the
// test, on a software GPU, where a frame takes seconds: how fast it is on a phone is the phone's own log's to say.
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

test('at 100 % an edit draws the full-size view alone, and the fitted photo follows once edits rest and when zoomed out', opts, async () => {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true, serviceWorkers: 'block' });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/lab/editor/?readback`, { waitUntil: 'load' });
  await page.waitForSelector('#stage header');
  await page.evaluate(async () => {
    const c = new OffscreenCanvas(900, 600), g = c.getContext('2d');
    for (let y = 0; y < 600; y += 30) for (let x = 0; x < 900; x += 30) { g.fillStyle = `hsl(${(x / 900) * 360} 40% ${25 + (((x + y) / 30) % 2) * 20}%)`; g.fillRect(x, y, 30, 30); }
    const store = await import('/lab/editor/app/store.js'), photo = await import('/lab/editor/app/session.js');
    await store.add([new File([await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 })], 'IMG_0011.jpg', { type: 'image/jpeg', lastModified: 1_700_000_000_000 })], () => {});
    await photo.open(store.photos()[0].id);
    document.dispatchEvent(new CustomEvent('editor:open', { detail: 'Edit' }));
    for (let i = 0; i < 2400 && !(photo.ready && photo.whole() && !photo.busy()); i++) await new Promise((r) => setTimeout(r, 50));
  });
  // the fitted photo's mean brightness, read from its own canvas
  const fitted = () => page.evaluate(async () => { const p = await import('/lab/editor/app/session.js'), c = p.canvas, d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2]; return s / (d.length / 4) / 3; });
  const quiet = () => until(() => page.evaluate(async () => !(await import('/lab/editor/app/session.js')).busy()), { timeout: 120_000, message: 'the page is quiet' });
  await page.evaluate(async () => (await import('/lab/editor/app/zoom.js')).toggle());
  await until(() => page.evaluate(async () => { const z = await import('/lab/editor/app/zoom.js'), p = await import('/lab/editor/app/session.js'); return z.info().pct >= 100 && p.took.detail > 0 && !p.busy(); }), { timeout: 120_000, message: 'at 100 % with its full-size view' });
  const before = await fitted(), stamp = await page.evaluate(async () => (await import('/lab/editor/app/session.js')).stamp());
  // an edit at 100 %: its frame is the view's alone; the fitted photo is behind but the boards are told the edit changed
  const after1 = await page.evaluate(async () => {
    const p = await import('/lab/editor/app/session.js'), a = await import('/lab/editor/app/adjust.js');
    a.setValues({ Exposure: 1.5 }, 'Exposure', 'Exposure', '+1.5');
    while (p.busy()) await new Promise((r) => setTimeout(r, 5));
    const c = p.canvas, d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2];
    return { mean: s / (d.length / 4) / 3, stamp: p.stamp() };
  });
  assert.ok(Math.abs(after1.mean - before) < 0.5, `the fitted photo is not drawn under the view (${before.toFixed(1)} → ${after1.mean.toFixed(1)})`);
  assert.ok(after1.stamp > stamp, 'the boards are told the photo changed');
  // once edits rest, it is drawn: brighter by the edit
  await page.waitForTimeout(400); await quiet();
  const rested = await fitted();
  assert.ok(rested > before + 20, `the fitted photo follows once edits rest (${before.toFixed(1)} → ${rested.toFixed(1)})`);
  // zoomed out it is the same picture, and an edit there draws it at once
  await page.evaluate(async () => (await import('/lab/editor/app/zoom.js')).toggle()); await page.waitForTimeout(400); await quiet();
  assert.ok(Math.abs((await fitted()) - rested) < 0.5, 'zoomed out, the fitted photo is the edit');
  const fit2 = await page.evaluate(async () => {
    const p = await import('/lab/editor/app/session.js'), a = await import('/lab/editor/app/adjust.js');
    a.setValues({ Exposure: 0 }, 'Exposure', 'Exposure', '0');
    while (p.busy()) await new Promise((r) => setTimeout(r, 5));
    const c = p.canvas, d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2]; return s / (d.length / 4) / 3;
  });
  assert.ok(Math.abs(fit2 - before) < 1, `fitted, an edit draws the fitted photo in its own frame (${fit2.toFixed(1)} against ${before.toFixed(1)})`);
  assert.deepEqual(errors, []);
  await context.close();
});

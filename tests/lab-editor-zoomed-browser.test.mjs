// A zoomed photo's edits (the owner, 2026-11-16: "when the dial stops it can load the edit"): at 100 % an edit shows the
// editing copy at once, the full-size view laid over it hidden (a layer only shows for the edit it was made for), and
// the full-size view comes back once edits rest, the badge naming it under its beating dot meanwhile; zoomed out it is
// the same picture. What is checked is the fitted photo's own canvas (the page runs with ?readback, so its pixels can be
// read) and the zoom's layers. The photo is a JPEG drawn by the test, on a software GPU.
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

test('at 100 % an edit shows the copy at once, and the full-size view comes back once edits rest, named under the badge\'s dot; zoomed out it is the same picture', opts, async () => {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true, serviceWorkers: 'block' });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/lab/editor/?readback`, { waitUntil: 'load' });
  await page.waitForSelector('#stage header');
  await page.evaluate(async () => {
    // (large enough that fitted it is under the zoom's band of tiles, 37 % of its size: zoomed out the copy is the picture)
    const c = new OffscreenCanvas(1500, 1000), g = c.getContext('2d');
    for (let y = 0; y < 1000; y += 30) for (let x = 0; x < 1500; x += 30) { g.fillStyle = `hsl(${(x / 1500) * 360} 40% ${25 + (((x + y) / 30) % 2) * 20}%)`; g.fillRect(x, y, 30, 30); }
    const store = await import('/lab/editor/app/store.js'), photo = await import('/lab/editor/app/session.js');
    await store.add([new File([await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 })], 'IMG_0011.jpg', { type: 'image/jpeg', lastModified: 1_700_000_000_000 })], () => {});
    await photo.open(store.photos()[0].id);
    document.dispatchEvent(new CustomEvent('editor:open', { detail: 'Edit' }));
    for (let i = 0; i < 2400 && !(photo.ready && photo.whole() && !photo.busy()); i++) await new Promise((r) => setTimeout(r, 50));
    // what the badge says, as it says it
    const p = photo.canvas.parentElement?.parentElement?.querySelector('.glass'), said = (window.__said = []);
    new MutationObserver(() => { const n = p?.lastElementChild; if (n && n.textContent) said.push(`${n.textContent}|${p?.firstElementChild?.classList.contains('busy')}`); }).observe(/** @type {Node} */ (p), { subtree: true, childList: true, characterData: true, attributes: true });
  });
  // the fitted photo's mean brightness, read from its own canvas; whether the full-size view shows (the zoom's layers: the photo's canvas, the clipping, still, live, the network's)
  const fitted = () => page.evaluate(async () => { const p = await import('/lab/editor/app/session.js'), c = p.canvas, d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2]; return s / (d.length / 4) / 3; });
  const live = () => page.evaluate(async () => { const p = await import('/lab/editor/app/session.js'); return /** @type {HTMLElement} */ (p.canvas.parentElement?.children[3]).style.display === 'block'; });
  const quiet = () => until(() => page.evaluate(async () => !(await import('/lab/editor/app/session.js')).busy()), { timeout: 120_000, message: 'the page is quiet' });
  await page.evaluate(async () => (await import('/lab/editor/app/zoom.js')).toggle());
  await until(async () => (await live()) && (await page.evaluate(async () => { const z = await import('/lab/editor/app/zoom.js'), p = await import('/lab/editor/app/session.js'); return z.info().pct >= 100 && p.took.detail > 0 && !p.busy(); })), { timeout: 120_000, message: 'at 100 % with its full-size view' });
  const said = await page.evaluate(() => window.__said);
  assert.ok(said.includes('Loading full detail|true'), `the badge said what was loading, its dot beating (${said})`);
  const before = await fitted();
  // an edit at 100 %: the copy shows it at once, the full-size view of the photo as it was hidden
  const hidden = await page.evaluate(async () => {
    const p = await import('/lab/editor/app/session.js'), a = await import('/lab/editor/app/adjust.js'), L = /** @type {HTMLElement} */ (p.canvas.parentElement?.children[3]);
    a.setValues({ Exposure: 1.5 }, 'Exposure', 'Exposure', '+1.5'); await Promise.resolve(); await Promise.resolve();
    const at = L.style.display !== 'block';   // as the edit's frame begins (it may be made again once the edit rests, on a slow machine before the frame is read)
    while (p.busy()) await new Promise((r) => setTimeout(r, 5));
    return at;
  });
  const edited = await fitted();
  assert.ok(edited > before + 20, `the copy shows the edit at once (${before.toFixed(1)} → ${edited.toFixed(1)})`);
  assert.equal(hidden, true, 'the full-size view of the photo as it was is hidden as the edit is drawn');
  // once edits rest, the full-size view is made again
  await until(live, { timeout: 120_000, message: 'the full-size view comes back once edits rest' });
  // zoomed out it is the same picture
  await page.evaluate(async () => (await import('/lab/editor/app/zoom.js')).toggle()); await page.waitForTimeout(400); await quiet();
  await until(() => page.evaluate(async () => (await import('/lab/editor/app/zoom.js')).info().rest), { timeout: 120_000, message: 'the zoom rests' });   // (whatever it would make, made)
  assert.ok(Math.abs((await fitted()) - edited) < 0.5, 'zoomed out, the fitted photo is the edit');
  assert.equal(await page.evaluate(async () => !!(await import('/lab/editor/app/session.js')).canvas.parentElement?.querySelector('canvas.zl[style*="display: block"]')), false, 'and no full-size layer lies over it');
  assert.deepEqual(errors, []);
  await context.close();
});

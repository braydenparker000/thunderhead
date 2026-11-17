// A zoomed photo's edits (the owner, 2026-11-16: "when the dial stops it can load the edit"): at 100 % an edit shows the
// editing copy at once, the full-size view laid over it hidden (a layer only shows for the edit it was made for), and
// the full-size view comes back once edits rest, the badge naming it under its beating dot meanwhile; zoomed out it is
// the same picture. What is checked is the fitted photo's own canvas (the page runs with ?readback, so its pixels can be
// read) and the zoom's layers. And the full detail waits for the dial to come to rest, not for the finger to lift while it
// runs on (2026-11-17). The photo is a JPEG drawn by the test, on a software GPU.
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

/** The editor with a photo drawn by the test open on the Edit board, and what its zoom badge says kept as it says it. */
async function opened() {
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
  return { context, page, errors };
}
// the fitted photo's mean brightness, read from its own canvas; whether the full-size view shows (the zoom's layers: the photo's canvas, the clipping, still, live, the network's)
const fittedOf = (page) => page.evaluate(async () => { const p = await import('/lab/editor/app/session.js'), c = p.canvas, d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2]; return s / (d.length / 4) / 3; });
const liveOf = (page) => page.evaluate(async () => { const p = await import('/lab/editor/app/session.js'); return /** @type {HTMLElement} */ (p.canvas.parentElement?.children[3]).style.display === 'block'; });
const quietOf = (page) => until(() => page.evaluate(async () => !(await import('/lab/editor/app/session.js')).busy()), { timeout: 120_000, message: 'the page is quiet' });

test('at 100 % an edit shows the copy at once, and the full-size view comes back once edits rest, named under the badge\'s dot; zoomed out it is the same picture', opts, async () => {
  const { context, page, errors } = await opened();
  const fitted = () => fittedOf(page), live = () => liveOf(page), quiet = () => quietOf(page);
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

test('at 100 % the full detail waits for the dial to come to rest, not for the finger to lift while it runs on', opts, async () => {
  const { context, page, errors } = await opened(), live = () => liveOf(page);
  await page.evaluate(async () => (await import('/lab/editor/app/zoom.js')).toggle());
  await until(async () => (await live()) && (await page.evaluate(async () => { const z = await import('/lab/editor/app/zoom.js'), p = await import('/lab/editor/app/session.js'); return z.info().pct >= 100 && z.info().rest && !p.busy(); })), { timeout: 120_000, message: 'at 100 % with its full-size view' });
  // on the page's clock: each step the dial moves (its value as it shows it), and each time the full detail begins to be made
  await page.evaluate(async () => {
    const w = await import('/lab/engine/work.js'), log = (window.__log = []), dial = /** @type {Element} */ (document.querySelector('#stage [role=slider]')); let on = false;
    new MutationObserver(() => log.push(['dial', performance.now()])).observe(dial, { attributes: true, attributeFilter: ['aria-valuenow'] });
    w.onMaking(() => { const now = w.allMaking().includes('Loading full detail'); if (now && !on) log.push(['detail', performance.now()]); on = now; });
  });
  // the dial flicked: a quick swipe let go while moving, so it runs on, slowing (its events timed: 2.5 px a millisecond on any machine)
  const box = await page.locator('#stage [role=slider]').first().boundingBox(), y = box.y + box.height / 2, cdp = await context.newCDPSession(page);
  const t1 = Date.now() / 1000, at = (/** @type {number} */ i) => t1 + (i * 8) / 1000;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 120, y }], timestamp: at(0) });
  for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 120 + 20 * i, y }], timestamp: at(i) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: at(7) });
  const lifted = await page.evaluate(() => performance.now());
  await until(async () => (await live()) && (await page.evaluate(async () => { const z = await import('/lab/editor/app/zoom.js'), p = await import('/lab/editor/app/session.js'); return z.info().rest && !p.busy(); })), { timeout: 120_000, message: 'the full detail back once the dial rested' });
  const log = /** @type {[string, number][]} */ (await page.evaluate(() => window.__log)), moves = log.filter((e) => e[0] === 'dial').map((e) => e[1]), began = log.filter((e) => e[0] === 'detail').map((e) => e[1]);
  const last = Math.max(...moves);
  assert.ok(moves.some((t) => t > lifted + 30), 'the dial ran on after the finger lifted');
  assert.ok(began.length > 0 && began.every((t) => t >= last + 100), `the full detail began only once the dial had rested (${began.map((t) => Math.round(t - last))} ms after its last turn)`);
  assert.deepEqual(errors, []);
  await context.close();
});

// The new editor at /lab/editor/ under the fingers (frontend/lab/editor/app/haptic.js, fling.js, taps.js), driven by
// real touches: the ticks the phone is asked for (the dial passing its start and reaching an end, the drum's face
// clicking into place, Undo, an export done; none per pixel of a drag, none with the setting off or with less
// motion asked for); a zoomed photo flung glides on with only its transform changing, gives at the edge and rests
// inside, is stopped at once by a touch, and gets its detail once it rests; a double tap still zooms; two fingers
// tapped undo, three redo, while the end of a pinch, a tap on the controls and a finger already at work on Heal do
// nothing. The vibration is a stub on the page (a desktop browser does not buzz): what is asked of it is what is
// checked; how it feels is not. The photos are JPEGs drawn by the test, on a software GPU.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { timing, until } from './fixtures/waits.mjs';

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

/** The editor at a phone's size and touch, the vibration a stub that keeps what it is asked, and a W × H JPEG
 * drawn by the page open on the Edit board with its own pixels ready. */
async function opened(W = 1200, H = 800) {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true, serviceWorkers: 'block', acceptDownloads: true });
  await context.addInitScript(() => { window.BUZZ = []; Object.defineProperty(navigator, 'vibrate', { configurable: true, value: (p) => { window.BUZZ.push(p); return true; } }); });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/lab/editor/?readback`, { waitUntil: 'load' });
  await page.waitForSelector('#stage header');
  await page.evaluate(async ([W, H]) => {
    const c = new OffscreenCanvas(W, H), g = c.getContext('2d');
    for (let y = 0; y < H; y += 40) for (let x = 0; x < W; x += 40) { g.fillStyle = `hsl(${(x / W) * 360} 50% ${30 + (((x + y) / 40) % 2) * 25}%)`; g.fillRect(x, y, 40, 40); }
    const blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
    const store = await import('/lab/editor/app/store.js'), photo = await import('/lab/editor/app/session.js');
    await store.add([new File([blob], 'IMG_0009.jpg', { type: 'image/jpeg', lastModified: 1_700_000_000_000 })], () => {});
    await photo.open(store.photos()[0].id);
    document.dispatchEvent(new CustomEvent('editor:open', { detail: 'Edit' }));
    for (let i = 0; i < 2400 && !(photo.ready && photo.whole() && !photo.busy()); i++) await new Promise((r) => setTimeout(r, 50));
    if (!photo.whole()) throw new Error('the photo did not open');
  }, [W, H]);
  await page.waitForSelector('#stage [role=slider]');
  await page.waitForTimeout(400);
  return { context, page, errors, cdp: await context.newCDPSession(page) };
}
const buzz = (page) => page.evaluate(() => window.BUZZ.splice(0));
const told = (page) => page.evaluate(() => document.querySelector('#told')?.style.display !== 'none' ? document.querySelector('#told')?.textContent : '');
const at = (page) => page.evaluate(async () => (await import('/lab/editor/app/session.js')).history().at);
/** The photo's slot on screen: its middle, and the fitted photo's box. */
const slot = (page) => page.evaluate(async () => { const z = await import('/lab/editor/app/zoom.js'), b = document.querySelector('#stage [data-keep="photo"]').getBoundingClientRect(), f = z.fitted(); return { x: b.left + f.left + f.width / 2, y: b.top + f.top + f.height / 2, left: f.left }; });
/** Several fingers down at once and up again, `ms` later (CDP touch: pointer events of the touch kind). Each waits
 * for the page to finish drawing first: the software GPU holds the page while it draws, and a tap is a matter of ms. */
async function taps(cdp, points, ms = 60) {
  await until(() => cdp.send('Runtime.evaluate', { expression: 'import("/lab/editor/app/session.js").then((p) => !p.busy())', awaitPromise: true }).then((r) => r.result.value), { message: 'the page drew' });
  await new Promise((r) => setTimeout(r, 150));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points.map(([x, y], id) => ({ x, y, id })) });
  await new Promise((r) => setTimeout(r, ms));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

test('ticks: the dial past its start and at its end, the drum, Undo, an export; none with the setting off or less motion', opts, async () => {
  const { context, page, errors, cdp } = await opened(600, 400);
  const dial = page.locator('#stage [role=slider]').first(), box = await dial.boundingBox(), y = box.y + box.height / 2;
  assert.match(await dial.getAttribute('aria-label'), /Exposure/);
  // A finger turns the dial up from its start, then down past it: one tick, at the start, whatever the pixels between.
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y }] });
  for (let i = 1; i <= 12; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 200 + 8 * i, y }] });
  await page.waitForTimeout(80);
  for (let i = 1; i <= 24; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 296 - 8 * i, y }] });
  await page.waitForTimeout(80);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(300);
  assert.deepEqual(await buzz(page), [8], 'one tick, as the dial passed its start, and none for the 36 moves of the finger');
  // Back to its start, then all the way up by the keys: one tick, at the end.
  await dial.press('Home'); await page.waitForTimeout(200);
  await buzz(page);
  for (let i = 0; i < 52; i++) await dial.press('ArrowRight');
  await page.waitForTimeout(100);
  assert.deepEqual(await buzz(page), [14], 'one tick at the end of the range');
  // The drum: a new face clicking into place.
  await page.locator('#stage [role=listbox][aria-label^="Sections"]').press('ArrowDown'); await page.waitForTimeout(400);
  assert.deepEqual(await buzz(page), [8], 'the drum ticked as a face clicked into place');
  // The header's Undo.
  await page.locator('#stage [aria-label="Undo"]').first().click(); await page.waitForTimeout(100);
  assert.deepEqual(await buzz(page), [14], 'Undo ticked');
  // The setting off (Settings › Photos › Editor › Haptics), then the phone asking for less motion: nothing.
  await page.evaluate(() => localStorage.setItem('th.s.photos.haptics', 'false'));
  await page.locator('#stage [aria-label="Undo"]').first().click(); await page.waitForTimeout(100);
  await page.evaluate(() => localStorage.removeItem('th.s.photos.haptics'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('#stage [aria-label="Undo"]').first().click(); await page.waitForTimeout(100);
  assert.deepEqual(await buzz(page), [], 'no tick with the setting off or with less motion asked for');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  // No vibration in the browser at all: a tick is nothing, and nothing throws.
  assert.equal(await page.evaluate(async () => { const v = Object.getOwnPropertyDescriptor(navigator, 'vibrate'); delete navigator.vibrate; Object.defineProperty(Navigator.prototype, 'vibrate', { configurable: true, value: undefined }); const h = await import('/lab/editor/app/haptic.js'); await new Promise((r) => setTimeout(r, 60)); const got = h.tick('end'); Object.defineProperty(navigator, 'vibrate', v); return got; }), false);
  // An export done: a short double tick (one small file, so the software GPU is quick about it).
  await page.evaluate(async () => { const save = await import('/lab/editor/app/save.js'); save.keepPresets([{ ...save.START[0], on: false }, { ...save.START[1], size: '320', long: 320 }]); document.dispatchEvent(new CustomEvent('editor:open', { detail: 'Export' })); });
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: /^SAVE/ }).click();
  await page.waitForFunction(() => /Saved to Downloads|Not saved/.test(document.querySelector('#stage')?.textContent ?? ''), null, { timeout: 120_000 });
  assert.match((await page.locator('#stage').textContent()).replace(/\s+/g, ' '), /Saved to Downloads/);
  assert.deepEqual(await buzz(page), [[10, 70, 16]], 'the export done ticked twice');
  assert.deepEqual(errors, []);
  await context.close();
});

test('a zoomed photo flung glides with only its transform, gives at the edge, rests inside, and stops at a touch', opts, async () => {
  const { context, page, errors, cdp } = await opened();
  const s = await slot(page);
  // A double tap zooms in (and still does, with the fling there).
  await taps(cdp, [[s.x, s.y]], 30); await page.waitForTimeout(60); await taps(cdp, [[s.x, s.y]], 30);
  await until(() => page.evaluate(async () => (await import('/lab/editor/app/zoom.js')).info().on), { message: 'the double tap zoomed in' });
  await until(() => page.evaluate(async () => { const p = await import('/lab/editor/app/session.js'); return p.took.detail > 0 && !p.busy(); }), { timeout: 60_000, message: 'the zoomed photo rests' });
  // The page's frames from here: the transform, whether it glides, whether the engine draws, and every change the boards hear.
  await page.evaluate(async () => {
    const z = await import('/lab/editor/app/zoom.js'), fl = await import('/lab/editor/app/fling.js'), p = await import('/lab/editor/app/session.js');
    const log = (window.LOG = { f: [], changes: [] }); p.took.detail = 0;
    p.events.addEventListener('change', () => log.changes.push(performance.now()));
    const loop = (t) => { const m = /translate\(([-\d.e]+)px, ([-\d.e]+)px\)/.exec(z.transform()); log.f.push({ t, x: +m[1], glide: fl.gliding(), busy: p.busy(), stamp: p.stamp() }); if (window.LOG === log) requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  });
  // A quick drag to the right, far enough that the finger itself brings the photo to its edge, let go while moving.
  // Each event says when it happened (8 ms apart: 2.5 px a millisecond), so the speed is the same on any machine:
  // by the machine's own clock a slow one made the finger slow, and the glide stopped short of the edge.
  const t0 = Date.now() / 1000, at = (/** @type {number} */ i) => t0 + (i * 8) / 1000;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 60, y: s.y }], timestamp: at(0) });
  for (let i = 1; i <= 16; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 60 + 20 * i, y: s.y }], timestamp: at(i) });
  const lift = await page.evaluate(() => performance.now());
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: at(17) });
  await until(() => page.evaluate(async () => !(await import('/lab/editor/app/fling.js')).gliding() && window.LOG.f.some((f) => f.glide)), { message: 'the fling glided and came to rest' });
  await until(() => page.evaluate(async () => (await import('/lab/editor/app/session.js')).took.detail > 0), { timeout: 60_000, message: 'the detail was made where it rested' });
  const r = await page.evaluate(() => { const log = window.LOG; window.LOG = null; return log; });
  const glide = r.f.filter((f) => f.glide), gaps = glide.slice(1).map((f, i) => f.t - glide[i].t), worst = Math.max(0, ...gaps);
  const edge = -s.left, rest = r.f.at(-1).x, most = Math.max(...glide.map((f) => f.x)), end = glide.at(-1).t;
  console.log(`# fling: ${glide.length} frames gliding, worst ${worst.toFixed(1)} ms; past the edge by ${(most - edge).toFixed(1)} px, rests at ${rest.toFixed(2)} (edge ${edge.toFixed(2)})`);
  timing(worst <= 32, `a glide frame took ${worst.toFixed(1)} ms`);
  assert.ok(glide.length > 5, `the fling did not glide (${glide.length} frames)`);
  assert.ok(most > edge + 2, `the edge did not give: ${most} against ${edge}`);
  assert.ok(Math.abs(rest - edge) < 0.6, `it rests inside, at the edge: ${rest} against ${edge}`);
  assert.ok(glide.every((f) => !f.busy) && new Set(glide.map((f) => f.stamp)).size === 1, 'nothing was drawn while it glided');
  assert.ok(!r.changes.some((t) => t > lift && t <= end), 'the boards heard no change while it glided');
  assert.ok(r.changes.some((t) => t > end), 'the detail was made once it rested');
  // Flung again to the left, and touched while it glides: it stops at once, where it is.
  // (its events timed too: 1.5 px a millisecond on any machine)
  const t1 = Date.now() / 1000, then = (/** @type {number} */ i) => t1 + (i * 8) / 1000;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 320, y: s.y }], timestamp: then(0) });
  for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 320 - 12 * i, y: s.y }], timestamp: then(i) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: then(9) });
  await until(() => page.evaluate(async () => (await import('/lab/editor/app/fling.js')).gliding()), { message: 'the second fling glides' });
  await page.waitForTimeout(50);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: s.x, y: s.y }] });
  const stopped = await page.evaluate(async () => { const z = await import('/lab/editor/app/zoom.js'), fl = await import('/lab/editor/app/fling.js'), a = z.transform(); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); return { glide: fl.gliding(), same: a === z.transform() }; });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert.deepEqual(stopped, { glide: false, same: true }, 'a touch stops the glide at once');
  assert.deepEqual(errors, []);
  await context.close();
});

test('two fingers tapped undo, three redo; not the end of a pinch, not on the controls, not with Heal at work', opts, async () => {
  const { context, page, errors, cdp } = await opened(600, 400);
  await page.evaluate(async () => { const p = await import('/lab/editor/app/session.js'); p.turn('Exposure', 0.8); await p.draw(); });
  const s = await slot(page), top = await at(page);
  // Two fingers: back one step, said on the photo.
  await taps(cdp, [[s.x - 40, s.y], [s.x + 40, s.y]]);
  await until(async () => /Undid Exposure \+0\.80/.test(await told(page)), { message: 'two fingers undid a step' });
  assert.equal(await at(page), top - 1);
  // Three fingers: forward again.
  await taps(cdp, [[s.x - 60, s.y], [s.x, s.y + 30], [s.x + 60, s.y]]);
  await until(async () => /Redid Exposure \+0\.80/.test(await told(page)), { message: 'three fingers redid it' });
  assert.equal(await at(page), top);
  await taps(cdp, [[s.x - 60, s.y], [s.x, s.y + 30], [s.x + 60, s.y]]);
  await until(async () => /Nothing to redo/.test(await told(page)), { message: 'nothing ahead to redo' });
  // The end of a pinch is no tap; nor two fingers held too long, nor two on the dial.
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: s.x - 30, y: s.y, id: 0 }, { x: s.x + 30, y: s.y, id: 1 }] });
  for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: s.x - 30 - 8 * i, y: s.y, id: 0 }, { x: s.x + 30 + 8 * i, y: s.y, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await taps(cdp, [[s.x - 40, s.y], [s.x + 40, s.y]], 400);
  const dial = await page.locator('#stage [role=slider]').first().boundingBox(), dy = dial.y + dial.height / 2;
  await taps(cdp, [[150, dy], [260, dy]]);
  await page.waitForTimeout(400);
  assert.equal(await at(page), top, 'a pinch, a long hold and a tap on the dial took nothing back');
  // Heal: a finger already on the photo with its tool, then a second tapped: nothing taken back, no spot made.
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('editor:open', { detail: 'Heal' })));
  await page.waitForTimeout(600);
  const spots = () => page.evaluate(async () => (await import('/lab/editor/app/heal.js')).list().length);
  const h = await slot(page), before = await spots();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: h.x - 40, y: h.y, id: 0 }] });
  await page.waitForTimeout(200);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: h.x - 40, y: h.y, id: 0 }, { x: h.x + 40, y: h.y, id: 1 }] });
  await page.waitForTimeout(50);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(400);
  assert.equal(await at(page), top, 'Heal at work: nothing taken back');
  assert.equal(await spots(), before, 'and no spot made');
  // On Heal two fingers tapped together still undo.
  await taps(cdp, [[h.x - 40, h.y], [h.x + 40, h.y]]);
  await until(async () => /Undid/.test(await told(page)), { message: 'two fingers undo on Heal too' });
  assert.equal(await at(page), top - 1);
  assert.deepEqual(errors, []);
  await context.close();
});

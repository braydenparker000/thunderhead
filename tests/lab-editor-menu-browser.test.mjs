// The editor's sections and tools (the owner's design, 2026-11-18), under real touches: a board's panel swiped up or
// down slides to the next section or the one before (boards/Barrel.js), both sections in view as it goes, while a
// swipe sideways stays the panel's own (its value dial turns) and the curve keeps its own drags; a swipe
// that began on the value dial takes no tap from it. The tool dial in the corner (boards/ToolDial.js), held and turned
// held and slid up or down, a notch a tool and round the ring, opens the tool it is let go on (sideways turns nothing);
// tapped, it stays open to tap a tool; a tap outside shuts it; the keys step it; the Library has none. The photos are JPEGs drawn by the
// test, on a software GPU; the vibration is a stub that keeps what it is asked.
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

/** The editor at a phone's size and touch with a drawn JPEG open on Edit, and a finger (CDP touch). */
async function opened() {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true, serviceWorkers: 'block' });
  await context.addInitScript(() => { window.BUZZ = []; Object.defineProperty(navigator, 'vibrate', { configurable: true, value: (p) => { window.BUZZ.push(p); return true; } }); });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/lab/editor/?readback`, { waitUntil: 'load' });
  await page.waitForSelector('#stage header');
  await page.evaluate(async () => {
    const c = new OffscreenCanvas(900, 600), g = c.getContext('2d');
    for (let y = 0; y < 600; y += 40) for (let x = 0; x < 900; x += 40) { g.fillStyle = `hsl(${(x / 900) * 360} 50% ${30 + (((x + y) / 40) % 2) * 25}%)`; g.fillRect(x, y, 40, 40); }
    const store = await import('/lab/editor/app/store.js'), photo = await import('/lab/editor/app/session.js');
    await store.add([new File([await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 })], 'IMG_0011.jpg', { type: 'image/jpeg', lastModified: 1_700_000_000_000 })], () => {});
    await photo.open(store.photos()[0].id);
    document.dispatchEvent(new CustomEvent('editor:open', { detail: 'Edit' }));
    for (let i = 0; i < 2400 && !(photo.ready && photo.whole() && !photo.busy()); i++) await new Promise((r) => setTimeout(r, 50));
  });
  await page.waitForSelector('#stage [role=slider]');
  const cdp = await context.newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y]) => ({ x, y })) });
  /** A finger along these points, a frame apart, then lifted; `mid` runs once halfway. */
  const swipe = async (points, mid) => {
    await touch('touchStart', [points[0]]);
    for (let i = 1; i < points.length; i++) { await touch('touchMove', [points[i]]); await page.waitForTimeout(16); if (mid && i === Math.floor(points.length / 2)) await mid(); }
    await page.waitForTimeout(140);   // still: no flick
    await touch('touchEnd', []);
    await page.waitForFunction(() => !document.querySelector('#stage.rolling') && !document.querySelector('#tooldial [role=group][aria-hidden=false]'), null, { timeout: 20_000 });
    await page.waitForTimeout(200);
  };
  return { context, page, errors, touch, swipe };
}
const line = (x, y0, y1, n = 16) => Array.from({ length: n + 1 }, (_, i) => [x, y0 + ((y1 - y0) * i) / n]);
const section = (page) => page.evaluate(() => document.querySelector('#stage [role=listbox][aria-label^="Sections"]')?.getAttribute('aria-label').replace('Sections: ', ''));
const board = (page) => page.evaluate(() => document.getElementById('frame').dataset.board);
const exposure = (page) => page.evaluate(async () => (await import('/lab/editor/app/session.js')).text('Exposure'));

test('the panel slides: up or down a section, round, sideways the panel’s own, the curve its own', opts, async () => {
  const { context, page, errors, touch, swipe } = await opened();
  assert.equal(await section(page), 'Light');
  await page.evaluate(() => window.BUZZ.splice(0));
  // Up on the row: Curve comes up from below, both in view on the way, the photo still; one tick. Curve's panel is
  // taller: it grows once it rests, and the photo's room gives way then.
  const room = () => page.evaluate(() => Math.round(document.querySelector('#stage [data-room]').getBoundingClientRect().height));
  const room0 = await room();
  let mid = null;
  await swipe(line(150, 885, 745), async () => { mid = await page.evaluate(() => ({ plates: document.querySelectorAll('.plate').length, turned: getComputedStyle(document.querySelector('#stage .plate')).transform !== 'none', room: Math.round(document.querySelector('#stage [data-room]').getBoundingClientRect().height) })); });
  assert.deepEqual(mid, { plates: 2, turned: true, room: room0 }, 'halfway, the section going away is a copy, the panel itself slides, and the photo has not moved');
  assert.equal(await section(page), 'Curve');
  await until(async () => (await room()) < room0 - 100, { message: 'at rest the taller panel takes its room from the photo' });
  assert.deepEqual(await page.evaluate(() => window.BUZZ.splice(0)), [8], 'one tick as the section came round');
  assert.deepEqual(await page.evaluate(() => [document.querySelectorAll('.plate').length, getComputedStyle(document.querySelector('#stage .plate')).transform]), [1, 'none'], 'at rest: one panel, in its place');
  // A drag on the curve is the curve's.
  const curve = await page.locator('#stage [data-drag][role=group]').boundingBox();
  await swipe(line(curve.x + curve.width / 2, curve.y + curve.height * 0.8, curve.y + curve.height * 0.2));
  assert.equal(await section(page), 'Curve', 'the curve kept its drag');
  // Down from the key beside the curve: back to Light, the curve's point not lifted. Up on the row to Curve again,
  // and down on the row under it: a short swipe there is enough.
  const pts = () => page.evaluate(async () => JSON.stringify((await import('/lab/editor/app/session.js')).curve()));
  const was = await pts(), key = await page.locator('#stage [aria-label="Lift the point"]').boundingBox();
  await swipe(line(key.x + key.width / 2, key.y + 10, key.y + 100, 4));   // (a real swipe's first move is quick: here past the 8 px that tell a swipe at once, as a busy software GPU sends the next only when the last is handled)
  assert.equal(await section(page), 'Light', 'a swipe that began on the key is the panel\'s');
  assert.equal(await pts(), was, 'and lifted nothing');
  await swipe(line(150, 885, 745)); assert.equal(await section(page), 'Curve');
  await swipe(line(150, 862, 912));
  assert.equal(await section(page), 'Light', 'a short swipe on the row under the curve is enough');
  // Down again: round to Profile, the last, and up to Light.
  await swipe(line(150, 790, 912));
  assert.equal(await section(page), 'Profile', 'before the first section, the last');
  await swipe(line(150, 900, 780));
  assert.equal(await section(page), 'Light');
  // Begun on the value dial, a swipe up is the panel's: the value stays; twice quickly down there is no double tap.
  await page.evaluate(async () => { const p = await import('/lab/editor/app/session.js'); p.turn('Exposure', 0.5); await p.draw(); });
  const before = await exposure(page);
  const wheel = await page.locator('#stage [role=slider]').first().boundingBox(), wy = wheel.y + wheel.height / 2;
  await swipe(line(206, wy + 20, wy - 120));
  assert.equal(await section(page), 'Curve'); assert.equal(await exposure(page), before, 'the value dial did not turn');
  await page.locator('#stage [role=listbox][aria-label^="Sections"]').press('ArrowUp');
  await until(async () => (await section(page)) === 'Light' && !(await page.evaluate(() => !!document.querySelector('#stage.rolling'))), { message: 'the arrow key rolled it back' });
  for (let k = 0; k < 2; k++) { await touch('touchStart', [[206, wy - 10]]); for (let i = 1; i <= 3; i++) await touch('touchMove', [[206, wy - 10 + i * 9]]); await touch('touchEnd', []); await page.waitForTimeout(40); }
  await page.waitForFunction(() => !document.querySelector('#stage.rolling')); await page.waitForTimeout(300);
  assert.equal(await exposure(page), before, 'two swipes begun on the dial are not two taps (which put the value back)');
  assert.equal(await section(page), 'Light', 'short of a third of a section, it springs back');
  // Sideways on the wheel: the value dial turns, the section stays.
  await swipe(Array.from({ length: 13 }, (_, i) => [120 + i * 8, wy]));
  assert.notEqual(await exposure(page), before, 'sideways turned the value'); assert.equal(await section(page), 'Light');
  assert.deepEqual(errors, []);
  await context.close();
});

test('the tool dial: held and slid up or down a notch a tool, round the ring, tapped open, shut by a tap outside, the keys', opts, async () => {
  const { context, page, errors, touch, swipe } = await opened();
  const rest = page.locator('#tooldial button[aria-label^="Tools:"]');
  assert.match(await rest.getAttribute('aria-label'), /^Tools: Edit, Light\./);
  // Held and slid up a notch: the panel shows the tools going by, and Masks opens when let go.
  const slide = (dx, dy, n = 12) => Array.from({ length: n + 1 }, (_, i) => [384 + (dx * i) / n, 887 + (dy * i) / n]);
  let seen = '';
  await page.evaluate(() => window.BUZZ.splice(0));
  await swipe(slide(0, -50), async () => { seen = await page.evaluate(() => document.querySelector('#tooldial [aria-hidden=true] [style*="preserve-3d"]')?.textContent || ''); });
  assert.match(seen, /EDIT|MASKS/, 'the panel shows the tools going by, by name');
  assert.equal(await board(page), 'Masks');
  assert.ok((await page.evaluate(() => window.BUZZ.splice(0))).length >= 2, 'a tick on taking it and at the notch');
  await page.evaluate(() => history.back()); await until(async () => (await board(page)) === 'Edit', { message: 'back goes to the tool before' });
  // A short slide down: the one before. Then up five, from Crop: round the ring, past Versions, to Looks.
  await swipe(slide(0, 28, 6));
  assert.equal(await board(page), 'Crop', 'a little down is the tool before');
  await swipe(slide(0, -200, 24));
  assert.equal(await board(page), 'Looks', 'round the ring');
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('editor:open', { detail: 'Edit' }))); await until(async () => (await board(page)) === 'Edit', { message: 'back on Edit' });
  // Sideways turns nothing.
  await swipe(slide(-120, 0));
  assert.equal(await board(page), 'Edit', 'sideways turned nothing');
  // A tap: it stays open, a tap on a name opens that tool; tapped again and shut by a tap above, nothing changes.
  await touch('touchStart', [[384, 887]]); await page.waitForTimeout(60); await touch('touchEnd', []);
  await page.waitForSelector('#tooldial [role=group][aria-hidden=false]');
  await page.waitForTimeout(500);
  await page.locator('#tooldial button[aria-label="Crop"]').tap();
  await until(async () => (await board(page)) === 'Crop', { message: 'a tap on Crop opened it' });
  await page.waitForFunction(() => !document.querySelector('#tooldial [role=group][aria-hidden=false]'));
  await touch('touchStart', [[384, 887]]); await page.waitForTimeout(60); await touch('touchEnd', []);
  await page.waitForSelector('#tooldial [role=group][aria-hidden=false]'); await page.waitForTimeout(400);
  await page.touchscreen.tap(206, 200);
  await page.waitForFunction(() => !document.querySelector('#tooldial [role=group][aria-hidden=false]'));
  assert.equal(await board(page), 'Crop', 'shut without a choice');
  // The keys step it: on to Edit.
  await rest.press('ArrowDown'); await until(async () => (await board(page)) === 'Edit', { message: 'the arrow key stepped the dial' });
  // The Library has no tool dial.
  await page.locator('#stage [aria-label="Back to Photos"]').click();
  await until(async () => (await board(page)) === 'Library', { message: 'back to the Library' });
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#tooldial > div')).display), 'none');
  assert.deepEqual(errors, []);
  await context.close();
});

// The network in the new editor at /lab/editor/ (frontend/lab/engine/neural.js; engine/raw/ROADMAP.md milestone 3):
// zoomed to 100 % or closer (tried here at 200 %), what shows is made again by the network once the photo rests and laid over the live
// view; while a control moves the live view shows, and the network's picture comes back for the new edit. Needs
// the CC0 X-E5 sample (tests/photos-engine.test.mjs fetches it into the temp folder); skipped without it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

const RAF = join(tmpdir(), 'th-photos-engine-sample', 'xe5-8509.raf');
const opts = { skip: process.env.SITE_URL ? 'local only (a software GPU)' : !existsSync(RAF) && 'the sample RAF is not here', timeout: 900_000 };
let server, browser, base;
before(async () => {
  if (opts.skip) return;
  server = await serve(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const exe = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
  browser = await chromium.launch({ ...exe, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader'] });
});
after(async () => { await browser?.close(); server?.close(); });

test('at 200 % the network makes what shows, once the photo rests, and again after an edit; a finger that moves the photo meanwhile is answered at once', opts, async () => {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true, serviceWorkers: 'block' });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => { try { localStorage.setItem('th.s.photos.double_tap', '200'); } catch {} });
  await page.goto(`${base}/lab/editor/?readback`, { waitUntil: 'load' });
  await page.waitForSelector('#stage header');
  const ev = await page.evaluate(async (b64) => {
    const bin = atob(b64), a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    const store = await import('/lab/editor/app/store.js'), photo = await import('/lab/editor/app/session.js');
    await store.add([new File([a], 'DSCF8509.RAF')], () => {});
    await photo.open(store.photos()[0].id);
    document.dispatchEvent(new CustomEvent('editor:open', { detail: 'Edit' }));
    for (let i = 0; i < 3000 && !photo.whole(); i++) await new Promise((r) => setTimeout(r, 100));
    return photo.current().shotEv;
  }, readFileSync(RAF).toString('base64'));
  // the sample was shot with D-Range Priority: its RAF says the camera pushed it a stop more than usual, and so it opens (engine/exif.js `pushOf`)
  assert.equal(ev, 1.25);
  const fines = () => page.evaluate(() => JSON.parse(localStorage.getItem('th.editor.timings') || '[]').filter((t) => t.kind === 'fine'));
  const layers = () => page.evaluate(async () => {
    const zoom = await import('/lab/editor/app/zoom.js'), [, , , live, closer] = document.querySelector('.fillphoto').children;
    const px = (c) => c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const out = { pct: zoom.info().pct, shown: closer.style.display === 'block', size: [closer.width, closer.height], live: [live.width, live.height], mean: 0, light: 0 };
    if (out.shown) {   // the network's picture against the live view's middle, where both hold the same sensor pixels
      const a = px(closer), tmp = new OffscreenCanvas(closer.width, closer.height).getContext('2d');
      const r = (el) => el.getBoundingClientRect(), ra = r(closer), rl = r(live);
      tmp.drawImage(live, ((ra.left - rl.left) / rl.width) * live.width, ((ra.top - rl.top) / rl.height) * live.height, (ra.width / rl.width) * live.width, (ra.height / rl.height) * live.height, 0, 0, closer.width, closer.height);
      const b = tmp.getImageData(0, 0, closer.width, closer.height).data; let s = 0, l = 0;
      for (let i = 0; i < a.length; i += 4) for (let c = 0; c < 3; c++) { s += Math.abs(a[i + c] - b[i + c]); l += a[i + c]; }
      out.mean = s / ((a.length / 4) * 3); out.light = l / ((a.length / 4) * 3);
    }
    return out;
  });
  // a double tap on the photo: to 200 %
  // (a software GPU at work can hold the browser's second tap back by seconds, and two taps that far apart are not a
  // double tap: it is tapped again until the two land together)
  for (let i = 0; i < 4; i++) {
    await page.touchscreen.tap(206, 300); await page.touchscreen.tap(206, 300);
    await page.waitForTimeout(600);
    if (await page.evaluate(async () => (await import('/lab/editor/app/zoom.js')).info().pct === 200)) break;
    await page.waitForTimeout(2500);
  }
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('th.editor.timings') || '[]').some((t) => t.kind === 'fine'), null, { timeout: 420_000 });
  const first = await layers();
  assert.equal(first.pct, 200);
  assert.equal(first.shown, true, 'the network\'s picture is laid over the live view');
  assert.ok(first.size[0] > 100 && first.size[1] > 100 && first.size[0] <= first.live[0] && first.size[1] <= first.live[1], `it holds what shows and no more (${first.size} of ${first.live})`);
  assert.ok(first.light > 15, 'it is a picture');
  assert.ok(first.mean > 0.05 && first.mean < 8, `the same photo as the live view, a little apart (${first.mean.toFixed(2)} levels on average)`);
  assert.equal((await fines())[0].px, first.size[0] * first.size[1]);
  // an edit: the live view shows while the control moves, and the network's picture comes back for the new edit
  await page.evaluate(async () => { const photo = await import('/lab/editor/app/session.js'); photo.setValues({ Exposure: 0.7 }, 'Exposure', 'Exposure'); photo.draw(); });
  await page.waitForFunction(() => document.querySelector('.fillphoto').children[4].style.display === 'none', null, { timeout: 60_000, polling: 50 });   // the edit's first frame takes it away
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('th.editor.timings') || '[]').filter((t) => t.kind === 'fine').length > 1, null, { timeout: 420_000 });
  const second = await layers();
  assert.equal(second.shown, true);
  assert.ok(second.light > first.light + 5, 'and it comes back brighter by the edit');
  // It was made a part at a time (engine/net-pace.js, full.js `region`), so the page is drawn while it is made.
  const made = await fines();
  assert.ok(made.every((t) => t.parts > 10 && t.part > 0 && !t.left), `each of its pictures was made in many turns on the GPU (${JSON.stringify(made.map((t) => [t.parts, t.part]))})`);
  // A finger that moves the photo while a view is being made: the work is left at once, the gesture is noted, and
  // the picture is made for where the photo comes to rest. (The photo is first moved to a new place, so there is
  // real work to leave: an edit alone keeps the network's colours and only lays them out again.)
  const count = made.length, cdp = await context.newCDPSession(page);
  const touch = (type, x) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y: 300, id: 7 }] });
  const drag = async (from, to) => { await touch('touchStart', from); for (let i = 1; i <= 8; i++) { await touch('touchMove', from + ((to - from) * i) / 8); await new Promise((r) => setTimeout(r, 30)); } };
  await drag(206, 120); await touch('touchEnd', 0);
  // its views are being made for the new place, and have been for a second and a half: the network's long work is under way
  for (let on = 0, began = Date.now(); on < 15; on = (await page.evaluate(async () => (await import('/lab/editor/app/zoom.js')).info().making)) ? on + 1 : 0) { assert.ok(Date.now() - began < 120_000, 'a view is made after the photo is moved'); await new Promise((r) => setTimeout(r, 100)); }
  // a real touch, held down and moving for two seconds (the network takes far longer than that here)
  await touch('touchStart', 206);
  for (let i = 1; i <= 60; i++) { await touch('touchMove', 166 - 30 * Math.sin(i / 6)); await new Promise((r) => setTimeout(r, 30)); }
  const held = await page.evaluate(async () => ({ making: (await import('/lab/editor/app/zoom.js')).info().making, fines: JSON.parse(localStorage.getItem('th.editor.timings') || '[]').filter((t) => t.kind === 'fine' && !t.left).length }));
  assert.deepEqual(held, { making: false, fines: count }, 'with a finger on the photo no view is being made, and the one that was has not been finished behind it');
  await touch('touchEnd', 0);
  await page.waitForFunction((n) => { const t = JSON.parse(localStorage.getItem('th.editor.timings') || '[]'); return t.filter((x) => x.kind === 'fine' && !x.left).length > n && t.some((x) => x.kind === 'move' && x.busy === 1); }, count, { timeout: 420_000 });
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('th.editor.timings') || '[]')), move = after.filter((t) => t.kind === 'move' && t.busy === 1).at(-1);
  assert.ok(move.frames > 6 && move.worst > 0 && move.busy === 1, `the gesture is noted, and that a view was being made when it began (${JSON.stringify(move)})`);
  assert.equal((await layers()).shown, true, 'and the picture is made where the photo came to rest');
  assert.deepEqual(errors, []);
  await context.close();
});

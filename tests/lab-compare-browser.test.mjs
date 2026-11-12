// The compare page (/lab/editor/compare/) on a GPU: a photo from the editor's Library made by each method, a tile
// at a time, each tile once. A JPEG has no sensor data, so Classic, Faster and Network make the same picture and
// there is no camera JPEG to set beside them: enough to see the page work. The picture here is drawn by the test.
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

test('each method is made once per tile; switching, zooming and the toggles draw nothing new', opts, async () => {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true, serviceWorkers: 'block' });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // with no photo asked for, the Library's photos to pick from (none yet)
  await page.goto(`${base}/lab/editor/compare/?readback`, { waitUntil: 'load' });
  await page.waitForFunction(() => /No photos|Pick a photo/.test(document.getElementById('status').textContent));
  const { id, png } = await page.evaluate(async () => {
    const draw = async (W, H, type, hue) => {
      const c = new OffscreenCanvas(W, H), g = c.getContext('2d'), sky = g.createLinearGradient(0, 0, W, H);
      sky.addColorStop(0, '#102040'); sky.addColorStop(0.5, hue); sky.addColorStop(1, '#f0f0e0'); g.fillStyle = sky; g.fillRect(0, 0, W, H);
      ['#d02020', '#20a040', '#2040d0', '#e0d020'].forEach((col, i) => { g.fillStyle = col; g.fillRect(40 + i * 220, 60, 160, 160); });
      return c.convertToBlob({ type, quality: 0.95 });
    };
    const store = await import('/lab/editor/app/store.js');
    await store.init();
    await store.add([new File([await draw(996, 660, 'image/jpeg', '#c08040')], 'IMG_0042.jpg', { type: 'image/jpeg', lastModified: 1_700_000_000_000 })], () => {});
    const other = new Uint8Array(await (await draw(498, 330, 'image/png', '#40c080')).arrayBuffer());
    let bin = ''; for (const b of other) bin += String.fromCharCode(b);
    return { id: store.photos()[0].id, png: btoa(bin) };
  });

  await page.goto(`${base}/lab/editor/compare/?open=${id}&readback`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__compare?.ready('classic'), null, { timeout: 180_000, polling: 200 });
  const chips = await page.$$eval('.chip', (cs) => cs.map((c) => ({ id: c.dataset.method, name: c.querySelector('.name').textContent, off: c.disabled })));
  assert.deepEqual(chips.map((c) => c.id), ['classic', 'faster', 'network'], 'no camera JPEG for a JPEG');
  const net = chips.find((c) => c.id === 'network');
  assert.ok(net.off ? net.name === 'Network (not on this GPU)' : net.name === 'Network', `the network's chip says what it is (${net.name})`);

  // Faster shows; a tap on the photo flips back to Classic
  await page.click('.chip[data-method="faster"]');
  assert.deepEqual(await page.evaluate(() => window.__compare.state()), { zoom: 1, shown: 'faster', a: 'faster', b: 'classic' });
  await page.touchscreen.tap(206, 250);
  assert.equal((await page.evaluate(() => window.__compare.state())).shown, 'classic');
  assert.equal(await page.$eval('.pane[data-method="classic"]', (p) => p.hidden), false);
  assert.equal(await page.$eval('.pane[data-method="faster"]', (p) => p.hidden), true);

  // every method that can be made is ready; zooming draws nothing new
  await page.waitForFunction((n) => window.__compare.ready('faster') && (n || window.__compare.ready('network')) && /Ready/.test(document.getElementById('status').textContent), net.off, { timeout: 180_000, polling: 200 });
  const made = await page.evaluate(() => window.__compare.renders);
  assert.equal(made, net.off ? 8 : 12, 'each of the photo\'s four tiles once per method');
  const transform = () => page.$eval('.pane[data-method="classic"] .layer', (l) => l.style.transform);
  await page.click('[data-zoom="2"]');
  assert.match(await transform(), /scale\(2\)/);
  await page.click('[data-zoom="3"]');
  assert.match(await transform(), /scale\(3\)/);
  assert.equal((await page.evaluate(() => window.__compare.state())).zoom, 3);
  await page.click('[data-zoom="1"]');
  assert.equal(await page.evaluate(() => window.__compare.renders), made, 'zooming made no tile');

  // Split and Difference toggle on and off
  await page.click('#split');
  assert.equal(await page.$eval('#divider', (d) => d.hidden), false);
  assert.match(await page.$eval('.pane[data-method="classic"]', (p) => p.style.clipPath), /inset/);
  await page.click('#split');
  await page.click('#diff');
  await page.waitForFunction(() => document.querySelectorAll('.pane[data-method="diff"] canvas').length === 4);
  assert.equal(await page.$eval('.pane[data-method="classic"]', (p) => p.hidden), true);
  await page.click('#diff');
  assert.equal(await page.$eval('.pane[data-method="diff"]', (p) => p.hidden), true);
  assert.equal(await page.evaluate(() => window.__compare.renders), made, 'nor did the toggles');

  // Blind: letters, no names; a pick keeps one mark with only its own fields, and names the pair
  await page.click('#blind');
  const blind = await page.$$eval('.chip .name', (ns) => ns.map((n) => n.textContent));
  assert.ok(blind.every((t) => /^[A-Z]$/.test(t)), `letters only (${blind})`);
  await page.click('#prefer');
  const marks = await page.evaluate(() => JSON.parse(localStorage.getItem('th.compare.marks')));
  assert.equal(marks.length, 1);
  assert.deepEqual(Object.keys(marks[0]).sort(), ['a', 'at', 'b', 'picked', 'x', 'y', 'zoom']);
  assert.deepEqual([marks[0].a, marks[0].b, marks[0].picked], ['faster', 'classic', 'classic']);
  assert.ok(!JSON.stringify(marks).includes('IMG_0042'), 'no photo name in a mark');
  assert.deepEqual(await page.$$eval('.chip .name', (ns) => ns.slice(0, 2).map((n) => n.textContent)), ['Classic', 'Faster'], 'the pair is named once picked');
  await page.click('#blind');

  // a picture added from a file is a method of its own, cut into the same tiles
  await page.setInputFiles('#file', { name: 'Sample-B.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await page.waitForFunction(() => window.__compare.ready('Sample-B'), null, { timeout: 60_000, polling: 100 });
  assert.equal(await page.$eval('.chip[data-method="file1"] .name', (n) => n.textContent), 'Sample-B');
  assert.equal(await page.evaluate(() => window.__compare.renders), made, 'a picture is cut, not rendered');
  // a file the browser cannot read is said so
  await page.setInputFiles('#file', { name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not a picture') });
  await page.waitForFunction(() => /cannot read that file/.test(document.getElementById('status').textContent));

  assert.deepEqual(errors, []);
  await context.close();
});

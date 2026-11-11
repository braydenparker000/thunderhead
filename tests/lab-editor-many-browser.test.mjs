// Export many, in the new editor at /lab/editor/ (frontend/lab/editor/app/save.js `saveMany`; engine/raw/ROADMAP.md
// stage 5): the Library's sheet exports every photo it is showing, each as it is edited, with the files the Export
// board has on, which are kept on this phone. Each photo is opened, developed from its own pixels and saved in
// turn. The photos are JPEGs drawn by the test, on a software GPU; the files are the browser's real downloads.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

const opts = { skip: Boolean(process.env.SITE_URL) && 'local only (a software GPU)', timeout: 240_000 };
let server, browser, base;
before(async () => {
  if (opts.skip) return;
  server = await serve(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const exe = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
  browser = await chromium.launch({ ...exe, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader'] });
});
after(async () => { await browser?.close(); server?.close(); });

test('the photos shown are exported one after another, with the files the Export board has on', opts, async () => {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true, serviceWorkers: 'block', acceptDownloads: true });
  const page = await context.newPage(), errors = [], saved = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('download', (d) => saved.push(d));
  await page.goto(`${base}/lab/editor/?readback`, { waitUntil: 'load' });
  await page.waitForSelector('#stage header');
  const files = await page.evaluate(() => Promise.all([['A.jpg', '#356'], ['B.jpg', '#653'], ['C.jpg', '#365']].map(async ([name, ink]) => {
    const c = new OffscreenCanvas(600, 420), g = c.getContext('2d'); g.fillStyle = ink; g.fillRect(0, 0, 600, 420); g.fillStyle = '#ddd'; g.fillRect(120, 90, 240, 180);
    return { name, bytes: [...new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 })).arrayBuffer())] };
  })));
  await page.getByRole('button', { name: 'Import' }).click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByText('Choose photos').click()]);
  await chooser.setFiles(files.map((f) => ({ name: f.name, mimeType: 'image/jpeg', buffer: Buffer.from(f.bytes) })));
  await page.waitForFunction(() => /Done · 3 photos copied/.test(document.querySelector('#stage')?.textContent ?? ''));
  // The files to save are the Export board's, kept on this phone: here the full one as a PNG, and the small one 300 wide.
  // B is edited and flagged; only the picks are shown, so only B goes.
  const b = await page.evaluate(async () => {
    const store = await import('/lab/editor/app/store.js'), photo = await import('/lab/editor/app/session.js'), save = await import('/lab/editor/app/save.js');
    const list = save.presets(); list[0].fmt = 'PNG'; list[1].size = 'Custom'; list[1].long = 300; save.keepPresets(list);
    const id = store.photos().find((p) => p.name === 'B.jpg').id;
    await photo.open(id); photo.setValues({ Exposure: 1 }, 'Exposure', 'Exposure'); await photo.draw(); await photo.saveNow();
    await store.update(id, { flag: 'pick' }); photo.changed();
    return id;
  });
  await page.getByRole('button', { name: 'Import' }).click();   // the sheet away, to choose what is shown
  await page.getByRole('button', { name: /PICKS/ }).click();
  await page.getByRole('button', { name: 'Import' }).click();
  await page.getByText('Export the photos shown').click();
  assert.match(await page.textContent('#stage'), /Full PNG and Small JPEG of each of the 1 photo shown \(Picks\), to Downloads/);
  await page.getByText('Export 1 photo? Tap again').click();
  await page.waitForFunction(() => /Done · 2 files from 1 photo in Downloads/.test(document.querySelector('#stage')?.textContent ?? ''), null, { timeout: 120_000 });
  assert.deepEqual(saved.map((d) => d.suggestedFilename()).sort(), ['B.png', 'B_small.jpg']);
  // Each file is the photo as edited, at its size: brighter than the file that came in.
  const sizes = await Promise.all(saved.map(async (d) => { const path = await d.path(); return page.evaluate(async (bytes) => { const bm = await createImageBitmap(new Blob([new Uint8Array(bytes)])); const g = new OffscreenCanvas(bm.width, bm.height).getContext('2d'); g.drawImage(bm, 0, 0); return [bm.width, bm.height, g.getImageData(5, 5, 1, 1).data[1]]; }, [...(await import('node:fs')).readFileSync(path)]); }));
  assert.deepEqual(sizes.map((s) => s.slice(0, 2)).sort((x, y) => x[0] - y[0]), [[300, 210], [600, 420]]);
  for (const s of sizes) assert.ok(s[2] > 0x55 + 30, `a stop brighter than the ground it was drawn with (${s[2]})`);
  // All three, with the photo that was open put back.
  await page.getByRole('button', { name: 'Import' }).click();
  await page.getByRole('button', { name: /^ALL/ }).click();
  await page.getByRole('button', { name: 'Import' }).click();
  await page.getByText('Export the photos shown').click();
  await page.getByText('Export 3 photos? Tap again').click();
  await page.waitForFunction(() => /Done · 6 files from 3 photos in Downloads/.test(document.querySelector('#stage')?.textContent ?? ''), null, { timeout: 150_000 });
  assert.deepEqual(saved.slice(2).map((d) => d.suggestedFilename()).sort(), ['A.png', 'A_small.jpg', 'B.png', 'B_small.jpg', 'C.png', 'C_small.jpg']);
  assert.equal(await page.evaluate(async () => (await import('/lab/editor/app/session.js')).current()?.id), b, 'the photo that was open is open again');
  assert.deepEqual(errors, []);
  await context.close();
});

// Four of the editor's smaller faults, each held (engine/raw/AUDIT.md): naming a look opens the editor's own sheet,
// never the browser's prompt box, and it stays up while the boards are drawn again (8.10); with less motion asked for,
// rows and tiles appear in place and the plate fades (8.11, as EDITOR.md says); and a decode that fails inside the decoder's thread sends the next request to a
// new thread, which works (2.1); and a frame that starts while the next photo is opening is waited for before the
// photo before is let go, never read back from memory already given up. The photos are JPEGs drawn by the test, on a software GPU.
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

/** The editor at a phone's size, a drawn JPEG open, on `board`. @param {string} board @param {'reduce' | 'no-preference'} [motion] */
async function opened(board, motion = 'no-preference') {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, serviceWorkers: 'block', reducedMotion: motion });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/lab/editor/?readback`, { waitUntil: 'load' });
  await page.waitForSelector('#stage header');
  await page.evaluate(async (board) => {
    const c = new OffscreenCanvas(600, 400), g = c.getContext('2d');
    for (let x = 0; x < 600; x += 20) { g.fillStyle = `hsl(${x * 0.6} 45% 45%)`; g.fillRect(x, 0, 20, 400); }
    const store = await import('/lab/editor/app/store.js'), photo = await import('/lab/editor/app/session.js');
    await store.add([new File([await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 })], 'IMG_0012.jpg', { type: 'image/jpeg', lastModified: 1_700_000_000_000 })], () => {});
    await photo.open(store.photos()[0].id);
    document.dispatchEvent(new CustomEvent('editor:open', { detail: board }));
    for (let i = 0; i < 2400 && !(photo.ready && !photo.busy()); i++) await new Promise((r) => setTimeout(r, 50));
  }, board);
  await page.waitForTimeout(300);
  return { context, page, errors };
}

test('naming a look opens the editor\'s own sheet, and the name it gives is kept', opts, async () => {
  const { context, page, errors } = await opened('Looks');
  await page.evaluate(() => { window.ASKED = 0; window.prompt = () => { window.ASKED++; return null; }; });
  await page.getByText('MINE', { exact: true }).first().dispatchEvent('click');   // the panel's barrel rolled to Mine (an option chosen, as a screen reader does)
  await page.waitForFunction(() => document.querySelector('#stage [role=listbox][aria-label^="Sections"]')?.getAttribute('aria-label') === 'Sections: Mine' && !document.querySelector('#stage.rolling'));
  await page.getByRole('button', { name: 'SAVE CURRENT' }).click();
  const sheet = page.getByRole('dialog', { name: 'Name this look' });
  await sheet.waitFor();
  // the photo changes under it (its full detail arrives, say): the boards are drawn again, and the sheet stays
  await page.evaluate(async () => { (await import('/lab/editor/app/session.js')).changed(); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); });
  assert.equal(await sheet.count(), 1, 'the sheet stays up while the boards are drawn again');
  await page.keyboard.press('End'); await page.keyboard.type(' warm'); await page.keyboard.press('Enter');
  await sheet.waitFor({ state: 'detached' });
  await until(() => page.evaluate(async () => (await import('/lab/editor/app/looks.js')).list('mine').some((l) => l.name === 'My look 1 warm')), { message: 'the look is kept under its name' });
  assert.equal(await page.evaluate(() => window.ASKED), 0, 'the browser\'s prompt box is never asked');
  // Cancel keeps nothing
  await page.getByRole('button', { name: 'SAVE CURRENT' }).click(); await sheet.waitFor();
  await sheet.getByRole('button', { name: 'CANCEL' }).click(); await sheet.waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(async () => (await import('/lab/editor/app/looks.js')).list('mine').length), 1);
  assert.deepEqual(errors, []);
  await context.close();
});

test('with less motion asked for, the plate fades in; otherwise it rises, and its row stands still either way', opts, async () => {
  const seen = {};
  for (const motion of /** @type {const} */ (['no-preference', 'reduce'])) {
    const { context, page, errors } = await opened('Edit', motion);
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('editor:open', { detail: 'Edit' })));
    seen[motion] = await page.evaluate(() => ({ row: [...new Set([...document.querySelectorAll('#stage .plate button.eng')].map((e) => getComputedStyle(e).animationName))], plate: getComputedStyle(document.querySelector('#stage .plate')).animationName }));
    assert.deepEqual(errors, []);
    await context.close();
  }
  assert.equal(seen['no-preference'].plate, 'rise', 'the plate rises as a rule');
  assert.equal(seen.reduce.plate, 'fade', 'with less motion it fades');
  for (const m of Object.values(seen)) assert.deepEqual(m.row, ['none'], 'the row stands still (a copy of the panel slides between sections, and must look the same: boards/Barrel.js)');
});

test('a decode that fails inside the decoder\'s thread sends the next request to a new thread, which works', opts, async () => {
  const context = await browser.newContext({ serviceWorkers: 'block' }), page = await context.newPage();
  await page.goto(`${base}/lab/editor/?readback`, { waitUntil: 'load' });
  const out = await page.evaluate(async () => {
    const W = window.Worker; let made = 0;
    window.Worker = class extends W { constructor(...a) { super(...a); made++; } };
    const d = await import('/lab/editor/app/decoder.js');
    const before = made;
    // a file that says it is a Fujifilm RAF and is not: the thread answers with an error
    const bad = new Uint8Array(4096); bad.set(new TextEncoder().encode('FUJIFILMCCD-RAW 0201FF383501'));
    const failed = await d.frame(bad.buffer).then(() => false, (e) => String(e.message || e));
    const after1 = made;
    const band = await d.jpegBand(new Uint8Array(16 * 16 * 3).fill(128), 16, 16, 90, false).then((b) => b.length, (e) => String(e));
    return { before, failed, after1, made, band };
  });
  assert.ok(out.failed, 'the bad file failed');
  assert.equal(out.made, out.after1 + 1, 'the next request started a new thread');
  assert.ok(typeof out.band === 'number' && out.band > 100, `the new thread answered (${out.band})`);
  await context.close();
});

test('a frame that starts while the next photo opens is waited for before the photo before is let go', opts, async () => {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true, serviceWorkers: 'block' }), page = await context.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/lab/editor/?readback`, { waitUntil: 'load' });
  await page.waitForSelector('#stage header');
  const rounds = await page.evaluate(async () => {
    const mk = async (name, hue) => { const c = new OffscreenCanvas(600, 400), g = c.getContext('2d'); g.fillStyle = `hsl(${hue} 50% 50%)`; g.fillRect(0, 0, 600, 400); return new File([await c.convertToBlob({ type: 'image/jpeg' })], name, { type: 'image/jpeg', lastModified: 1_700_000_000_000 + hue }); };
    const store = await import('/lab/editor/app/store.js'), p = await import('/lab/editor/app/session.js');
    await store.add([await mk('IMG_0021.jpg', 10), await mk('IMG_0022.jpg', 200)], () => {});
    const ids = store.photos().map((x) => x.id), calm = async () => { for (let i = 0; i < 2400 && !(p.ready && p.whole() && !p.busy()); i++) await new Promise((r) => setTimeout(r, 50)); };
    await p.open(ids[0]); await calm();
    for (let k = 1; k <= 3; k++) { const o = p.open(ids[k % 2]); p.draw(); await o; await calm(); }   // (before: each of these read a freed buffer)
    return 3;
  });
  await page.waitForTimeout(500);
  assert.equal(rounds, 3);
  assert.deepEqual(errors, [], 'no frame read memory its photo had given up');
  await context.close();
});

// Two ways the open photo was left worse off (the editor audit, 2026-11-28): pasting an edit on many photos ending on
// the open one left it opened quick, with no full-size pixels, so export and 100 % waited on it (app/clip.js
// `pasteOn`); and the page hidden while a photo was still opening wrote its edit before its first-open starts were
// set, so a photo never edited came back as edited, without its Auto and its noise start (app/session.js `saveNow`).
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

/** The editor with three small JPEGs in its Library. */
async function three() {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true, serviceWorkers: 'block' });
  const page = await context.newPage();
  await page.goto(`${base}/lab/editor/?readback`, { waitUntil: 'load' });
  await page.waitForSelector('#stage header');
  const files = await page.evaluate(() => Promise.all([['IMG_0101.jpg', '#356'], ['IMG_0102.jpg', '#653'], ['IMG_0103.jpg', '#365']].map(async ([name, ink]) => {
    const c = new OffscreenCanvas(300, 240), g = /** @type {OffscreenCanvasRenderingContext2D} */ (c.getContext('2d'));
    g.fillStyle = ink; g.fillRect(0, 0, 300, 240); g.fillStyle = '#ddd'; g.fillRect(60, 60, 120, 90);
    return { name, bytes: [...new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 })).arrayBuffer())] };
  })));
  await page.getByRole('button', { name: 'Import' }).click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByText('Choose photos').click()]);
  await chooser.setFiles(files.map((f) => ({ name: f.name, mimeType: 'image/jpeg', buffer: Buffer.from(f.bytes) })));
  await page.waitForFunction(() => /Done · 3 photos copied/.test(document.querySelector('#stage')?.textContent ?? ''));
  await page.getByRole('button', { name: 'Import' }).click();
  return { context, page };
}

test('pasting on many photos that end on the open one leaves it whole: its full-size pixels made, its export runs', opts, async () => {
  const { context, page } = await three();
  const r = await page.evaluate(async () => {
    const store = await import('/lab/editor/app/store.js'), photo = await import('/lab/editor/app/session.js'), clip = await import('/lab/editor/app/clip.js');
    const ids = store.photos().map((p) => p.id), last = ids[ids.length - 1];
    const whole = async () => { for (let i = 0; i < 300 && !photo.whole(); i++) await new Promise((res) => setTimeout(res, 100)); return !!photo.whole(); };
    await photo.open(last);
    const before = await whole();
    photo.setValues({ Exposure: 1 }, 'Exposure', 'Exposure'); await photo.draw();
    clip.copy();
    const pasted = await clip.pasteOn(ids, () => {});
    const after = await whole();
    const save = await import('/lab/editor/app/save.js');
    const err = await save.save(save.jobs(save.presets(), photo.current().name, photo.shape(), ''), () => {}).then(() => '', (e) => String(e.message));
    return { before, after, err, open: photo.current()?.id === last, pasted };
  });
  assert.equal(r.before, true);
  assert.equal(r.open, true, 'the photo that was open is the open one after');
  assert.equal(r.pasted.bad, 0);
  assert.equal(r.after, true, 'its full-size pixels are made again after the paste');
  assert.equal(r.err, '', `its export runs (${r.err})`);
  await context.close();
});

test('the page hidden while a photo opens writes nothing: a photo never edited still opens as new, with Auto', opts, async () => {
  const { context, page } = await three();
  const a = await page.evaluate(async () => {
    localStorage.setItem('th.s.photos.new_auto', 'true');
    const store = await import('/lab/editor/app/store.js'), photo = await import('/lab/editor/app/session.js');
    const ids = store.photos().map((p) => p.id), id = ids[0];
    photo.open(id);
    for (let k = 0; photo.current()?.id !== id && k < 500; k++) await new Promise((res) => setTimeout(res, 2));
    const readyAtSave = photo.ready;
    await photo.saveNow();   // what boot.js does when the page is hidden or goes
    return { id, other: ids[1], readyAtSave, saved: await store.loadEdit(id) };
  });
  assert.equal(a.readyAtSave, false, 'the save came while the photo was still opening');
  assert.ok(!a.saved || !Object.keys(a.saved).length, 'nothing is written for it then');
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#stage header');
  const steps = await page.evaluate(async ({ id, other }) => {
    const store = await import('/lab/editor/app/store.js'), photo = await import('/lab/editor/app/session.js');
    for (let i = 0; i < 100 && !store.photos().length; i++) await new Promise((res) => setTimeout(res, 50));
    const of = async (/** @type {string} */ x) => { await photo.open(x); return photo.history().steps.map((s) => s.name); };
    return { a: await of(id), control: await of(other) };
  }, a);
  assert.deepEqual(steps.a, steps.control, `it opens as a photo never opened does (${steps.a.join(', ')} against ${steps.control.join(', ')})`);
  assert.ok(steps.a.includes('Auto'), 'with Auto, as Settings asks for a new photo');
  await context.close();
});

// An edit copied from one photo and pasted on others, in the new editor at /lab/editor/
// (frontend/lab/editor/app/clip.js; engine/raw/ROADMAP.md stage 4). What goes across is the look of the picture:
// every adjustment, the profile, the curve, a look. What says where the picture is stays the photo's own: its
// crop, its spots, its masks. Pasting is a step of the photo's history, so Undo takes it off. From the Library
// the copied edit goes on every photo shown, each opened, saved and given its tile in turn. The photos are
// JPEGs drawn by the test (a JPEG can be made up; tests/lab-editor-jpeg-browser.test.mjs), on a software GPU.
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

test('an edit is copied, pasted on one photo as a step it can undo, and on many from the Library', opts, async () => {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true, serviceWorkers: 'block' });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/lab/editor/?readback`, { waitUntil: 'load' });
  await page.waitForSelector('#stage header');
  // Brought in through the Library's own picker, so the Library knows them.
  const files = await page.evaluate(() => Promise.all([['A.jpg', '#356'], ['B.jpg', '#653'], ['C.jpg', '#365']].map(async ([name, ink]) => {
    const c = new OffscreenCanvas(300, 240), g = c.getContext('2d'); g.fillStyle = ink; g.fillRect(0, 0, 300, 240); g.fillStyle = '#ddd'; g.fillRect(60, 60, 120, 90);
    return { name, bytes: [...new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 })).arrayBuffer())] };
  })));
  await page.getByRole('button', { name: 'Import' }).click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByText('Choose photos').click()]);
  await chooser.setFiles(files.map((f) => ({ name: f.name, mimeType: 'image/jpeg', buffer: Buffer.from(f.bytes) })));
  await page.waitForFunction(() => /Done · 3 photos copied/.test(document.querySelector('#stage')?.textContent ?? ''));
  await page.getByRole('button', { name: 'Import' }).click();
  const r = await page.evaluate(async () => {
    const store = await import('/lab/editor/app/store.js'), photo = await import('/lab/editor/app/session.js'), clip = await import('/lab/editor/app/clip.js');
    const [a, b, c] = ['A.jpg', 'B.jpg', 'C.jpg'].map((name) => store.photos().find((p) => p.name === name).id), out = { none: clip.held() };
    const green = async () => { const im = await photo.pixels(); let s = 0; for (let i = 1; i < im.data.length; i += 4) s += im.data[i]; return s / (im.data.length / 4); };
    // A: an edit with a crop; copied
    await photo.open(a);
    photo.setValues({ Exposure: 1, Contrast: 20 }, 'Exposure', 'Exposure'); photo.setGeo({ quarter: 0, flipH: false, flipV: false, angle: 0, vertical: 0, horizontal: 0, scale: 0, rect: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 }, aspect: 'Original', portrait: false });
    await photo.draw();
    out.copied = clip.copy()?.name;
    // B: pasted, as one step; its crop is its own; Undo takes it off
    await photo.open(b);
    const before = await green();
    out.pasted = clip.paste(); await photo.draw();
    out.b = { exposure: photo.value('Exposure'), contrast: photo.value('Contrast'), geo: photo.geo(), history: photo.history().steps.map((s) => s.name), brighter: (await green()) - before, again: clip.paste() };
    photo.undo(); await photo.draw();
    out.undone = [photo.value('Exposure'), photo.value('Contrast')];
    return { out, ids: [a, b, c] };
  });
  assert.equal(r.out.none, null, 'nothing is held until something is copied');
  assert.equal(r.out.copied, 'A.jpg');
  assert.equal(r.out.pasted, true);
  assert.deepEqual([r.out.b.exposure, r.out.b.contrast, r.out.b.geo], [1, 20, null], "the adjustments came across; A's crop did not");
  assert.deepEqual(r.out.b.history, ['Imported', 'Pasted · A']);
  assert.ok(r.out.b.brighter > 20, 'and the picture shows it');
  assert.equal(r.out.b.again, false, 'pasting what is on already is no step');
  assert.deepEqual(r.out.undone, [0, 0]);
  // From the Library: the Import sheet offers it for the photos shown, on a second tap.
  await page.getByRole('button', { name: 'Import' }).click();
  await page.getByText('Paste the copied edit').click();
  await page.getByText('Paste on 3 photos? Tap again').click();
  await page.waitForFunction(() => /Done · pasted on 3 photos/.test(document.querySelector('#stage')?.textContent ?? ''), null, { timeout: 120_000 });
  const kept = await page.evaluate(async ([a, b, c]) => {
    const store = await import('/lab/editor/app/store.js'), photo = await import('/lab/editor/app/session.js');
    const edits = await store.edits();
    return { open: photo.current()?.id === b, edits: [a, b, c].map((id) => [edits.get(id)?.Exposure, edits.get(id)?.Contrast, Boolean(edits.get(id)?.geo), edits.get(id)?.steps?.at(-1)?.name]),
      tiles: [a, b, c].map((id) => [store.photos().find((p) => p.id === id).edited, store.urlNow(id).startsWith('blob:')]) };
  }, r.ids);
  assert.equal(kept.open, true, 'the photo that was open is open again');
  assert.deepEqual(kept.edits, [[1, 20, true, 'Crop'], [1, 20, false, 'Pasted · A'], [1, 20, false, 'Pasted · A']], 'B and C took the edit; A, which had it, got no new step and kept its crop');
  assert.deepEqual(kept.tiles, [[true, true], [true, true], [true, true]], 'each has a tile of its edit');
  assert.deepEqual(errors, []);
  await context.close();
});

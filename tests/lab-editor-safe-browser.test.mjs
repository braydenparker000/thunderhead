// Keeping the owner's photos and edits safe in the new editor at /lab/editor/ (app/store.js, app/session.js,
// boot.js): a deleted photo leaves the Library and can be brought back with its edit for seven days, then goes
// for good, or at once when the deleted ones are emptied; picking a deleted photo again brings it back and does
// not copy it twice; an original left with no record is given one again, never deleted, and only what is no
// picture goes; an edit is written the moment the page is hidden; after the graphics chip is reset the photo
// opens again with its edit. The pictures here are drawn by the test.
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

/** The editor open on its Library, with two made-up JPEGs added. Returns the page and their ids. */
async function open() {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true, serviceWorkers: 'block' });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/lab/editor/?readback`, { waitUntil: 'load' });
  await page.waitForSelector('#stage header');
  const ids = await page.evaluate(async () => {
    const store = await import('/lab/editor/app/store.js');
    const make = async (name, colour, at) => { const c = new OffscreenCanvas(480, 320), g = c.getContext('2d'); g.fillStyle = colour; g.fillRect(0, 0, 480, 320); g.fillStyle = '#fff'; g.fillRect(60, 60, 120, 90); return new File([await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 })], name, { type: 'image/jpeg', lastModified: at }); };
    self.FILES = [await make('IMG_0001.jpg', '#204080', 1_700_000_000_000), await make('IMG_0002.jpg', '#806020', 1_700_000_100_000)];
    await store.add(self.FILES, () => {});
    return store.photos().map((p) => p.id);
  });
  return { context, page, errors, ids };
}

test('a deleted photo comes back with its edit for seven days, then goes; picked again, it is not copied twice', opts, async () => {
  const { context, page, errors, ids } = await open();
  const r = await page.evaluate(async ([a]) => {
    const store = await import('/lab/editor/app/store.js'), out = {};
    const files = async () => { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('raw'), n = []; for await (const [name] of d.entries()) n.push(name); return n.sort(); };
    await store.saveEdit(a, { Exposure: 0.5, v: 2 });
    await store.remove([a]);
    out.afterDelete = { shown: store.photos().length, deleted: store.deleted().map((p) => p.id), files: (await files()).length, edit: (await store.loadEdit(a))?.Exposure };
    await store.restore();
    out.afterRestore = { shown: store.photos().length, deleted: store.deleted().length, edit: (await store.loadEdit(a))?.Exposure, newestFirst: store.photos()[0].taken >= store.photos()[1].taken };
    // deleted, then picked again from the phone's files: back, not a second copy
    await store.remove([a]);
    out.again = await store.add([self.FILES.find((f) => f.name === store.deleted()[0].name)], () => {});
    out.afterAgain = { shown: store.photos().length, deleted: store.deleted().length, files: (await files()).length };
    // emptied: gone for good, file, record and edit
    await store.remove([a]); await store.empty();
    out.afterEmpty = { shown: store.photos().length, deleted: store.deleted().length, files: await files(), edit: (await store.loadEdit(a)) ?? null };
    // one deleted eight days ago goes at the next start; one deleted today stays
    const b = store.photos()[0].id;
    await store.remove([b]);
    await store.update(b, { deleted: Date.now() - 8 * 864e5 }).catch(() => {});   // (update only reaches photos in the Library: so the record is aged directly)
    out.keep = store.KEEP_DAYS;
    return out;
  }, ids);
  assert.deepEqual(r.afterDelete, { shown: 1, deleted: [ids[0]], files: 2, edit: 0.5 }, 'deleted: out of the Library, still on the phone with its edit');
  assert.deepEqual(r.afterRestore, { shown: 2, deleted: 0, edit: 0.5, newestFirst: true });
  assert.deepEqual(r.again, { added: 0, had: 1, bad: 0 });
  assert.deepEqual(r.afterAgain, { shown: 2, deleted: 0, files: 2 });
  assert.equal(r.afterEmpty.shown, 1); assert.equal(r.afterEmpty.deleted, 0); assert.equal(r.afterEmpty.files.length, 1); assert.equal(r.afterEmpty.edit, null);
  assert.equal(r.keep, 7);
  assert.deepEqual(errors, []);
  await context.close();
});

test('an original with no record is given one again, never deleted; what is no picture goes', opts, async () => {
  const { context, page, errors } = await open();
  const r = await page.evaluate(async () => {
    const store = await import('/lab/editor/app/store.js');
    const raw = await (await navigator.storage.getDirectory()).getDirectoryHandle('raw');
    const put = async (name, data) => { const w = await (await raw.getFileHandle(name, { create: true })).createWritable(); await w.write(data); await w.close(); };
    const names = async () => { const n = []; for await (const [name] of raw.entries()) n.push(name); return n.sort(); };
    // a whole picture with no record (its record lost), and a file that is no picture (a copy cut off)
    await put('11111111-2222-4333-8444-555555555555.jpg', self.FILES[0]);
    await put('99999999-2222-4333-8444-555555555555.jpg', new Blob(['not a picture']));
    const before = store.photos().length;
    const young = await store.sweep();   // under an hour old: left alone (another tab may be copying it)
    const mid = await names();
    const back = await store.sweep(0);
    const p = store.photos().find((x) => x.id === '11111111-2222-4333-8444-555555555555');
    return { before, young, kept: mid.length, back, after: store.photos().length, name: p?.name, kind: p?.kind, tile: store.urlNow(p?.id || '').startsWith('blob:'), left: await names() };
  });
  assert.deepEqual([r.before, r.young, r.kept], [2, 0, 4], 'a file under an hour old is left alone');
  assert.deepEqual([r.back, r.after], [1, 3], 'the original with no record is a photo in the Library again');
  assert.deepEqual([r.name, r.kind, r.tile], ['Recovered 11111111.jpg', 'jpeg', true]);
  assert.equal(r.left.includes('11111111-2222-4333-8444-555555555555.jpg'), true, 'its file is where it was');
  assert.equal(r.left.includes('99999999-2222-4333-8444-555555555555.jpg'), false, 'what is no picture is cleared');
  assert.deepEqual(errors, []);
  await context.close();
});

test('an edit is written the moment the page is hidden; after the graphics chip is reset the photo opens again with it', opts, async () => {
  const { context, page, errors, ids } = await open();
  const r = await page.evaluate(async ([a]) => {
    const store = await import('/lab/editor/app/store.js'), photo = await import('/lab/editor/app/session.js'), out = {};
    await photo.open(a);
    for (let i = 0; i < 400 && !photo.whole(); i++) await new Promise((res) => setTimeout(res, 50));
    photo.setValues({ Exposure: 0.8 }, 'Exposure', 'Exposure');
    out.atOnce = (await store.loadEdit(a))?.Exposure ?? null;   // the timer has not run yet
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    for (let i = 0; i < 100 && (await store.loadEdit(a))?.Exposure !== 0.8; i++) await new Promise((res) => setTimeout(res, 20));
    out.hidden = (await store.loadEdit(a))?.Exposure ?? null;
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    // the graphics chip is reset: the photo opens again by itself, with its edit
    const was = photo.whole();
    dispatchEvent(new Event('th-gpu-lost'));
    for (let i = 0; i < 600 && (!photo.whole() || photo.whole() === was); i++) await new Promise((res) => setTimeout(res, 50));
    out.again = { open: photo.current()?.id === a, anew: !!photo.whole() && photo.whole() !== was, exposure: photo.value('Exposure'), status: photo.current()?.status };
    return out;
  }, ids);
  assert.equal(r.atOnce, null, 'a change waits a moment before it is written');
  assert.equal(r.hidden, 0.8, 'hidden, it is written at once');
  assert.deepEqual(r.again, { open: true, anew: true, exposure: 0.8, status: '' });
  assert.deepEqual(errors, []);
  await context.close();
});

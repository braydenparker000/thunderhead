// A photo opened again shows the owner's own edit at once (frontend/lab/editor/app/kept-view.js): when an edit is
// kept, a picture of it the screen's size is kept beside its Library tile, and it shows in place of the camera's
// JPEG while the photo is developed again, only while it was made from the edit as saved now. Recorded frame by
// frame: the first picture under the photo's name is the kept one, some picture shows in every frame from then on,
// the developed picture takes its place without a jump and shows the same edit. An edit changed in another way
// shows the camera JPEG; deleting the photo takes its kept picture; a cropped photo's kept picture is cropped and
// sits where the developed one will. And Export many's Cancel. The photos are JPEGs drawn by the test, on a
// software GPU.
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

const S = '/lab/editor/app/session.js', ST = '/lab/editor/app/store.js', KV = '/lab/editor/app/kept-view.js';
/** The editor at an empty Library, a phone's size and touch. */
async function launch(more = {}) {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true, serviceWorkers: 'block', ...more });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/lab/editor/?readback`, { waitUntil: 'load' });
  await page.waitForSelector('#stage header');
  return { context, page, errors };
}
/** Made-up JPEGs, 900 × 600: a ground of `ink` with a light patch. */
const drawn = (page, list) => page.evaluate((list) => Promise.all(list.map(async ([name, ink]) => {
  const c = new OffscreenCanvas(900, 600), g = c.getContext('2d'); g.fillStyle = ink; g.fillRect(0, 0, 900, 600); g.fillStyle = '#c4b4a0'; g.fillRect(120, 120, 180, 120);
  return { name, bytes: [...new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 })).arrayBuffer())] };
})), list);
async function bringIn(page, files) {
  await page.getByRole('button', { name: 'Import' }).click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByText('Choose photos', { exact: true }).click()]);
  await chooser.setFiles(files.map((f) => ({ name: f.name, mimeType: 'image/jpeg', buffer: Buffer.from(f.bytes) })));
  await page.waitForFunction((n) => new RegExp(`Done · ${n} photos? copied`).test(document.querySelector('#stage')?.textContent ?? ''), files.length);
  await page.touchscreen.tap(206, 600);
  await page.waitForSelector('#stage [role=dialog]', { state: 'detached' });
}
const tapOn = async (page, selector) => { const b = await page.locator(selector).first().boundingBox(); await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); };
/** Until the photo `name` is open and ready (the photo before was ready too, until the new one is under way). */
const ready = (page, name) => until(() => page.evaluate(async ([S, name]) => { const p = await import(S); return p.current()?.name === name && p.ready && !p.busy() && !!p.whole(); }, [S, name]), { timeout: 120_000, message: `${name} opens` });
const idOf = (page, name) => page.evaluate(async ([ST, name]) => (await import(ST)).photos().find((p) => p.name === name)?.id, [ST, name]);
/** Opens a photo from the Library by a tap on its tile, recording every frame from the tap until it is ready. */
async function openRecorded(page, stem) {
  await page.evaluate(async (S) => {
    const p = await import(S), probe = new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true });
    window.FRAMES = []; window.REC = true;
    const tick = () => {
      const w = document.querySelector('#frame > div:first-child > .fillphoto'), el = w?.firstElementChild, r = el?.getBoundingClientRect();
      const on = !!el && r.width > 0 && r.height > 0 && getComputedStyle(w.parentElement).display !== 'none' && (el.tagName === 'CANVAS' ? el.width > 0 : el.complete && el.naturalWidth > 0);
      let px = null;
      if (on) { const [W, H] = el.tagName === 'CANVAS' ? [el.width, el.height] : [el.naturalWidth, el.naturalHeight]; probe.drawImage(el, Math.floor(W * 0.75), Math.floor(H * 0.75), 1, 1, 0, 0, 1, 1); px = [...probe.getImageData(0, 0, 1, 1).data.slice(0, 3)]; }
      window.FRAMES.push({ name: p.current()?.name || '', tag: el?.tagName || '', src: el?.tagName === 'IMG' ? el.src : '', on, px, box: on ? [r.left, r.top, r.width, r.height] : null, nat: on && el.tagName === 'IMG' ? [el.naturalWidth, el.naturalHeight] : null, drawn: p.took.open > 0 });
      if (window.REC) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, S);
  await tapOn(page, `#stage .vscroll button[aria-label="${stem}"]`);
  await ready(page, `${stem}.jpg`);
  // the photo is ready in the task that puts its picture on: two frames are let pass before the record is read
  return page.evaluate(async () => { await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); window.REC = false; return window.FRAMES; });
}
/** A pixel of a picture (three quarters across and down, on the ground): of its blob, or its URL. */
const sampleOf = (page, how) => page.evaluate(async ([ST, how]) => {
  const store = await import(ST), blob = how.view ? await store.viewFile(how.view) : null, bm = new Image();   // (the page's rules let it fetch no blob: URL, so the camera JPEG is read as a picture)
  if (how.view && !blob) return null;
  bm.src = blob ? URL.createObjectURL(blob) : await store.jpegUrl(how.jpeg); await bm.decode();
  const g = new OffscreenCanvas(1, 1).getContext('2d');
  g.drawImage(bm, Math.floor(bm.naturalWidth * 0.75), Math.floor(bm.naturalHeight * 0.75), 1, 1, 0, 0, 1, 1);
  return { px: [...g.getImageData(0, 0, 1, 1).data.slice(0, 3)], size: [bm.naturalWidth, bm.naturalHeight], bytes: blob?.size || 0 };
}, [ST, how]);
const far = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
/** Edits the open photo strongly (brighter, no colour), optionally crops it, and waits until its kept picture is made from that edit. */
async function editAndKeep(page, id, geo = null) {
  await page.evaluate(async ([S, geo]) => { const p = await import(S); p.setValues({ Exposure: 1.5, Saturation: -100 }, '', 'Exposure and Saturation'); if (geo) p.setGeo(geo); await p.draw(); }, [S, geo]);
  await until(() => page.evaluate(async ([ST, KV, id]) => { const store = await import(ST), kv = await import(KV), v = store.photos().find((p) => p.id === id)?.view; return !!v && v === kv.stampOf(await store.loadEdit(id)) && !!(await store.viewFile(id)); }, [ST, KV, id]), { timeout: 30_000, message: 'the kept picture is made from the edit' });
}
const lastOpen = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('th.editor.timings') || '[]').filter((t) => t.kind === 'open').at(-1));
/** What the frames say of an open: the first picture under the name, whether a frame showed nothing after it, the box at the swap. */
function read(frames, name) {
  const mine = frames.filter((f) => f.name === name), at = mine.findIndex((f) => f.on), from = at < 0 ? [] : mine.slice(at);
  const swap = from.findIndex((f) => f.tag === 'CANVAS');
  return { first: mine[at], blank: from.filter((f) => !f.on).length, imgs: from.filter((f) => f.tag === 'IMG'), lastImg: from[swap - 1], firstCanvas: from[swap], end: from.at(-1), swap };
}

test('a photo opened again shows its own edit at once, then the developed picture takes its place', opts, async () => {
  const { context, page, errors } = await launch();
  await bringIn(page, await drawn(page, [['IMG_0001.jpg', '#2a5a9a'], ['IMG_0002.jpg', '#9a5a2a']]));
  const id = await idOf(page, 'IMG_0001.jpg');
  await tapOn(page, '#stage .vscroll button[aria-label="IMG_0001"]');
  await ready(page, 'IMG_0001.jpg');
  await editAndKeep(page, id);
  const camera = await sampleOf(page, { jpeg: id }), kept = await sampleOf(page, { view: id });
  const shape = await page.evaluate(async (S) => { const p = await import(S); return [p.canvas.width, p.canvas.height]; }, S);
  console.log(`# kept picture: ${kept.size.join(' × ')}, ${kept.bytes} bytes; the editing copy ${shape.join(' × ')}`);
  assert.equal(kept.size[0] / kept.size[1], shape[0] / shape[1], 'the kept picture is the editing copy\'s frame');
  assert.ok(Math.max(...kept.size) <= 1600);
  assert.ok(far(kept.px, camera.px) > 60, `the kept picture is the edit, not the camera JPEG (${kept.px} against ${camera.px})`);
  assert.ok(Math.max(...kept.px) - Math.min(...kept.px) < 12 && kept.px[0] > 120, `brighter and without colour (${kept.px})`);
  // The owner comes back later: the page is opened again, and the photo with it.
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#stage .vscroll button[aria-label="IMG_0001"]');
  const frames = await openRecorded(page, 'IMG_0001'), r = read(frames, 'IMG_0001.jpg');
  const cameraUrl = await page.evaluate(async ([ST, id]) => (await import(ST)).jpegUrl(id), [ST, id]);
  assert.ok(r.first, `a picture of the photo was seen: ${JSON.stringify(frames.slice(-3))}`);
  assert.equal(r.first.tag, 'IMG', 'the first picture is the kept one, put on before the photo is developed');
  assert.ok(far(r.first.px, kept.px) <= 6 && far(r.first.px, camera.px) > 60, `the first picture shown is the kept edit (${r.first.px}; kept ${kept.px}, camera ${camera.px})`);
  assert.ok(r.imgs.every((f) => f.src !== cameraUrl), 'the camera JPEG never shows');
  assert.equal(r.blank, 0, 'no frame without a picture from the first one on');
  assert.ok(r.swap > 0 && r.firstCanvas.drawn, 'then the developed picture, once its first frame is drawn');
  assert.ok(r.lastImg.box.every((v, i) => Math.abs(v - r.firstCanvas.box[i]) <= 1), `no jump at the swap (${r.lastImg.box} then ${r.firstCanvas.box})`);
  assert.ok(far(r.end.px, kept.px) <= 8, `the developed picture shows the same edit (${r.end.px}, kept ${kept.px})`);
  const t = await lastOpen(page);
  assert.equal(t.kept, 1, 'the open\'s timing says the kept picture showed');
  assert.ok(t.first > 0 && t.first <= t.ms, `and how long until the first picture (${t.first} of ${t.ms} ms)`);
  // Its edit as it was: Undo and the values came back with it.
  assert.deepEqual(await page.evaluate(async (S) => { const p = await import(S); return [p.value('Exposure'), p.value('Saturation')]; }, S), [1.5, -100]);
  assert.deepEqual(errors, []);
  await context.close();
});

test('a cropped photo, an edit changed in another way, and a deleted photo', opts, async () => {
  const { context, page, errors } = await launch();
  await bringIn(page, await drawn(page, [['IMG_0003.jpg', '#2a7a5a'], ['IMG_0004.jpg', '#7a2a5a']]));
  const id = await idOf(page, 'IMG_0003.jpg');
  await tapOn(page, '#stage .vscroll button[aria-label="IMG_0003"]');
  await ready(page, 'IMG_0003.jpg');
  // Cropped to the lower right, longer than it is wide: the kept picture is that frame.
  await editAndKeep(page, id, { quarter: 0, flipH: false, flipV: false, angle: 0, vertical: 0, horizontal: 0, scale: 0, rect: { x: 0.6, y: 0.1, w: 0.4, h: 0.9 }, aspect: 'Free', portrait: false });
  const kept = await sampleOf(page, { view: id }), camera = await sampleOf(page, { jpeg: id }), shape = await page.evaluate(async (S) => { const p = await import(S); return [p.canvas.width, p.canvas.height]; }, S);
  assert.ok(kept.size[1] > kept.size[0], `the kept picture is cropped (${kept.size})`);
  assert.ok(Math.abs(kept.size[0] / kept.size[1] - shape[0] / shape[1]) < 0.01, `as the developed picture is (${kept.size}, ${shape})`);
  // Another photo, then back to this one in the same visit.
  await tapOn(page, '#stage [aria-label="Back to Photos"]');
  await tapOn(page, '#stage .vscroll button[aria-label="IMG_0004"]');
  await ready(page, 'IMG_0004.jpg');
  await tapOn(page, '#stage [aria-label="Back to Photos"]');
  let r = read(await openRecorded(page, 'IMG_0003'), 'IMG_0003.jpg');
  assert.equal(r.first.tag, 'IMG');
  assert.ok(far(r.first.px, kept.px) <= 6 && far(r.first.px, camera.px) > 60, `the cropped photo's kept picture shows first (${r.first.px})`);
  assert.equal(r.first.nat[1] > r.first.nat[0], true, 'cropped');
  assert.equal(r.blank, 0);
  assert.ok(r.swap > 0 && r.lastImg.box.every((v, i) => Math.abs(v - r.firstCanvas.box[i]) <= 1), `where the developed picture sits, at its size (${r.lastImg?.box} then ${r.firstCanvas?.box})`);
  assert.ok(far(r.end.px, kept.px) <= 8);
  // The edit changed in another way (here written straight to the phone's store, as another tab would): its kept
  // picture is no longer the edit, so the camera JPEG shows while it opens, and the new edit after.
  await tapOn(page, '#stage [aria-label="Back to Photos"]');
  await tapOn(page, '#stage .vscroll button[aria-label="IMG_0004"]');
  await ready(page, 'IMG_0004.jpg');
  await page.evaluate(async ([ST, id]) => { const store = await import(ST), e = await store.loadEdit(id); await store.saveEdit(id, { ...e, Exposure: -1, Saturation: 0, geo: null }); }, [ST, id]);
  await tapOn(page, '#stage [aria-label="Back to Photos"]');
  const cameraUrl = await page.evaluate(async ([ST, id]) => (await import(ST)).jpegUrl(id), [ST, id]);
  r = read(await openRecorded(page, 'IMG_0003'), 'IMG_0003.jpg');
  assert.ok(r.imgs.length === 0 || r.imgs.every((f) => f.src === cameraUrl), 'only the camera JPEG, never the kept picture of the old edit');
  assert.ok(r.imgs.every((f) => far(f.px, kept.px) > 60), 'no frame shows the old edit');
  assert.equal(r.blank, 0);
  assert.ok(far(r.end.px, kept.px) > 60 && Math.max(...r.end.px) < Math.max(...camera.px), `the developed picture is the new edit, darker (${r.end.px})`);
  assert.equal((await lastOpen(page)).kept, undefined, 'the timing does not say kept');
  // Deleted: its kept picture goes with it at once, and is not back with the photo.
  await tapOn(page, '#stage [aria-label="Back to Photos"]');
  const gone = await page.evaluate(async ([S, ST, id]) => {
    const store = await import(ST), photo = await import(S);
    photo.shut(); await store.remove([id]);
    const files = []; for await (const [name] of (await (await navigator.storage.getDirectory()).getDirectoryHandle('view')).entries()) files.push(name);
    const inBin = store.deleted().find((p) => p.id === id);
    await store.restore([id]);
    return { file: !!(await store.viewFile(id)), files, mark: inBin?.view ?? null, back: store.photos().find((p) => p.id === id)?.view ?? null };
  }, [S, ST, id]);
  assert.deepEqual(gone, { file: false, files: [], mark: null, back: null }, 'no kept picture left on the phone');
  assert.deepEqual(errors, []);
  await context.close();
});

test('Export many has a Cancel key: it stops, says what was saved, and the Library is ready again', opts, async () => {
  const { context, page, errors } = await launch({ acceptDownloads: true });
  const saved = [];
  page.on('download', (d) => saved.push(d));
  await bringIn(page, await drawn(page, [['A.jpg', '#356'], ['B.jpg', '#653'], ['C.jpg', '#365']]));
  await page.evaluate(async () => { const save = await import('/lab/editor/app/save.js'), list = save.presets(); list[0].fmt = 'PNG'; list[1].on = false; save.keepPresets(list); });
  await page.getByRole('button', { name: 'Import' }).click();
  await page.getByText('Export the photos shown').click();
  await page.getByText('Export 3 photos? Tap again').click();
  // Cancel while the second photo is in hand: its file is given up, the third never starts.
  await page.waitForFunction(() => /1 \/ 3/.test(document.querySelector('#stage [role=status]')?.textContent ?? ''), null, { timeout: 120_000 });
  const key = await page.getByRole('button', { name: 'Cancel the export' }).boundingBox();
  const hit = await page.evaluate(([x, y]) => [[0, -21.5], [0, 21.5]].every(([dx, dy]) => !!document.elementFromPoint(x + dx, y + dy)?.closest('[aria-label="Cancel the export"]')), [key.x + key.width / 2, key.y + key.height / 2]);
  assert.ok(hit && key.width >= 44, `the Cancel key takes a 44 px finger (${key.width} × ${key.height} drawn)`);
  await page.touchscreen.tap(key.x + key.width / 2, key.y + key.height / 2);
  await page.waitForFunction(() => /Export cancelled/.test(document.querySelector('#stage [role=status]')?.textContent ?? ''), null, { timeout: 60_000 });
  await page.waitForTimeout(1500);   // a download the browser had would have reached the test by now
  const said = await page.evaluate(() => document.querySelector('#stage [role=status]').textContent.replace(/\s+/g, ' '));
  assert.ok(saved.length < 3, `fewer than three files (${saved.length})`);
  assert.match(said, saved.length ? new RegExp(`Export cancelled · ${saved.length} files? from ${saved.length} photos? in Downloads`) : /Export cancelled · nothing was saved/, `it says what was saved (${said})`);
  assert.equal(await page.getByRole('button', { name: 'Cancel the export' }).count(), 0, 'the key goes when it has stopped');
  // Ready again: the next Export many runs to its end.
  const had = saved.length;
  await page.getByText('Export the photos shown').click();
  await page.getByText('Export 3 photos? Tap again').click();
  await page.waitForFunction(() => /Done · 3 files from 3 photos in Downloads/.test(document.querySelector('#stage')?.textContent ?? ''), null, { timeout: 150_000 });
  await until(() => saved.length === had + 3, { message: 'the three downloads reached the test' });
  assert.deepEqual(saved.slice(had).map((d) => d.suggestedFilename()).sort(), ['A.png', 'B.png', 'C.png']);
  assert.deepEqual(errors, []);
  await context.close();
});

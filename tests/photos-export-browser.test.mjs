// The editor's second half in Chromium (PHOTOS.md, Crop and geometry, Versions, Export), against a mock
// API and a fake Drive, on a synthetic JPEG drawn in the page: crop and rotate change the render; a
// version made, compared with an automatic one and restored; an export produced, a valid JPEG whose
// XMP carries the recipe's keys; at 390×844 and on the A35-sized profile. With the CC0 X-E5 sample
// downloaded (tests/photos-engine.test.mjs), its export at 2,048 px and full size is timed. Where it
// goes, on three faked platforms: a save dialog (desktop), Downloads only (Android, an installed app
// that drops a second download started at once), and the share sheet offered for a batch.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { until } from './fixtures/waits.mjs';
import { findXmp, recipeOfXmp } from '../frontend/apps/photos/edit/xmp.js';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (mocked API)' };
const TOKEN = `th1_${'P'.repeat(43)}abcdef`;
const ID = '0192aaaa-bbbb-7ccc-8ddd-eeeeffff0001';
const SHOTS = process.env.TH_SHOTS;
const state = { recipe: {}, puts: [], senses: [], versions: [], posts: [], jpeg: Buffer.alloc(0), preview: Buffer.alloc(0), raf: null };
// The CC0 X-E5 sample tests/photos-engine.test.mjs downloads (never committed), when it is there.
const RAF = join(tmpdir(), 'th-photos-engine-sample', 'xe5-8509.raf');
const photo = () => ({ id: ID, drive_id: 'drive-file-9', ...(state.raf ? { name: 'DSCF0001.RAF', format: 'raf', bytes: state.raf.length, width: 7728, height: 5152 } : { name: 'IMG_0001.JPG', format: 'jpeg', bytes: state.jpeg.length, width: 1500, height: 1000 }), sha256: 'c'.repeat(64), camera: 'Example Camera', film: null, taken_at: Date.UTC(2026, 9, 3, 9), day: '2026-10-03', rating: 0, flag: null, preview: true, edited: Object.keys(state.recipe).length > 0, deleted_at: null, created_at: 1 });
let site, mock, browser, flat, base;

before(async () => {
  if (live) return;
  mock = createServer(async (req, res) => {
    const cors = { 'Access-Control-Allow-Origin': req.headers.origin ?? '', 'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, TH-Client', Vary: 'Origin' };
    if (req.method === 'OPTIONS') return res.writeHead(204, cors).end();
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks).toString();
    const json = (status, value) => res.writeHead(status, { ...cors, 'Content-Type': 'application/json' }).end(JSON.stringify(value));
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return json(401, { error: { code: 'unauthorized', message: 'x', request_id: '' } });
    const path = new URL(req.url, 'http://x').pathname;
    if (path.startsWith('/v1/senses/batches/')) { const { events } = JSON.parse(body); state.senses.push(...events); return json(200, { accepted: events.length, rejected: [] }); }
    if (path === '/v1/photos') return json(200, { days: [{ day: '2026-10-03', count: 1, photos: [photo()] }], next: null });
    if (path === '/v1/photos/upload-token') return json(200, { access_token: 'fake-drive-token', expires_at: Date.now() + 3e6, folder_id: 'folder-1' });
    if (path === '/v1/settings') return json(200, { 'owner.tz': 'UTC', min_client: 0 });
    if (path === `/v1/photos/${ID}/preview`) return res.writeHead(200, { ...cors, 'Content-Type': 'image/jpeg' }).end(state.preview);
    if (path === `/v1/photos/${ID}/recipe` && req.method === 'PUT') { state.recipe = JSON.parse(body).recipe; state.puts.push(state.recipe); return json(200, { photo: photo(), recipe: state.recipe, changed: true }); }
    if (path === `/v1/photos/${ID}/versions` && req.method === 'POST') { const b = JSON.parse(body); state.posts.push(b); const v = { id: b.id, kind: b.kind, name: b.kind === 'named' ? b.name : null, recipe: b.recipe, created_at: Date.now() }; state.versions.unshift(v); return json(201, { version: v, created: true }); }
    if (path === `/v1/photos/${ID}/versions`) return json(200, { items: state.versions });
    if (path === `/v1/photos/${ID}`) return json(200, { photo: photo(), recipe: state.recipe });
    json(404, { error: { code: 'not_found', message: 'x', request_id: '' } });
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  site = await serve(0, { api: `http://127.0.0.1:${mock.address().port}` });
  base = `http://127.0.0.1:${site.address().port}`;
  const exe = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
  browser = await chromium.launch({ ...exe, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader'] });
  flat = await chromium.launch({ ...exe, args: ['--disable-features=WebGPU'] });
  // The synthetic photo: colour bands, a grey ramp and soft circles, drawn by the browser and encoded as JPEG.
  const page = await browser.newPage();
  const draw = async (w, h) => Buffer.from(await page.evaluate(async ([w, h]) => {
    const c = new OffscreenCanvas(w, h), g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, w, 0);
    ['#c0392b', '#e67e22', '#f1c40f', '#27ae60', '#16a085', '#2980b9', '#8e44ad', '#d35480'].forEach((col, i) => grad.addColorStop(i / 7, col));
    g.fillStyle = grad; g.fillRect(0, 0, w, h * 0.6);
    const grey = g.createLinearGradient(0, 0, w, 0); grey.addColorStop(0, '#050505'); grey.addColorStop(1, '#fafafa');
    g.fillStyle = grey; g.fillRect(0, h * 0.6, w, h * 0.4);
    for (let i = 0; i < 6; i++) { g.fillStyle = `rgba(255,255,255,${0.15 + i * 0.1})`; g.beginPath(); g.arc(w * (0.12 + i * 0.15), h * 0.3, h * 0.08, 0, 7); g.fill(); }
    return [...new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 })).arrayBuffer())];
  }, [w, h]));
  state.jpeg = await draw(1500, 1000);
  state.preview = await draw(1024, 683);
  await page.close();
});
after(async () => { await browser?.close(); await flat?.close(); site?.close(); mock?.close(); });

// The platforms, faked before the page loads. Android: no save dialog, and a download started within
// 300 ms of the last is dropped, as an installed app may do; the other tests run as Android.
const android = () => {
  Object.assign(window, { showSaveFilePicker: undefined, showDirectoryPicker: undefined, clicks: [] });
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { const t = performance.now(), c = /** @type {any} */ (window).clicks; if (this.download && t - (c.at(-1) ?? -1e9) < 300) return; c.push(t); click.call(this); };
};
const picker = () => {
  const log = (/** @type {any} */ (window).saved = []);
  const handle = (name) => ({ createWritable: async () => ({ write: async (b) => log.push([name, ...new Uint8Array(await b.arrayBuffer()).slice(0, 2)]), close: async () => {} }) });
  Object.assign(window, { showSaveFilePicker: async (o) => { log.push(['dialog', o.suggestedName, navigator.userActivation.isActive]); return handle(o.suggestedName); }, showDirectoryPicker: async () => { log.push(['folder', '', navigator.userActivation.isActive]); return { getFileHandle: async (n) => handle(n) }; } });
};
const sharing = () => {
  Object.assign(window, { showSaveFilePicker: undefined, showDirectoryPicker: undefined });
  Object.assign(navigator, { canShare: (d) => Boolean(d?.files?.length), share: async (d) => { /** @type {any} */ (window).shared = d.files.map((f) => f.name); } });
};

async function open(b, path, device = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 }, platform = android) {
  const context = await b.newContext({ ...device, hasTouch: true });
  await context.addInitScript(platform);
  await context.route('https://www.googleapis.com/drive/v3/files/**', (route) => {
    assert.equal(route.request().headers().authorization, 'Bearer fake-drive-token');
    route.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Content-Length', 'Content-Type': 'application/octet-stream' }, body: state.raf ?? state.jpeg });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && /Content Security Policy|Refused|Uncaught|shader|WebGPU/i.test(m.text())) errors.push(m.text()); });
  await page.goto(`${base}/no-such-page`);
  await page.evaluate((token) => new Promise((resolve, reject) => {
    const req = indexedDB.open('th-auth', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => {
      const tx = req.result.transaction('kv', 'readwrite');
      tx.objectStore('kv').put({ session_id: 's1', token, signed_in_at: Date.now(), username: 'example-owner' }, 'session');
      tx.oncomplete = () => { req.result.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }), TOKEN);
  await page.goto(`${base}${path}`, { waitUntil: 'load' });
  return { context, page, errors };
}
const ready = (page) => until(() => page.evaluate(() => document.querySelector('.editor')?.dataset.frame === 'original' && Number(document.querySelector('.editor')?.dataset.frames) > 0), { timeout: 30_000, message: 'the original never drew' });
const probe = (page, before = false) => page.evaluate(async (b) => [...(await document.querySelector('.editor').probe(b)).px], before);
const mean = (a, b) => a.reduce((n, v, i) => n + Math.abs(v - b[i]), 0) / a.length;
const shot = async (page, name) => { if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: `${SHOTS}/photos-export-${name}.png` }); } };
/** Drags a slider's thumb by `dx` CSS px. */
async function drag(page, key, dx) {
  const t = page.locator(`.slider[data-key="${key}"] .strack`);
  const b = await t.boundingBox();
  const th = await page.locator(`.slider[data-key="${key}"] .sthumb`).boundingBox();
  const x = th.x + th.width / 2, y = b.y + b.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(x + (dx * i) / 6, y);
  await page.mouse.up();
}


const panel = (page, id) => page.locator(`.epanel[data-id="${id}"]`).click();
const chip = (page, tool) => page.locator(`.echip[data-tool="${tool}"]`).click();
const frameOf = (page) => page.evaluate(async () => { const s = await document.querySelector('.editor').probe(false); return [s.w, s.h]; });
const recipe = (page) => page.evaluate(() => document.querySelector('.editor').recipe());

async function exportOnce(page, size, timeout = 60_000) {
  await page.locator('.eexport').click();
  await page.locator('.xsheet').waitFor();
  await page.locator(`.xsheet .seg[data-id="${size}"]`).click();
  await page.locator('.xsheet .seg[data-id="files"]').click();
  const [download] = await Promise.all([page.waitForEvent('download', { timeout }), page.locator('.xgo').click()]);
  const file = await download.path();
  return { bytes: readFileSync(file), name: download.suggestedFilename() };
}

test('crop and rotate change the render; a version made, compared and restored; an export with its XMP', { ...opts, timeout: 120_000 }, async () => {
  const { page, errors } = await open(browser, `/photos/?edit=${ID}`);
  await ready(page);
  const before = await probe(page);
  await panel(page, 'crop');
  await page.locator('.coverlay').waitFor();
  await shot(page, 'crop');
  await chip(page, 'CropAngle');
  await drag(page, 'CropAngle', 70);
  await until(async () => (await recipe(page)).CropAngle > 0, { message: 'the wheel never turned the photo' });
  await chip(page, 'aspect');
  await page.locator('.seg[data-id="1:1"]').click();
  await until(async () => { const r = await recipe(page); return r.CropLeft > 0 || r.CropRight < 1; }, { message: '1:1 never cropped' });
  await panel(page, 'light');
  await until(async () => { const [w, h] = await frameOf(page); return w === h; }, { message: 'the frame is not square after 1:1' });
  const turned = await probe(page);
  assert.ok(turned.length !== before.length || mean(turned, before) > 2, 'the crop and the turn changed the render');
  await until(() => state.puts.some((r) => r.CropAngle > 0 && r.CropRight < 1), { message: 'the geometry was never saved' });
  const kept = await recipe(page);

  // A named version, then an automatic one; compare the two; restore the first.
  await panel(page, 'versions');
  await page.locator('.vmake').click();
  await page.locator('.vname').fill('Square and level');
  await page.locator('.vpanel .eauto', { hasText: 'Save' }).click();
  await until(() => state.posts.some((p) => p.kind === 'named' && p.name === 'Square and level'), { message: 'no named version was posted' });
  state.versions.unshift({ id: '0192aaaa-bbbb-7ccc-8ddd-eeeeffff0f01', kind: 'auto', name: null, recipe: { Exposure2012: 1.2 }, created_at: Date.now() - 6e5 });
  await panel(page, 'light');
  await panel(page, 'versions');
  await until(async () => (await page.locator('.vcard').count()) === 2, { message: 'the filmstrip does not show two versions' });
  await page.locator('.vcard').nth(0).click();
  await page.locator('.vcard').nth(1).click();
  await page.locator('.vpanel .eauto', { hasText: 'Compare' }).click();
  await until(async () => (await page.locator('.vcompare canvas').count()) === 2, { message: 'the comparison did not open' });
  await shot(page, 'compare');
  await page.locator('.vclose').click();
  // Still chosen: both; tapping the named one again leaves the automatic one (the first card) to restore.
  await page.locator('.vcard').nth(1).click();
  await page.locator('.vpanel .eauto', { hasText: 'Restore' }).click();
  await until(() => state.puts.at(-1)?.Exposure2012 === 1.2 && !('CropAngle' in state.puts.at(-1)), { message: 'restore did not put the automatic version' });
  await page.locator('.vcard').nth(1).click();
  await page.locator('.vpanel .eauto', { hasText: 'Restore' }).click();
  await until(() => JSON.stringify(state.puts.at(-1)) === JSON.stringify(kept), { message: 'restore did not put the named version back' });

  // Export at 1,080 px to Files: a JPEG the browser decodes, with the recipe in its XMP.
  await page.locator('.eexport').click();
  await page.locator('.xsheet').waitFor();
  await shot(page, 'export');
  await page.locator('.xdim').click({ position: { x: 10, y: 10 } });
  const out = await exportOnce(page, '1080');
  assert.equal(out.name, 'IMG_0001-1080.jpg');
  assert.deepEqual([...out.bytes.subarray(0, 2)], [0xff, 0xd8]);
  assert.deepEqual([...out.bytes.subarray(-2)], [0xff, 0xd9]);
  const size = await page.evaluate(async (b) => { const i = await createImageBitmap(new Blob([new Uint8Array(b)], { type: 'image/jpeg' })); return [i.width, i.height]; }, [...out.bytes]);
  assert.deepEqual(size, [1000, 1000].map(() => size[0]), `a square at most 1,080 px: ${size}`);
  assert.ok(size[0] <= 1080 && size[0] > 500, String(size));
  const xml = findXmp(out.bytes);
  assert.ok(xml, 'the JPEG carries an XMP packet');
  for (const k of ['crs:CropAngle', 'crs:CropLeft', 'crs:CropRight', 'crs:HasCrop="True"', 'crs:AlreadyApplied="True"']) assert.ok(xml.includes(k), k);
  assert.deepEqual(recipeOfXmp(xml), kept);
  await until(() => state.senses.some((e) => e.type === 'photo.export'), { message: 'no photo.export sense' });
  assert.deepEqual(state.senses.find((e) => e.type === 'photo.export').data, { size: '1080', format: 'jpeg', to: 'files' });
  assert.ok(state.senses.some((e) => e.type === 'photo.edit' && e.data.panel === 'crop'));
  assert.deepEqual(errors.filter((e) => !/cannot present/.test(e)), []);
});

test('the A35 profile: the strip, the crop frame and the export sheet fit', opts, async () => {
  const { page, errors } = await open(flat, `/photos/?edit=${ID}`, { viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, isMobile: true });
  await ready(page);
  await panel(page, 'crop');
  const box = await page.locator('.coverlay').boundingBox();
  assert.ok(box && box.width <= 360, JSON.stringify(box));
  for (const id of ['light', 'optics', 'crop', 'versions']) { const b = await page.locator(`.epanel[data-id="${id}"]`).boundingBox(); assert.ok(b.x >= 0 && b.x + b.width <= 360.5, id); }
  await page.locator('.eexport').click();
  const s = await page.locator('.xsheet').boundingBox();
  assert.ok(s.y >= 0 && s.x + s.width <= 360.5, JSON.stringify(s));
  await shot(page, 'a35-export');
  assert.deepEqual(errors.filter((e) => !/cannot present/.test(e)), []);
});

test('the X-E5 sample exported at 2,048 px and at full size from its tiles', { skip: (live && 'local only') || (!existsSync(RAF) && 'the CC0 sample is not downloaded (tests/photos-engine.test.mjs fetches it)'), timeout: 900_000 }, async () => {
  state.raf = readFileSync(RAF);
  state.recipe = { Exposure2012: 0.3, CropAngle: 2.5, Sharpness: 60 };
  try {
    const { page, errors } = await open(flat, `/photos/?edit=${ID}`, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true });
    await until(() => page.evaluate(() => document.querySelector('.editor')?.dataset.frame === 'original'), { timeout: 180_000, message: 'the RAF never drew' });
    for (const size of ['2048', 'full']) {
      const out = await exportOnce(page, size, 800_000);
      const ms = await page.evaluate(() => Number(document.querySelector('.editor')?.dataset.exportMs ?? 0));
      const dims = await page.evaluate(async (b) => { const i = await createImageBitmap(new Blob([new Uint8Array(b)], { type: 'image/jpeg' })); return [i.width, i.height]; }, [...out.bytes]);
      const mib = await page.evaluate(() => document.querySelector('.editor').dataset.wasmMib);
      const heap = await page.evaluate(() => (/** @type {any} */ (performance).memory?.usedJSHeapSize ?? 0) / 1048576);
      console.log(`# X-E5 export ${size}: ${dims.join('×')} in ${(ms / 1000).toFixed(1)} s, ${(out.bytes.length / 1048576).toFixed(1)} MiB, wasm ${mib} MiB, JS heap ${heap.toFixed(0)} MiB`);
      if (SHOTS) writeFileSync(`${SHOTS}/photos-export-xe5-${size}.jpg`, out.bytes);
      assert.ok(findXmp(out.bytes)?.includes('crs:CropAngle="+2.5"'));
      if (size === '2048') assert.equal(Math.max(...dims), 2048);
      else assert.ok(Math.max(...dims) > 7000, String(dims));
    }
    assert.deepEqual(errors.filter((e) => !/cannot present/.test(e)), []);
  } finally {
    state.raf = null;
    state.recipe = {};
  }
});

test('where an export goes: a save dialog at the tap, Downloads one at a time, the share sheet for a batch', opts, async () => {
  // The sheet over the editor with `n` small photos that render at once (the render is tested above).
  const sheet = (page, n) => page.evaluate(async (n) => {
    const { exportSheet } = await import('/apps/photos/edit/export.js'), c = new OffscreenCanvas(64, 48), g = c.getContext('2d');
    g.fillRect(0, 0, 64, 48);
    const blob = await c.convertToBlob({ type: 'image/jpeg' });
    await exportSheet(document.querySelector('.editor'), Array.from({ length: n }, (_, i) => ({ id: `0192aaaa-bbbb-7ccc-8ddd-00000000000${i}`, name: `IMG_000${i + 1}.JPG`, render: async () => blob })));
  }, n);
  const go = async (page) => { await page.locator('.xsheet .seg[data-id="1080"]').click(); await page.locator('.xsheet .seg[data-id="files"]').click(); await page.locator('.xgo').click(); };
  const said = (page, text) => until(async () => (await page.locator('.toast').innerText().catch(() => '')) === text, { message: `no "${text}"` });
  const names = (n) => Array.from({ length: n }, (_, i) => `IMG_000${i + 1}-1080.jpg`);
  // Desktop: the dialog opens while the tap counts, before the render; a folder for several.
  const a = await open(flat, `/photos/?edit=${ID}`, undefined, picker);
  await ready(a.page); await sheet(a.page, 1);
  assert.equal(await a.page.locator('.xsheet .seg[data-id="files"]').innerText(), 'Files');
  await go(a.page);
  await said(a.page, 'Saved.');
  await sheet(a.page, 3); await go(a.page);
  await said(a.page, 'Saved 3 photos.');
  assert.deepEqual(await a.page.evaluate(() => window.saved), [['dialog', 'IMG_0001-1080.jpg', true], ['IMG_0001-1080.jpg', 0xff, 0xd8], ['folder', '', true], ...names(3).map((n) => [n, 0xff, 0xd8])]);
  // Android, or the installed app: Download, one file at a time, every one arrives.
  const b = await open(flat, `/photos/?edit=${ID}`);
  await ready(b.page);
  const downloads = [];
  b.page.on('download', (d) => downloads.push(d.suggestedFilename()));
  await sheet(b.page, 3);
  assert.equal(await b.page.locator('.xsheet .seg[data-id="files"]').innerText(), 'Download');
  await go(b.page);
  await said(b.page, 'Saved 3 photos to Downloads.');
  await until(() => downloads.length === 3, { message: `${downloads.length} of 3 downloads arrived` });
  assert.deepEqual(downloads.sort(), names(3));
  // More than three where the share sheet takes files: it is offered, with a tap of its own.
  const c = await open(flat, `/photos/?edit=${ID}`, undefined, sharing);
  await ready(c.page); await sheet(c.page, 5); await go(c.page);
  await c.page.locator('.xsheet[data-state="ask"]').waitFor();
  await shot(c.page, 'share-offer');
  await c.page.locator('.xsheet [data-choice="share"]').click();
  await said(c.page, '5 photos exported.');
  assert.deepEqual(await c.page.evaluate(() => window.shared), names(5));
  assert.deepEqual([...a.errors, ...b.errors, ...c.errors].filter((e) => !/cannot present/.test(e)), []);
  for (const x of [a, b, c]) await x.context.close();
});

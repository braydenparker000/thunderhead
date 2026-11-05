// Copy and paste, and export from the shelf, in Chromium (PHOTOS.md, Copy and paste; Export), against a
// mock API and a fake Drive, on synthetic JPEGs drawn in the page: in the editor, More › Copy edit holds
// the chosen panels (a reload keeps it); on the shelf a long press and Choose start choosing, a tap adds a photo,
// Paste changes both recipes in one call and Undo puts both back; two photos chosen export as two
// files. At 390×844 and on the A35-sized profile.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { pasteOnto } from '../shared/contract/photos-paste.ts';
import { until } from './fixtures/waits.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (mocked API)', timeout: 180_000 };
const TOKEN = `th1_${'P'.repeat(43)}abcdef`;
const [A, B, C] = ['0192aaaa-bbbb-7ccc-8ddd-eeeeffff0011', '0192aaaa-bbbb-7ccc-8ddd-eeeeffff0012', '0192aaaa-bbbb-7ccc-8ddd-eeeeffff0013'];
const SHOTS = process.env.TH_SHOTS;
const start = () => ({ [A]: { Exposure2012: 0.8, Vibrance: 25, CropAngle: 3 }, [B]: { Texture: 30, CropAngle: -2 }, [C]: {} });
const state = { recipes: start(), pastes: [], undone: [], senses: [], jpeg: Buffer.alloc(0), preview: Buffer.alloc(0) };
const photo = (id, i) => ({ id, drive_id: `drive-file-${i}`, name: `IMG_000${i}.JPG`, format: 'jpeg', bytes: state.jpeg.length, width: 1500, height: 1000, sha256: 'c'.repeat(64), camera: 'Example Camera', film: null, taken_at: Date.UTC(2026, 9, 3, 9, i), day: '2026-10-03', rating: 0, flag: null, preview: true, edited: Object.keys(state.recipes[id]).length > 0, deleted_at: null, created_at: 1 });
const all = () => [A, B, C].map((id, i) => photo(id, i + 1));
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
    const id = path.match(/^\/v1\/photos\/([0-9a-f-]{36})/)?.[1];
    if (path.startsWith('/v1/senses/batches/')) { const { events } = JSON.parse(body); state.senses.push(...events); return json(200, { accepted: events.length, rejected: [] }); }
    if (path === '/v1/photos') return json(200, { days: [{ day: '2026-10-03', count: 3, photos: all() }], next: null });
    if (path === '/v1/photos/upload-token') return json(200, { access_token: 'fake-drive-token', expires_at: Date.now() + 3e6, folder_id: 'folder-1' });
    if (path === '/v1/settings') return json(200, { 'owner.tz': 'UTC', min_client: 0 });
    // The Worker's paste (backend/src/areas/photos/paste.ts), as the contract merges it, and its one undo.
    if (path === '/v1/photos/paste' && req.method === 'POST') {
      const b = JSON.parse(body);
      state.pastes.push(b);
      const items = b.ids.map((pid) => { const before = state.recipes[pid]; const recipe = pasteOnto(before, b.panels, b.recipe); state.recipes[pid] = recipe; return { id: pid, changed: JSON.stringify(recipe) !== JSON.stringify(before), recipe, before }; });
      state.lastPaste = items;
      return json(200, { items, ledger_id: '0192aaaa-bbbb-7ccc-8ddd-eeee0000aaaa' });
    }
    if (path === '/v1/ledger/0192aaaa-bbbb-7ccc-8ddd-eeee0000aaaa/undo') { for (const it of state.lastPaste) state.recipes[it.id] = it.before; state.undone.push(Date.now()); return json(200, { undo_ledger_id: 'u1', status: 'undone' }); }
    if (id && path.endsWith('/preview')) return res.writeHead(200, { ...cors, 'Content-Type': 'image/jpeg' }).end(state.preview);
    if (id && path.endsWith('/versions') && req.method === 'POST') { const v = JSON.parse(body); return json(201, { version: { ...v, name: null, created_at: Date.now() }, created: true }); }
    if (id && path.endsWith('/versions')) return json(200, { items: [] });
    if (id && path.endsWith('/recipe') && req.method === 'PUT') { state.recipes[id] = JSON.parse(body).recipe; return json(200, { photo: photo(id, 1), recipe: state.recipes[id], changed: true }); }
    if (id && state.recipes[id]) return json(200, { photo: all().find((p) => p.id === id), recipe: state.recipes[id] });
    json(404, { error: { code: 'not_found', message: 'x', request_id: '' } });
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  site = await serve(0, { api: `http://127.0.0.1:${mock.address().port}` });
  base = `http://127.0.0.1:${site.address().port}`;
  const exe = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
  browser = await chromium.launch({ ...exe, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader'] });
  flat = await chromium.launch({ ...exe, args: ['--disable-features=WebGPU'] });
  // The synthetic photo: colour bands over a grey ramp, drawn by the browser and encoded as JPEG.
  const page = await browser.newPage();
  const draw = async (w, h) => Buffer.from(await page.evaluate(async ([w, h]) => {
    const c = new OffscreenCanvas(w, h), g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, w, 0);
    ['#c0392b', '#f1c40f', '#27ae60', '#2980b9', '#8e44ad'].forEach((col, i) => grad.addColorStop(i / 4, col));
    g.fillStyle = grad; g.fillRect(0, 0, w, h * 0.6);
    const grey = g.createLinearGradient(0, 0, w, 0); grey.addColorStop(0, '#050505'); grey.addColorStop(1, '#fafafa');
    g.fillStyle = grey; g.fillRect(0, h * 0.6, w, h * 0.4);
    return [...new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 })).arrayBuffer())];
  }, [w, h]));
  state.jpeg = await draw(1500, 1000);
  state.preview = await draw(1024, 683);
  await page.close();
});
after(async () => { await browser?.close(); await flat?.close(); site?.close(); mock?.close(); });

async function open(b, path, device = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 }) {
  const context = await b.newContext({ ...device, hasTouch: true, acceptDownloads: true });
  await context.addInitScript(() => Object.assign(window, { showSaveFilePicker: undefined, showDirectoryPicker: undefined })); // Android: no save dialog
  await context.route('https://www.googleapis.com/drive/v3/files/**', (route) => route.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Content-Length', 'Content-Type': 'application/octet-stream' }, body: state.jpeg }));
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
const shot = async (page, name) => { if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: `${SHOTS}/photos-paste-${name}.png` }); } };
const tile = (page, id) => page.locator(`.days .tile[data-id="${id}"]`);
/** A long press on a tile: held until its menu opens, let go, then Choose starts choosing. */
async function hold(page, id) {
  const b = await tile(page, id).boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await until(() => page.locator('.tmenu').isVisible(), { message: 'the long press did not open the menu' });
  await page.mouse.up();
  await page.locator('.tmenu .pact', { hasText: 'Choose' }).click();
  await until(() => page.locator('.selbar').isVisible(), { message: 'Choose did not start choosing' });
}

test('copy in the editor, choose two on the shelf, paste, undo', opts, async () => {
  state.recipes = start();
  // WebGL2 here (the WebGPU path is the editor's own suites'): its screenshot shows the sheet over the photo.
  const { page, errors } = await open(flat, `/photos/?edit=${A}`);
  await until(() => page.evaluate(() => Number(document.querySelector('.editor')?.dataset.frames) > 0), { timeout: 30_000, message: 'the editor never drew' });
  await page.locator('.emore').click();
  await page.locator('.cpsheet').waitFor();
  assert.equal(await page.locator('.crow[data-panel="crop"]').getAttribute('aria-checked'), 'false');
  assert.equal(await page.locator('.crow[data-panel="light"]').getAttribute('aria-checked'), 'true');
  const sb = await page.locator('.cpsheet').boundingBox();
  const top = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('.cpsheet') !== null && getComputedStyle(document.querySelector('.cpsheet')).opacity === '1', [sb.x + sb.width / 2, sb.y + 20]);
  assert.ok(top && sb.y >= 0 && sb.x + sb.width <= 390.5, `the copy sheet on top and on screen: ${JSON.stringify(sb)}`);
  await shot(page, 'copy-sheet');
  await page.locator('.cpsheet .xgo').click();
  await until(() => page.locator('.cpsheet').count().then((n) => n === 0), { message: 'the copy sheet stayed' });
  // The shelf, after a reload: the copy is still held, shown as a chip.
  await page.goto(`${base}/photos/`, { waitUntil: 'load' });
  await page.locator('.copychip').waitFor();
  assert.match(await page.locator('.copychip').innerText(), /Light, Color, Effects, Detail and Optics/);
  await tile(page, C).waitFor();
  await hold(page, B);
  await tile(page, C).click();
  await until(async () => (await page.locator('.selcount').innerText()) === '2 chosen', { message: 'two were not chosen' });
  assert.equal(await tile(page, B).getAttribute('aria-pressed'), 'true');
  assert.equal(await tile(page, A).getAttribute('aria-pressed'), 'false');
  await shot(page, 'select');
  await page.locator('.selb', { hasText: 'Paste' }).click();
  await page.locator('.pasted').waitFor();
  assert.equal(state.pastes.length, 1);
  assert.deepEqual(state.pastes[0].ids, [B, C]);
  assert.deepEqual(state.pastes[0].recipe, { Exposure2012: 0.8, Vibrance: 25 });
  assert.deepEqual(state.recipes[B], { CropAngle: -2, Exposure2012: 0.8, Vibrance: 25 });
  assert.deepEqual(state.recipes[C], { Exposure2012: 0.8, Vibrance: 25 });
  assert.match(await page.locator('.pasted').innerText(), /Pasted to 2 photos/);
  await shot(page, 'pasted');
  await page.locator('.pasted .undo').click();
  await until(() => state.undone.length === 1, { message: 'undo was not asked' });
  await until(async () => /Back as they were/.test(await page.locator('.pasted').innerText()), { message: 'the line did not say so' });
  assert.deepEqual(state.recipes, start());
  await until(() => state.senses.some((e) => e.type === 'photo.paste'), { message: 'no photo.paste sense' });
  const s = state.senses.find((e) => e.type === 'photo.paste');
  assert.equal(s.ref ?? null, null);
  assert.deepEqual(s.data, { count: 2, light: true, color: true, effects: true, detail: true, optics: true, crop: false });
  assert.deepEqual(errors.filter((e) => !/cannot present/.test(e)), []);
});

test('the A35 profile: two chosen on the shelf export as two files', opts, async () => {
  state.recipes = start();
  const { page, errors } = await open(flat, '/photos/', { viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, isMobile: true });
  await tile(page, C).waitFor();
  await hold(page, A);
  await tile(page, B).click();
  await until(async () => (await page.locator('.selcount').innerText()) === '2 chosen', { message: 'two were not chosen' });
  const bar = await page.locator('.selbar').boundingBox();
  assert.ok(bar && bar.x >= 0 && bar.x + bar.width <= 360.5, JSON.stringify(bar));
  for (const name of ['Cancel', 'Export']) { const b = await page.locator('.selb', { hasText: name }).boundingBox(); assert.ok(b.x >= 0 && b.x + b.width <= 360.5 && b.height >= 44, name); }
  assert.equal(await page.locator('.selb', { hasText: 'Paste' }).isVisible(), false, 'no Paste without a copy');
  await shot(page, 'a35-select');
  await page.locator('.selb', { hasText: 'Export' }).click();
  await page.locator('.xsheet').waitFor();
  assert.match(await page.locator('.xsheet h2').innerText(), /Export 2 photos/);
  const sheet = await page.locator('.xsheet').boundingBox();
  assert.ok(sheet.y >= 0 && sheet.x + sheet.width <= 360.5, JSON.stringify(sheet));
  await shot(page, 'a35-export');
  await page.locator('.xsheet .seg[data-id="1080"]').click();
  await page.locator('.xsheet .seg[data-id="files"]').click();
  const downloads = [];
  page.on('download', (d) => downloads.push(d));
  await page.locator('.xgo').click();
  await until(() => downloads.length === 2, { timeout: 150_000, message: 'two files were not exported' });
  const names = downloads.map((d) => d.suggestedFilename()).sort();
  assert.deepEqual(names, ['IMG_0001-1080.jpg', 'IMG_0002-1080.jpg']);
  for (const d of downloads) {
    const bytes = readFileSync(await d.path());
    assert.deepEqual([...bytes.subarray(0, 2)], [0xff, 0xd8]);
    assert.deepEqual([...bytes.subarray(-2)], [0xff, 0xd9]);
  }
  await until(() => state.senses.filter((e) => e.type === 'photo.export').length >= 2, { message: 'no photo.export senses' });
  assert.deepEqual(errors.filter((e) => !/cannot present/.test(e)), []);
});

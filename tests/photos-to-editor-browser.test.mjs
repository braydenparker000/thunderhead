// Edit opens the new editor (frontend/apps/photos/to-editor.js, docs/design/EDITOR.md): on a RAF with
// its original in Drive, Photos fetches the original once, copies it into the editor's own store on
// this phone under `photos:<id>` and goes to `/lab/editor/?open=<its id there>&from=photos`, which
// opens it straight in Edit; the editor's back arrow returns to Photos; a second Edit finds the copy
// and asks Drive for nothing. A JPEG, or any photo with the owner's Editor set to Classic, opens
// the editor before (`?edit=`). A synthetic RAF (tests/fixtures/make-raf.mjs: an invented JPEG in a
// RAF header) against a mock API and a fake Drive; the engine's own decoding is not what is tested
// here (tests/lab-editor-*.test.mjs), so its wasm is not served.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { makeRaf } from './fixtures/make-raf.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (mocked API)', timeout: 120_000 };
const TOKEN = `th1_${'E'.repeat(43)}abcdef`;
const ID = '0192aaaa-bbbb-7ccc-8ddd-eeeeffff0042';
const state = { raf: Buffer.alloc(0), format: 'raf', drive: 0 };
const photo = () => ({ id: ID, drive_id: 'drive-file-42', name: state.format === 'raf' ? 'DSCF0042.RAF' : 'IMG_0042.JPG', format: state.format, bytes: state.raf.length, sha256: null,
  camera: 'X-E5', film: 'Classic Chrome', width: 7728, height: 5152, taken_at: Date.UTC(2026, 9, 3, 10, 0), day: '2026-10-03', rating: 0, favorite: false, flag: null, pair_id: null, preview: false });
let site, mock, browser, base;

before(async () => {
  if (live) return;
  mock = createServer(async (req, res) => {
    const cors = { 'Access-Control-Allow-Origin': req.headers.origin ?? '', 'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, TH-Client', Vary: 'Origin' };
    if (req.method === 'OPTIONS') return res.writeHead(204, cors).end();
    for await (const _ of req) { /* drain */ }
    const json = (status, value) => res.writeHead(status, { ...cors, 'Content-Type': 'application/json' }).end(JSON.stringify(value));
    const path = new URL(req.url, 'http://x').pathname;
    if (path.startsWith('/v1/senses/batches/')) return json(200, { accepted: 0, rejected: [] });
    if (path === '/v1/photos') return json(200, { days: [{ day: '2026-10-03', count: 1, photos: [photo()] }], next: null });
    if (path === '/v1/photos/upload-token') return json(200, { access_token: 'fake-drive-token', expires_at: Date.now() + 3e6, folder_id: 'folder-1' });
    if (path === '/v1/settings') return json(200, { 'owner.tz': 'UTC', min_client: 0 });
    if (path === `/v1/photos/${ID}`) return json(200, { photo: photo(), recipe: {} });
    json(404, { error: { code: 'not_found', message: 'x', request_id: '' } });
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  site = await serve(0, { api: `http://127.0.0.1:${mock.address().port}` });
  base = `http://127.0.0.1:${site.address().port}`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => { await browser?.close(); site?.close(); mock?.close(); });

async function open(prefs = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, serviceWorkers: 'block' });
  await context.route('https://www.googleapis.com/drive/v3/files/**', (route) => {
    state.drive++;
    assert.equal(route.request().headers().authorization, 'Bearer fake-drive-token');
    route.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Content-Length', 'Content-Type': 'application/octet-stream' }, body: state.raf });
  });
  // The engine's decoding is tested elsewhere; here its wasm is simply not there.
  await context.route('**/*.wasm', (route) => route.abort());
  const page = await context.newPage();
  await page.goto(`${base}/no-such-page`);
  await page.evaluate(({ token, prefs }) => new Promise((resolve, reject) => {
    for (const [k, v] of Object.entries(prefs)) localStorage.setItem(`th.s.${k}`, v);
    const req = indexedDB.open('th-auth', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => {
      const tx = req.result.transaction('kv', 'readwrite');
      tx.objectStore('kv').put({ session_id: 's1', token, signed_in_at: Date.now(), username: 'example-owner' }, 'session');
      tx.oncomplete = () => { req.result.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }), { token: TOKEN, prefs });
  return { context, page };
}
/** An invented picture as JPEG bytes, drawn by the browser. */
const drawJpeg = (page) => page.evaluate(async () => {
  const c = new OffscreenCanvas(240, 160), g = c.getContext('2d');
  g.fillStyle = '#356'; g.fillRect(0, 0, 240, 160); g.fillStyle = '#ec7'; g.beginPath(); g.arc(120, 80, 50, 0, 7); g.fill();
  return [...new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality: 0.8 })).arrayBuffer())];
});
/** What the editor keeps on this phone: each photo's record and the size of its RAF. */
const kept = (page) => page.evaluate(async () => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('th-editor', 1); r.onupgradeneeded = () => { r.result.createObjectStore('photos', { keyPath: 'id' }); r.result.createObjectStore('edits'); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const all = await new Promise((res) => { const q = db.transaction('photos').objectStore('photos').getAll(); q.onsuccess = () => res(q.result); });
  db.close();
  const raw = await (await navigator.storage.getDirectory()).getDirectoryHandle('raw', { create: true });
  return Promise.all(all.map(async (p) => ({ id: p.id, name: p.name, source: p.source, taken: p.taken, bytes: (await (await raw.getFileHandle(`${p.id}.raf`)).getFile()).size })));
});

test('Edit on a RAF hands its original to the new editor, once; the editor opens it in Edit and goes back to Photos', opts, async () => {
  const { context, page } = await open();
  state.format = 'raf'; state.drive = 0;
  state.raf = Buffer.from(makeRaf(Uint8Array.from(await drawJpeg(page))));
  await page.goto(`${base}/photos/?photo=${ID}`, { waitUntil: 'load' });
  await page.waitForSelector('.view .vedit');
  // The view itself may read Drive (a missing preview): count only what Edit asks for.
  await page.waitForLoadState('networkidle');
  let before = state.drive;
  await Promise.all([page.waitForURL(/\/lab\/editor\/\?open=[0-9a-f-]{36}&from=photos$/), page.click('.view .vedit')]);
  const here = new URL(page.url()).searchParams.get('open');
  assert.equal(state.drive - before, 1, 'the original was fetched from Drive once');
  assert.deepEqual(await kept(page), [{ id: here, name: 'DSCF0042.RAF', source: `photos:${ID}`, taken: Date.UTC(2026, 9, 3, 10, 0), bytes: state.raf.length }]);
  // Straight into Edit, on that photo: its name in the header, the Library one step away.
  await page.waitForFunction(() => /DSCF0042/.test(document.querySelector('#stage header')?.textContent ?? ''));
  assert.equal(await page.title(), 'Photos');
  // The editor's own back arrow returns to Photos, at the photo.
  await Promise.all([page.waitForURL(new RegExp(`/photos/\\?photo=${ID}$`)), page.click('#stage header button[aria-label="Back to Photos"]')]);
  // Edit again: the copy is found, Drive is not asked, and nothing is copied twice.
  await page.waitForSelector('.view .vedit');
  await page.waitForLoadState('networkidle');
  before = state.drive;
  await Promise.all([page.waitForURL(new RegExp(`/lab/editor/\\?open=${here}&from=photos$`)), page.click('.view .vedit')]);
  assert.equal(state.drive - before, 0, 'no second download');
  assert.equal((await kept(page)).length, 1);
  await context.close();
});

test('Classic in Settings, or a photo that is not a RAF, opens the editor before', opts, async () => {
  const classic = await open({ 'photos.editor': 'classic' });
  state.format = 'raf'; state.drive = 0;
  await classic.page.goto(`${base}/photos/?photo=${ID}`, { waitUntil: 'load' });
  await classic.page.waitForSelector('.view .vedit');
  await Promise.all([classic.page.waitForURL(new RegExp(`/photos/\\?edit=${ID}$`)), classic.page.click('.view .vedit')]);
  await classic.context.close();

  const jpeg = await open();
  state.format = 'jpeg';
  await jpeg.page.goto(`${base}/photos/?photo=${ID}`, { waitUntil: 'load' });
  await jpeg.page.waitForSelector('.view .vedit');
  await Promise.all([jpeg.page.waitForURL(new RegExp(`/photos/\\?edit=${ID}$`)), jpeg.page.click('.view .vedit')]);
  assert.deepEqual(await kept(jpeg.page), [], 'nothing was handed to the new editor');
  await jpeg.context.close();
  state.format = 'raf';
});

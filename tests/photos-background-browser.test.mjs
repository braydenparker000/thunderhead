// Photos' background uploads in Chromium (PHOTOS.md §3.1) at 390×844, against a mock API and a fake
// Google Drive, with Background Fetch faked on the service worker's registration (headless Chromium
// runs no real one): an import registers each photo pending, sends its preview and starts one fetch
// per file (a PUT of the whole file to its Drive session, "Uploading <name>", the file's size as the
// total); the service worker's word puts one in Drive; a failed one keeps its session and says so
// with Try again; on the next open one Drive finished is settled by the page and the failed one, picked
// again, resumes by range. The page's own upload without Background Fetch is photos-browser.test.mjs.
// No CSP or page errors. Screens go to TH_SHOTS when it is set. Invented photos only.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { until } from './fixtures/waits.mjs';
import { makeRaf } from './fixtures/make-raf.mjs';

const opts = { skip: Boolean(process.env.SITE_URL) && 'local only (mocked API)' };
const TOKEN = `th1_${'P'.repeat(43)}abcdef`;
let site, mock, browser, base;
const state = { photos: [], previews: new Map(), registered: [], patches: [], puts: [] };
const err = (res, cors, status, code) => res.writeHead(status, { ...cors, 'Content-Type': 'application/json' }).end(JSON.stringify({ error: { code, message: 'x', request_id: '' } }));

before(async () => {
  if (opts.skip) return;
  mock = createServer(async (req, res) => {
    const cors = { 'Access-Control-Allow-Origin': req.headers.origin ?? '', 'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, TH-Client', Vary: 'Origin' };
    if (req.method === 'OPTIONS') return res.writeHead(204, cors).end();
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const json = (status, value) => res.writeHead(status, { ...cors, 'Content-Type': 'application/json' }).end(JSON.stringify(value));
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return err(res, cors, 401, 'unauthorized');
    const path = new URL(req.url, 'http://x').pathname;
    const live = state.photos.filter((p) => !p.deleted_at);
    let m;
    if (path.startsWith('/v1/senses/batches/')) return json(200, { accepted: JSON.parse(body.toString()).events.length, rejected: [] });
    if (path === '/v1/photos') {
      const days = [...new Set(live.map((p) => p.day))].sort().reverse();
      return json(200, { days: days.map((d) => ({ day: d, count: live.filter((p) => p.day === d).length, photos: live.filter((p) => p.day === d) })), next: null });
    }
    if (path === '/v1/photos/pending') return json(200, { items: live.filter((p) => !p.drive_id) });
    if (path === '/v1/photos/upload-token') return json(200, { access_token: 'fake-drive-token', expires_at: Date.now() + 3e6, folder_id: 'folder-1' });
    if (path === '/v1/photos/drive') return json(200, { configured: true, connected: true, folder_name: 'Thunderhead Photos', revoked: false, connected_at: 1, account: 'owner@example.test', picker_key: '', picker_app: '' });
    if (path === '/v1/settings') return json(200, { 'owner.tz': 'UTC', min_client: 0 });
    if ((m = /^\/v1\/photos\/([^/]+)\/preview$/.exec(path))) {
      state.previews.set(m[1], body);
      return json(200, { photo: Object.assign(state.photos.find((x) => x.id === m[1]), { preview: true }) });
    }
    if ((m = /^\/v1\/photos\/([^/]+)$/.exec(path))) {
      let p = state.photos.find((x) => x.id === m[1]);
      if (req.method === 'PUT') {
        const r = JSON.parse(body.toString());
        state.registered.push(r);
        if (p) { p.drive_id ??= r.drive_id; return json(200, { photo: p }); }
        p = { ...r, id: m[1], day: new Date(r.taken_at).toISOString().slice(0, 10), rating: 0, flag: null, preview: false, edited: false, deleted_at: null, created_at: Date.now() };
        state.photos.push(p);
        return json(201, { photo: p });
      }
      if (!p) return err(res, cors, 404, 'not_found');
      if (req.method === 'PATCH') { const b = JSON.parse(body.toString()); state.patches.push({ id: p.id, ...b }); Object.assign(p, b); }
      return json(200, { photo: p });
    }
    err(res, cors, 404, 'not_found');
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  site = await serve(0, { api: `http://127.0.0.1:${mock.address().port}` });
  base = `http://127.0.0.1:${site.address().port}`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => { await browser?.close(); site?.close(); mock?.close(); });

/** Drive's resumable upload, faked: a session per file name; asked how far, B.RAF has 100 bytes and C.RAF all of it. */
async function fakeDrive(context) {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Location, Range' };
  await context.route('https://www.googleapis.com/upload/drive/v3/files**', async (route) => {
    const r = route.request();
    if (r.method() === 'POST') return route.fulfill({ status: 200, headers: { ...cors, Location: `https://www.googleapis.com/upload/drive/v3/files?upload_id=${JSON.parse(r.postData()).name}` }, body: '' });
    const who = new URL(r.url()).searchParams.get('upload_id');
    const range = r.headers()['content-range'];
    state.puts.push({ who, range, auth: r.headers().authorization ?? null });
    if (range.startsWith('bytes */') && who === 'B.RAF') return route.fulfill({ status: 308, headers: { ...cors, Range: 'bytes=0-99' }, body: '' });
    return route.fulfill({ status: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: `drive-${who}` }) });
  });
}

/** Background Fetch on a fake registration: what the page asked for is kept in `window.__bg`. */
const fakeBackgroundFetch = () => {
  const regs = new Map();
  const asked = [];
  window.__bg = { regs, asked };
  const backgroundFetch = {
    fetch: async (id, req, o) => {
      const f = Object.assign(new EventTarget(), { id, result: '', uploaded: 0, uploadTotal: 0 });
      asked.push({ id, url: req.url, method: req.method, bytes: (await req.clone().blob()).size, title: o.title, downloadTotal: o.downloadTotal, icons: o.icons.map((i) => i.src) });
      regs.set(id, f);
      return f;
    },
    get: async (id) => regs.get(id),
  };
  navigator.serviceWorker.getRegistration = async () => ({ active: {}, backgroundFetch });
};

async function open() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
  await fakeDrive(context);
  await context.addInitScript(fakeBackgroundFetch);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && /Content Security Policy|Refused|Uncaught/i.test(m.text())) errors.push(m.text()); });
  await page.goto(`${base}/no-such-page`);
  await page.evaluate((token) => new Promise((resolve) => {
    const req = indexedDB.open('th-auth', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => {
      const tx = req.result.transaction('kv', 'readwrite');
      tx.objectStore('kv').put({ session_id: 's1', token, signed_in_at: Date.now(), username: 'example-owner' }, 'session');
      tx.oncomplete = () => { req.result.close(); resolve(); };
    };
  }), TOKEN);
  await page.goto(`${base}/photos/`, { waitUntil: 'load' });
  return { page, context, errors };
}

const drawJpeg = (page) => page.evaluate(async () => {
  const c = new OffscreenCanvas(320, 214);
  const g = c.getContext('2d');
  g.fillStyle = '#3b7bbf'; g.fillRect(0, 0, 320, 214);
  g.fillStyle = '#e9c46a'; g.beginPath(); g.arc(230, 70, 30, 0, 7); g.fill();
  return [...new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 })).arrayBuffer())];
});
const shot = (page, name) => process.env.TH_SHOTS && page.screenshot({ path: `${process.env.TH_SHOTS}/photos-bg-${name}.png` });
const kept = (page, id) => page.evaluate((id) => import('/apps/photos/data.js').then((d) => d.store.get(`bg:${id}`)), id);
const idOf = (name) => state.photos.find((p) => p.name === name)?.id;

test('the upload goes on in the background: one fetch a file, the worker’s word, a failure kept, settled on return', opts, async () => {
  const { page, context, errors } = await open();
  await page.waitForSelector('.shelf .head');
  const raf = Buffer.from(makeRaf(Uint8Array.from(await drawJpeg(page))));
  await page.setInputFiles('input[type=file]', ['A.RAF', 'B.RAF', 'C.RAF'].map((name) => ({ name, mimeType: 'application/octet-stream', buffer: raf })));
  await until(() => state.previews.size === 3, { message: 'three photos registered with their previews' });
  // Registered pending, before Drive has the file; one fetch each: a PUT of the whole file to its session.
  assert.deepEqual(state.registered.map((r) => [r.name, r.drive_id]), [['A.RAF', null], ['B.RAF', null], ['C.RAF', null]]);
  const asked = await until(() => page.evaluate(() => (window.__bg.asked.length === 3 ? window.__bg.asked : null)));
  assert.deepEqual(asked[1], { id: idOf('B.RAF'), url: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=B.RAF', method: 'PUT', bytes: raf.length, title: 'Uploading B.RAF', downloadTotal: raf.length, icons: ['/ui/app-icon-192.png'] });
  assert.equal(state.puts.length, 0, 'the page itself sent no bytes');
  await page.waitForSelector('.arrival .anote:text("Uploading in the background")');
  // The system's progress shows on the row too.
  await page.evaluate((id) => { const f = window.__bg.regs.get(id); f.uploaded = Math.round(f.uploaded + 0.5 * 3000); f.uploadTotal = 3000; f.dispatchEvent(new Event('progress')); }, idOf('A.RAF'));
  await until(() => page.$eval(`.arrival[data-id="${idOf('A.RAF')}"] .bar`, (b) => b.style.width === '50%'));
  await page.waitForSelector(`.tile[data-id="${idOf('A.RAF')}"] .tmark:text("Uploading")`);
  await shot(page, 'uploading');
  // The service worker's word: A is in Drive (it told the Worker), B failed (its session kept).
  Object.assign(state.photos.find((p) => p.name === 'A.RAF'), { drive_id: 'drive-A.RAF' });
  await page.evaluate(([a, b, photo]) => import('/apps/photos/data.js').then(async (d) => {
    await d.store.del(`bg:${a}`);
    await d.store.set(`bg:${b}`, { ...(await d.store.get(`bg:${b}`)), failed: true });
    navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'photos:upload', id: a, state: 'done', photo } }));
    navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'photos:upload', id: b, state: 'failed' } }));
  }), [idOf('A.RAF'), idOf('B.RAF'), state.photos.find((p) => p.name === 'A.RAF')]);
  await page.waitForSelector(`.arrival.failed[data-id="${idOf('B.RAF')}"] .anote:text("This one did not upload.")`);
  await page.waitForSelector(`.arrival.failed[data-id="${idOf('B.RAF')}"] .retry`);
  assert.equal((await kept(page, idOf('B.RAF'))).session, 'https://www.googleapis.com/upload/drive/v3/files?upload_id=B.RAF');
  await shot(page, 'failed');
  // Back later (the fetches gone): C finished in Drive with no word to the Worker, so the page asks
  // Drive and sends the id; B says it did not upload, and picked again goes on from Drive's byte 100.
  await page.reload();
  await until(() => state.patches.some((p) => p.id === idOf('C.RAF') && p.drive_id === 'drive-C.RAF'), { message: 'C settled' });
  assert.deepEqual(state.puts.filter((p) => p.who === 'C.RAF').map((p) => [p.range, p.auth]), [[`bytes */${raf.length}`, null]], 'a status ask, with no token');
  await page.waitForSelector(`.arrival.failed[data-id="${idOf('B.RAF')}"] .retry`);
  await page.setInputFiles('input[type=file]', { name: 'B.RAF', mimeType: 'application/octet-stream', buffer: raf });
  await until(() => state.photos.find((p) => p.name === 'B.RAF').drive_id === 'drive-B.RAF', { message: 'B in Drive by range' });
  assert.ok(state.puts.some((p) => p.who === 'B.RAF' && p.range === `bytes 100-${raf.length - 1}/${raf.length}`), 'resumed from byte 100');
  assert.equal(state.photos.length, 3, 'the same photo, not a new one');
  await until(async () => (await kept(page, idOf('B.RAF'))) == null, { message: 'B’s session forgotten' });
  await until(async () => !(await page.$('.arrival.failed')), { message: 'the failed row goes once it is in' });
  await shot(page, 'settled');
  assert.deepEqual(errors, []);
  await context.close();
});

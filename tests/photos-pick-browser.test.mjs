// Import from Drive in Chromium (PHOTOS.md §3.1), against a mock API and a fake Google: with no
// picker key the button is off and says why; with one, a tap (and only a tap) loads Google's loader,
// here a fake served at its address (the test never reaches Google), which opens a picker frame on
// docs.google.com and hands back two photos and a text file: the file is skipped with a toast, the
// photos are registered by reference, on the shelf at once as named placeholders, then given their
// thumbnails and previews from their originals in Drive (a RAF's header and embedded JPEG by ranged
// reads). The page's CSP names Google's hosts and no other, and nothing it does breaks it. An import
// from the phone decodes its embedded preview once for both the thumbnail and the preview.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { until } from './fixtures/waits.mjs';
import { makeRaf } from './fixtures/make-raf.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (mocked API)' };
const TOKEN = `th1_${'P'.repeat(43)}abcdef`;
const DAY = '2026-10-31';
let site, mock, browser, base;
const state = { key: '', photos: [], picks: [], previews: new Map(), registered: [], senses: [], files: new Map(), ranges: [] };
const err = (res, cors, status, code) => res.writeHead(status, { ...cors, 'Content-Type': 'application/json' }).end(JSON.stringify({ error: { code, message: 'x', request_id: '' } }));
const item = (o) => ({ name: 'x', format: 'jpeg', bytes: 1, sha256: null, camera: null, film: null, width: null, height: null, taken_at: Date.UTC(2026, 9, 31, 9), day: DAY, rating: 0, flag: null, preview: false, edited: false, deleted_at: null, created_at: Date.now(), ...o });

before(async () => {
  if (live) return;
  mock = createServer(async (req, res) => {
    const cors = { 'Access-Control-Allow-Origin': req.headers.origin ?? '', 'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, TH-Client', Vary: 'Origin' };
    if (req.method === 'OPTIONS') return res.writeHead(204, cors).end();
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const json = (value) => res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }).end(JSON.stringify(value));
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return err(res, cors, 401, 'unauthorized');
    const path = new URL(req.url, 'http://x').pathname;
    let m;
    if (req.method === 'PUT' && path.startsWith('/v1/senses/batches/')) {
      const { events } = JSON.parse(body.toString());
      state.senses.push(...events);
      return json({ accepted: events.length, rejected: [] });
    }
    if (path === '/v1/photos') {
      const days = [...new Set(state.photos.map((p) => p.day))].sort().reverse();
      return json({ days: days.map((d) => { const ps = state.photos.filter((p) => p.day === d); return { day: d, count: ps.length, photos: ps.slice(0, 4) }; }), next: null });
    }
    if (path === '/v1/photos/drive') return json({ configured: true, connected: true, folder_name: 'Thunderhead Photos', revoked: false, connected_at: 1, account: 'owner@example.test', picker_key: state.key, picker_app: '100000000001' });
    if (path === '/v1/photos/upload-token') return json({ access_token: 'fake-drive-token', expires_at: Date.now() + 3e6, folder_id: 'folder-1' });
    if (path === '/v1/settings') return json({ 'owner.tz': 'UTC', min_client: 0 });
    if (path === '/v1/photos/from-drive') {
      const { ids } = JSON.parse(body.toString());
      state.picks.push(ids);
      const added = ids.map((d, i) => item({ id: `019a0000-0000-7000-8000-00000000010${i}`, drive_id: d, name: state.files.get(d).name, format: d.includes('raf') ? 'raf' : 'jpeg' }));
      state.photos.push(...added);
      return json({ added, already: [], refused: [] });
    }
    if ((m = /^\/v1\/photos\/([^/]+)\/preview$/.exec(path)) && req.method === 'PUT') {
      state.previews.set(m[1], body);
      const p = state.photos.find((x) => x.id === m[1]);
      p.preview = true;
      return json({ photo: p });
    }
    if ((m = /^\/v1\/photos\/([^/]+)$/.exec(path)) && req.method === 'PUT') {
      const r = JSON.parse(body.toString());
      state.registered.push(r);
      const q = item({ ...r, id: m[1], day: new Date(r.taken_at).toISOString().slice(0, 10) });
      state.photos.push(q);
      return json({ photo: q });
    }
    err(res, cors, 404, 'not_found');
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  site = await serve(0, { api: `http://127.0.0.1:${mock.address().port}` });
  base = `http://127.0.0.1:${site.address().port}`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => {
  await browser?.close();
  site?.close();
  mock?.close();
});

/** Google's loader, faked at its own address: `gapi.load('picker')` gives a `google.picker` that
 * records how it was built, opens a frame on docs.google.com and hands back what `picked` names. */
const FAKE_GAPI = `window.gapi = { load(name, o) {
  const log = window.__picker = { views: [], features: [] };
  class DocsView { constructor(id) { this.v = { id }; log.views.push(this.v); } setIncludeFolders(f) { this.v.folders = f; return this; } setParent(p) { this.v.parent = p; return this; } }
  class PickerBuilder {
    setDeveloperKey(k) { log.key = k; return this; } setOAuthToken(t) { log.token = t; return this; } setOrigin(x) { log.origin = x; return this; }
    enableFeature(f) { log.features.push(f); return this; } setMaxItems(n) { log.max = n; return this; } setTitle() { return this; }
    addView() { return this; } setSize() { return this; } setAppId(a) { log.app = a; return this; } setCallback(cb) { this.cb = cb; return this; }
    build() { const cb = this.cb; return { setVisible() {
      const d = document.createElement('div'); d.className = 'picker-dialog';
      const f = document.createElement('iframe'); f.className = 'picker-dialog-frame'; f.src = 'https://docs.google.com/picker?protocol=gadgets';
      f.onload = () => { log.framed = true; d.remove(); cb({ action: 'picked', docs: window.__picked }); };
      d.append(f); document.body.append(d);
    } }; }
  }
  window.google = { picker: { DocsView, PickerBuilder, ViewId: { DOCS: 'all' }, Feature: { MULTISELECT_ENABLED: 'multi' }, Response: { ACTION: 'action', DOCUMENTS: 'docs' }, Action: { PICKED: 'picked', CANCEL: 'cancel' }, Document: { ID: 'id', NAME: 'name' } } };
  o.callback();
} };`;

async function open(path) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
  const google = [];
  await context.route('https://apis.google.com/**', (r) => { google.push(r.request().url()); return r.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE_GAPI }); });
  await context.route('https://docs.google.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>picker</p>' }));
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Location, Range, Content-Length' };
  await context.route('https://www.googleapis.com/drive/v3/files/**', (r) => {
    const id = decodeURIComponent(new URL(r.request().url()).pathname.split('/').pop());
    const bytes = state.files.get(id).bytes;
    const range = /bytes=(\d+)-(\d+)/.exec(r.request().headers().range ?? '');
    state.ranges.push(`${id} ${range ? range.slice(1).join('-') : 'all'}`);
    return r.fulfill({ status: range ? 206 : 200, headers: { ...cors, 'Content-Type': 'application/octet-stream' }, body: Buffer.from(range ? bytes.slice(+range[1], +range[2] + 1) : bytes) });
  });
  await context.route('https://www.googleapis.com/upload/drive/v3/files**', (r) => r.request().method() === 'POST'
    ? r.fulfill({ status: 200, headers: { ...cors, Location: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=s1' }, body: '' })
    : r.fulfill({ status: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'drive-phone-1' }) }));
  // Every decode on the page, counted.
  await context.addInitScript(() => {
    const real = window.createImageBitmap.bind(window);
    window.__decodes = 0;
    window.createImageBitmap = (...a) => { window.__decodes++; return real(...a); };
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && /Content Security Policy|Refused|Uncaught/i.test(m.text())) errors.push(m.text()); });
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
  return { page, context, errors, google };
}

/** An invented picture (a sky and a sun) as JPEG bytes, drawn in the browser. */
const drawJpeg = (page) => page.evaluate(async () => {
  const c = new OffscreenCanvas(640, 427);
  const g = c.getContext('2d');
  g.fillStyle = '#3a78b8'; g.fillRect(0, 0, 640, 427);
  g.fillStyle = '#ffd34d'; g.beginPath(); g.arc(470, 140, 46, 0, 7); g.fill();
  return [...new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 })).arrayBuffer())];
});
const shot = (page, name) => process.env.TH_SHOTS && page.screenshot({ path: `${process.env.TH_SHOTS}/photos-${name}.png` });

test('From Drive is off without a picker key, and says why; the CSP names Google’s hosts and no other', opts, async () => {
  state.key = '';
  const { page, context, errors, google } = await open('/photos/');
  await page.waitForSelector('.dnote:not([hidden])');
  assert.equal(await page.textContent('.dnote'), 'Importing from Drive needs a picker key for your Worker first (SETUP.md, Photos).');
  assert.ok(await page.$eval('.add.alt', (b) => b.disabled));
  const csp = await page.getAttribute('meta[http-equiv="Content-Security-Policy"]', 'content');
  const hosts = [...csp.matchAll(/https:\/\/[^\s;]+/g)].map((m) => m[0]).filter((h) => !h.startsWith('http://127.0.0.1'));
  assert.deepEqual([...new Set(hosts)].sort(), ['https://apis.google.com', 'https://docs.google.com', 'https://www.googleapis.com']);
  assert.match(csp, /script-src 'self' 'wasm-unsafe-eval' https:\/\/apis\.google\.com;/);
  assert.match(csp, /frame-src 'self' https:\/\/docs\.google\.com;/);
  await shot(page, 'no-key');
  assert.deepEqual(google, [], 'nothing from Google before a tap');
  assert.deepEqual(errors, []);
  await context.close();
});

test('picked in Drive: one skipped with a toast, two registered by reference, on the shelf at once, then their previews', opts, async () => {
  state.key = 'fake-picker-key';
  const { page, context, errors, google } = await open('/photos/');
  const jpeg = Uint8Array.from(await drawJpeg(page));
  state.files.set('drive-raf-9', { name: 'DSCF0900.RAF', bytes: makeRaf(jpeg) });
  state.files.set('drive-jpg-9', { name: 'IMG_0900.JPG', bytes: jpeg });
  await page.evaluate(() => { window.__picked = [{ id: 'drive-raf-9', name: 'DSCF0900.RAF' }, { id: 'drive-jpg-9', name: 'IMG_0900.JPG' }, { id: 'drive-txt-9', name: 'notes.txt' }]; });
  await page.waitForSelector('.add.alt:not([disabled])');
  assert.deepEqual(google, [], 'the loader waits for a tap');
  await page.click('.add.alt');
  await until(() => state.picks.length === 1, { message: 'the picked photos were registered' });
  assert.deepEqual(google, ['https://apis.google.com/js/api.js']);
  const log = await page.evaluate(() => window.__picker);
  assert.deepEqual({ key: log.key, token: log.token, app: log.app, max: log.max, multi: log.features, framed: log.framed },
    { key: 'fake-picker-key', token: 'fake-drive-token', app: '100000000001', max: 100, multi: ['multi'], framed: true });
  assert.deepEqual(log.views.map((v) => [v.parent, v.folders]), [['folder-1', true], ['root', true]], 'the app’s folder first, then all of My Drive');
  assert.deepEqual(state.picks[0], ['drive-raf-9', 'drive-jpg-9'], 'the text file never travels');
  await page.waitForSelector('.toast:text("1 skipped: only RAF, DNG, JPEG and HEIC files import.")', { state: 'attached' });
  // Both on the shelf at once, named, then with their thumbnails.
  await page.waitForSelector(`.dayhead[data-day="${DAY}"]`);
  await until(() => state.previews.size === 2, { message: 'both previews sent' });
  await page.waitForSelector('.tile[data-id$="100"] img.thumb');
  await page.waitForSelector('.tile[data-id$="101"] img.thumb');
  assert.ok(state.ranges.includes('drive-raf-9 0-91'), 'a RAF costs its header by ranged read');
  assert.ok(state.ranges.some((r) => r.startsWith('drive-raf-9 ') && r !== 'drive-raf-9 0-91' && r !== 'drive-raf-9 all'), '…and its embedded JPEG');
  for (const b of state.previews.values()) assert.ok(b[0] === 0xff && b[1] === 0xd8 && b.length <= 400 * 1024);
  await page.waitForSelector('.arrival.fromdrive.in');
  assert.match(await page.textContent('.arrival.fromdrive .anote'), /^2 photos from Drive on the shelf\.$/);
  assert.equal(await page.evaluate(() => window.__decodes), 2, 'one decode a photo');
  await shot(page, 'from-drive');
  await until(() => state.senses.filter((e) => e.type === 'photo.import').length === 2, { timeout: 20_000, message: 'the senses went' });
  const sensed = state.senses.filter((e) => e.type === 'photo.import').map((e) => e.data).sort((a, b) => a.format.localeCompare(b.format));
  assert.deepEqual(sensed, [{ format: 'jpeg', source: 'drive' }, { format: 'raf', source: 'drive' }]);
  assert.deepEqual(errors, []);
  await context.close();
});

test('a placeholder tile names the photo until its preview comes', opts, async () => {
  const { page, context, errors } = await open('/photos/');
  await page.waitForSelector(`.dayhead[data-day="${DAY}"]`);
  await page.evaluate(async () => {
    const data = await import('/apps/photos/data.js');
    data.coming.add('019a0000-0000-7000-8000-000000000199');
  });
  state.photos.push(item({ id: '019a0000-0000-7000-8000-000000000199', drive_id: 'drive-late', name: 'DSCF0999.RAF', day: '2026-11-01' }));
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('photos:changed')));
  await page.waitForSelector('.tile.blank .tnote:text("Preview coming")');
  assert.equal(await page.textContent('.tile.blank .tname'), 'DSCF0999.RAF');
  await shot(page, 'placeholder');
  state.photos.pop();
  assert.deepEqual(errors, []);
  await context.close();
});

test('an import from the phone decodes its embedded preview once, for the thumbnail and the preview', opts, async () => {
  const { page, context, errors } = await open('/photos/');
  await page.waitForSelector('.add:not(.alt)');
  const raf = makeRaf(Uint8Array.from(await drawJpeg(page)));
  await page.setInputFiles('input[type=file]', { name: 'DSCF0123.RAF', mimeType: 'application/octet-stream', buffer: Buffer.from(raf) });
  await page.waitForSelector('.arrival img[src^="blob:"]');
  await until(() => state.registered.length === 1 && state.previews.size === 3, { message: 'registered with its preview' });
  assert.equal(await page.evaluate(() => window.__decodes), 1);
  await until(() => state.senses.some((e) => e.type === 'photo.import' && e.data.source === 'phone'), { timeout: 20_000, message: 'the sense went' });
  assert.deepEqual(errors, []);
  await context.close();
});

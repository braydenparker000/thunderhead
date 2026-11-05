// The Info sheet in Chromium (PHOTOS.md § Info), against a mock API and a fake Google Drive: a
// synthetic JPEG (drawn in the page, never a photograph) carrying invented EXIF, a Fujifilm maker note
// and a GPS IFD with an invented place. Registered without its info, it gets it on its first open in the
// editor (PUT /v1/photos/:id/info, from the original's first bytes); the Info button opens the sheet at
// 390×844: its sections, 48 px rows, the live histogram, Copy. The place is in the file and nowhere in
// what is sent, shown or copied. Screens go to TH_SHOTS when it is set.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { fullSet } from './fixtures/make-exif.mjs';
import { until } from './fixtures/waits.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (mocked API)' };
const TOKEN = `th1_${'P'.repeat(43)}abcdef`;
const ID = '0192aaaa-bbbb-7ccc-8ddd-eeeeffff0002';
const SHOTS = process.env.TH_SHOTS;
const PLACE = /gps|latitude|longitude|35°|139°|\b3105\b|\b4344\b/i;
const state = { info: null, infoPuts: [], senses: [], jpeg: Buffer.alloc(0), preview: Buffer.alloc(0), ranges: [] };
const photo = () => ({ id: ID, drive_id: 'drive-file-7', name: 'DSCF0002.JPG', format: 'jpeg', bytes: state.jpeg.length, width: 1500, height: 1000, sha256: 'c'.repeat(64), camera: 'FUJIFILM X-E5', film: null, taken_at: Date.UTC(2026, 9, 3, 9), day: '2026-10-03', rating: 0, flag: null, preview: true, edited: false, deleted_at: null, created_at: 1 });
let site, mock, browser, base;

/** The drawn JPEG with an APP1 "Exif" right after its SOI. */
function withExif(jpeg, tiff) {
  const len = 2 + 6 + tiff.length;
  return Buffer.concat([jpeg.subarray(0, 2), Buffer.from([0xff, 0xe1, len >> 8, len & 255]), Buffer.from('Exif\0\0', 'binary'), Buffer.from(tiff), jpeg.subarray(2)]);
}

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
    if (path === '/v1/photos/drive') return json(200, { configured: true, connected: true, folder_name: 'Thunderhead Photos', revoked: false, connected_at: 1, account: null, picker_key: '', picker_app: '' });
    if (path === '/v1/settings') return json(200, { 'owner.tz': 'UTC', min_client: 0 });
    if (path === `/v1/photos/${ID}/preview`) return res.writeHead(200, { ...cors, 'Content-Type': 'image/jpeg' }).end(state.preview);
    if (path === `/v1/photos/${ID}/versions`) return json(200, { items: [{ id: 'v1' }, { id: 'v2' }] });
    if (path === `/v1/photos/${ID}/info` && req.method === 'PUT') { const b = JSON.parse(body); state.infoPuts.push(body); state.info = b.info; return json(200, { photo: photo(), changed: true }); }
    if (path === `/v1/photos/${ID}`) return json(200, { photo: photo(), recipe: {}, info: state.info });
    json(404, { error: { code: 'not_found', message: 'x', request_id: '' } });
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  site = await serve(0, { api: `http://127.0.0.1:${mock.address().port}` });
  base = `http://127.0.0.1:${site.address().port}`;
  const exe = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
  browser = await chromium.launch({ ...exe, args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader'] });
  const page = await browser.newPage();
  const draw = async (w, h) => Buffer.from(await page.evaluate(async ([w, h]) => {
    const c = new OffscreenCanvas(w, h), g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, w, h);
    ['#1d3557', '#457b9d', '#a8dadc', '#f1faee', '#e63946'].forEach((col, i) => grad.addColorStop(i / 4, col));
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
    return [...new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 })).arrayBuffer())];
  }, [w, h]));
  state.jpeg = withExif(await draw(1500, 1000), fullSet(true).tiff);
  state.preview = await draw(1024, 683);
  await page.close();
});
after(async () => { await browser?.close(); site?.close(); mock?.close(); });

async function open(path) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await context.route('https://www.googleapis.com/drive/v3/files/**', (route) => {
    state.ranges.push(route.request().headers().range ?? 'all');
    route.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Content-Length', 'Content-Type': 'application/octet-stream' }, body: state.jpeg });
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
  return { context, page, errors };
}

test('first open reads the info from the original, the sheet shows it at 390×844, Copy copies it, the place goes nowhere', opts, async () => {
  const { context, page, errors } = await open(`/photos/?edit=${ID}`);

  // The first open: the original's first bytes read (a range, never the whole file), the info sent.
  await until(() => state.infoPuts.length === 1, { message: 'the info was never sent' });
  assert.ok(state.ranges.includes('bytes=0-163839'), JSON.stringify(state.ranges));
  const sent = JSON.parse(state.infoPuts[0]);
  // The film it lacked goes with it; the camera it has is not sent again.
  assert.deepEqual([Object.keys(sent), sent.film], [['info', 'film'], 'Classic Chrome']);
  assert.equal(sent.info.film_mode, 0x600);
  assert.equal(sent.info.lens, 'XF23mmF2 R WR');
  assert.doesNotMatch(state.infoPuts[0], PLACE);

  // The sheet from the top bar, once the editor has drawn the original and settled.
  await until(() => page.evaluate(() => { const e = document.querySelector('.editor'); return e?.dataset.frame === 'original' && e.dataset.idle === 'true'; }), { timeout: 30_000, message: 'the original never drew' });
  await page.locator('.einfo').click();
  await page.waitForSelector('.isheet .ibody:not([aria-busy])');
  const text = await page.locator('.isheet').innerText();
  for (const s of ['Camera', 'Film', 'Image', 'Histogram', 'Edit', 'Drive', 'XF23mmF2 R WR', '1/250 s · f/2.8 · ISO 400', '−2/3 EV', 'Aperture priority', 'Classic Chrome', 'DR400', 'Strong, large', 'R +2, B −1', 'Sensor-shift, continuous', '7728 × 5152', 'Turned 90° right', 'As shot', 'In Drive', 'Thunderhead Photos'])
    assert.ok(text.includes(s), `the sheet shows ${s}`);
  assert.match(text, /Versions\s+2/);
  assert.doesNotMatch(text, PLACE);
  const heights = await page.$$eval('.isheet .irow', (rows) => rows.map((r) => r.getBoundingClientRect().height));
  assert.ok(heights.length > 25 && heights.every((h) => h >= 48), JSON.stringify(heights));
  const fits = await page.evaluate(() => { const r = document.querySelector('.isheet').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; });
  assert.ok(fits, 'the sheet fits the screen');
  // The histogram, drawn: some lit pixels.
  await until(() => page.evaluate(() => { const c = document.querySelector('.ihist'); return c && c.getContext('2d').getImageData(0, 0, c.width, c.height).data.some((v, i) => i % 4 === 3 && v > 0); }), { message: 'the histogram never drew' });
  assert.equal(await page.locator('.ihist').getAttribute('data-from'), 'live', 'the editor’s histogram is its live render’s');
  if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: `${SHOTS}/photos-info-sheet.png` }); }
  await page.locator('.isheet').evaluate((s) => { s.scrollTop = s.scrollHeight; });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/photos-info-sheet-end.png` });

  // Copy: the text block, without the place.
  await page.locator('.icopy').click();
  const copied = await until(() => page.evaluate(() => navigator.clipboard.readText().catch(() => '')), { message: 'nothing was copied' });
  assert.match(copied, /^Camera\nBody: FUJIFILM X-E5\nLens: XF23mmF2 R WR/);
  assert.match(copied, /\n\nFilm\nFilm simulation: Classic Chrome\nDynamic range: DR400\n/);
  assert.doesNotMatch(copied, PLACE);
  // Nothing about it went to the mind.
  assert.ok(!state.senses.some((e) => JSON.stringify(e).includes('film_mode') || /info/.test(e.type)), JSON.stringify(state.senses));
  // Opened again, the info is known: no second read.
  await page.mouse.click(195, 40);
  await page.waitForSelector('.isheet', { state: 'detached' });
  assert.deepEqual(errors, []);
  await context.close();
});

test('the shelf’s tile menu opens the same sheet over the shelf', opts, async () => {
  const { context, page, errors } = await open('/photos/');
  const tile = page.locator(`.days .tile[data-id="${ID}"]`);
  const b = await tile.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await until(() => page.locator('.tmenu').isVisible(), { message: 'the long press did not open the menu' });
  await page.mouse.up();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/photos-info-menu.png` });
  await page.locator('.tmenu .pact', { hasText: 'Info' }).click();
  await page.waitForSelector('.psheet.isheet .ibody:not([aria-busy])');
  const text = await page.locator('.isheet').innerText();
  for (const s of ['Classic Chrome', 'XF23mmF2 R WR', 'In Drive']) assert.ok(text.includes(s), `the sheet shows ${s}`);
  assert.doesNotMatch(text, PLACE);
  await until(() => page.evaluate(() => { const c = document.querySelector('.ihist'); return c && c.getContext('2d').getImageData(0, 0, c.width, c.height).data.some((v, i) => i % 4 === 3 && v > 0); }), { message: 'the preview’s histogram never drew' });
  assert.equal(await page.locator('.ihist').getAttribute('data-from'), 'preview');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/photos-info-shelf.png` });
  assert.equal(state.infoPuts.length, 1, 'the info, known, is not read again');
  assert.deepEqual(errors, []);
  await context.close();
});

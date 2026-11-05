// The shelf's stacks, stars, heart and filter, and culling in the editor, in Chromium (PHOTOS.md, the
// shelf; culling), against a mock API and a fake Drive, on synthetic JPEGs drawn in the page: a RAW
// and its JPEG are one tile with a RAW+JPEG badge; a long press opens the tile's menu, where a star
// and the heart save (PATCH, photo.rate) and Open the JPEG opens the JPEG; a filter chip asks the
// Worker for that filter and is kept across a reload; in the editor a swipe left goes to the older
// photo under the filter, a swipe up opens the star row and 0–5 and f work from the keyboard. At 390×844.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { until } from './fixtures/waits.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (mocked API)', timeout: 180_000 };
const TOKEN = `th1_${'S'.repeat(43)}abcdef`;
const [R, J, B, C] = ['0192bbbb-cccc-7ddd-8eee-ffff00000001', '0192bbbb-cccc-7ddd-8eee-ffff00000002', '0192bbbb-cccc-7ddd-8eee-ffff00000003', '0192bbbb-cccc-7ddd-8eee-ffff00000004'];
const SHOTS = process.env.TH_SHOTS;
const state = { marks: {}, patches: [], filters: [], senses: [], jpeg: Buffer.alloc(0), preview: Buffer.alloc(0) };
const base = { bytes: 1000, width: 1500, height: 1000, sha256: 'd'.repeat(64), camera: 'Example Camera', film: null, day: '2026-10-04', flag: null, preview: true, edited: false, deleted_at: null, created_at: 1 };
const photo = (id) => ({
  ...base,
  id,
  drive_id: `drive-${id.slice(-4)}`,
  ...{ [R]: { name: 'DSCF0101.RAF', format: 'raf', pair_id: J, taken_at: Date.UTC(2026, 9, 4, 12) }, [J]: { name: 'DSCF0101.JPG', format: 'jpeg', pair_id: R, taken_at: Date.UTC(2026, 9, 4, 12) }, [B]: { name: 'IMG_0201.JPG', format: 'jpeg', pair_id: null, taken_at: Date.UTC(2026, 9, 4, 11) }, [C]: { name: 'IMG_0202.JPG', format: 'jpeg', pair_id: null, taken_at: Date.UTC(2026, 9, 4, 10) } }[id],
  rating: state.marks[id]?.rating ?? 0,
  favorite: state.marks[id]?.favorite ?? false,
});
const shown = (f) => [R, B, C].map(photo).filter((p) => f !== 'favorites' || p.favorite);
let site, mock, browser, url;

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
    const u = new URL(req.url, 'http://x');
    const path = u.pathname;
    const id = path.match(/^\/v1\/photos\/([0-9a-f-]{36})/)?.[1];
    if (path.startsWith('/v1/senses/batches/')) { const { events } = JSON.parse(body); state.senses.push(...events); return json(200, { accepted: events.length, rejected: [] }); }
    if (path === '/v1/photos') {
      const f = u.searchParams.get('filter') ?? 'all';
      state.filters.push(f);
      const list = shown(f);
      return json(200, { days: list.length ? [{ day: '2026-10-04', count: list.length, photos: list }] : [], next: null });
    }
    if (path === '/v1/photos/upload-token') return json(200, { access_token: 'fake-drive-token', expires_at: Date.now() + 3e6, folder_id: 'folder-1' });
    if (path === '/v1/photos/drive') return json(200, { configured: true, connected: true, picker_key: null });
    if (path === '/v1/settings') return json(200, { 'owner.tz': 'UTC', min_client: 0 });
    if (id && path.endsWith('/around')) {
      const order = shown(u.searchParams.get('filter') ?? 'all').map((p) => p.id);
      const i = order.indexOf(id === J ? R : id);
      return json(200, { newer: order[i - 1] ?? null, older: order[i + 1] ?? null });
    }
    if (id && path.endsWith('/preview')) return res.writeHead(200, { ...cors, 'Content-Type': 'image/jpeg' }).end(state.preview);
    if (id && path.endsWith('/versions')) return json(200, { items: [] });
    if (id && req.method === 'PATCH') {
      const b = JSON.parse(body);
      state.patches.push({ id, ...b });
      // A stack's marks are on both its photos.
      for (const k of [id, photo(id).pair_id].filter(Boolean)) state.marks[k] = { ...photo(k), ...state.marks[k], ...b };
      return json(200, { photo: photo(id) });
    }
    if (id && req.method === 'GET') return json(200, { photo: photo(id), recipe: {} });
    json(404, { error: { code: 'not_found', message: 'x', request_id: '' } });
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  site = await serve(0, { api: `http://127.0.0.1:${mock.address().port}` });
  url = `http://127.0.0.1:${site.address().port}`;
  const exe = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
  browser = await chromium.launch({ ...exe, args: ['--disable-features=WebGPU'] });
  const page = await browser.newPage();
  const draw = async (w, h, hue) => Buffer.from(await page.evaluate(async ([w, h, hue]) => {
    const c = new OffscreenCanvas(w, h), g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, `hsl(${hue} 60% 35%)`); grad.addColorStop(1, `hsl(${hue + 60} 70% 70%)`);
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
    return [...new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 })).arrayBuffer())];
  }, [w, h, hue]));
  state.jpeg = await draw(1500, 1000, 200);
  state.preview = await draw(1024, 683, 30);
  await page.close();
});
after(async () => { await browser?.close(); site?.close(); mock?.close(); });

async function open(path) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
  await context.route('https://www.googleapis.com/drive/v3/files/**', (route) => route.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Content-Length', 'Content-Type': 'application/octet-stream' }, body: state.jpeg }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && /Content Security Policy|Refused|Uncaught/i.test(m.text())) errors.push(m.text()); });
  await page.goto(`${url}/no-such-page`);
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
  await page.goto(`${url}${path}`, { waitUntil: 'load' });
  return { context, page, errors };
}
const shot = async (page, name) => { if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: `${SHOTS}/photos-shelf-${name}.png` }); } };
const tile = (page, id) => page.locator(`.days .tile[data-id="${id}"]`);
async function hold(page, id) {
  const b = await tile(page, id).boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await until(() => page.locator('.tmenu').isVisible(), { message: 'the long press did not open the menu' });
  await page.mouse.up();
}
/** A one-finger drag on the editor's photo, in steps. */
async function swipe(page, dx, dy) {
  const b = await page.locator('.estage').boundingBox();
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(x + (dx * i) / 8, y + (dy * i) / 8);
  await page.mouse.up();
}
const drawn = (page) => until(() => page.evaluate(() => Number(document.querySelector('.editor')?.dataset.frames) > 0), { timeout: 30_000, message: 'the editor never drew' });

test('a stack is one tile; stars and the heart from the menu; Open the JPEG; the filter chips', opts, async () => {
  state.marks = {}; state.patches = []; state.filters = []; state.senses = [];
  const { context, page, errors } = await open('/photos/');
  await tile(page, C).waitFor();
  assert.equal(await page.locator(`.days .tile[data-id="${J}"]`).count(), 0, 'the JPEG of the stack has no tile of its own');
  assert.equal(await tile(page, R).locator('.tbadge').innerText(), 'RAW+JPEG');
  assert.equal(await tile(page, B).locator('.tbadge').count(), 0);
  const chips = await page.locator('.fchip').allInnerTexts();
  assert.deepEqual(chips, ['All', 'Favourites', '★3+', '★4+', '★5', 'RAW', 'JPEG', 'Edited', 'Unedited']);
  assert.equal(await page.locator('.fchip[data-filter="all"]').getAttribute('aria-pressed'), 'true');
  await shot(page, 'stack');
  // The menu: four stars, then the heart, on the tile at once.
  await hold(page, B);
  await shot(page, 'menu');
  const sheet = await page.locator('.tmenu').boundingBox();
  assert.ok(sheet && sheet.x >= 0 && sheet.x + sheet.width <= 390.5 && sheet.y + sheet.height <= 844.5, JSON.stringify(sheet));
  await page.locator('.tmenu .star[aria-label="4 stars"]').click();
  await until(() => tile(page, B).locator('.tstars').count().then((n) => n === 1), { message: 'the tile did not show its stars' });
  await page.locator('.tmenu .heart').click();
  await until(() => tile(page, B).locator('.tfav').count().then((n) => n === 1), { message: 'the tile did not show its heart' });
  assert.deepEqual(state.patches, [{ id: B, rating: 4 }, { id: B, favorite: true }]);
  await until(() => state.senses.filter((e) => e.type === 'photo.rate').length >= 2, { timeout: 20_000, message: 'no photo.rate sense' });
  const rate = state.senses.find((e) => e.type === 'photo.rate' && e.data?.favorite === true);
  assert.equal(rate?.ref, `photo:${B}`);
  assert.equal(JSON.stringify(rate).includes('IMG_0201'), false, 'the sense carries no name');
  await page.locator('.tdim').click();
  // A stack's menu opens its JPEG.
  await hold(page, R);
  await page.locator('.tmenu .pact', { hasText: 'Open the JPEG' }).click();
  await until(() => page.url().includes(`?photo=${J}`), { message: 'Open the JPEG did not open it' });
  await page.locator('.marks .mark', { hasText: 'The JPEG of a RAW+JPEG' }).waitFor();
  // The filter: the Worker is asked, and the chip is kept across a reload.
  await page.goto(`${url}/photos/`, { waitUntil: 'load' });
  await tile(page, C).waitFor();
  await page.locator('.fchip[data-filter="favorites"]').click();
  await until(() => state.filters.at(-1) === 'favorites', { message: 'the Worker was not asked for favourites' });
  await until(() => page.locator('.days .tile').count().then((n) => n === 1), { message: 'the shelf did not filter' });
  assert.equal(await tile(page, B).count(), 1);
  await shot(page, 'filter');
  await page.reload({ waitUntil: 'load' });
  await tile(page, B).waitFor();
  assert.equal(await page.locator('.fchip[data-filter="favorites"]').getAttribute('aria-pressed'), 'true');
  assert.equal(state.filters.at(-1), 'favorites');
  const over = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  assert.equal(over, false, 'no sideways scroll at 390 px');
  assert.deepEqual(errors, []);
  await context.close();
});

test('culling: swipe to the older photo, swipe up for the stars, keys 0–5 and f', opts, async () => {
  state.marks = {}; state.patches = [];
  const { context, page, errors } = await open(`/photos/?edit=${B}`);
  await page.evaluate(() => localStorage.setItem('th.photos.filter', 'all'));
  await drawn(page);
  // Swipe up: the star row; a star saves; swipe down closes it.
  await swipe(page, 0, -160);
  await page.locator('.erate .stars').waitFor();
  await shot(page, 'star-row');
  await page.locator('.erate .star[aria-label="3 stars"]').click();
  await until(() => state.patches.some((p) => p.id === B && p.rating === 3), { message: 'the star did not save' });
  await until(() => page.locator('.erate .star.on').count().then((n) => n === 3), { message: 'the row did not show 3 stars' });
  await swipe(page, 0, 160);
  await until(() => page.locator('.erate').isHidden(), { message: 'a swipe down did not close the row' });
  // The keyboard: 5, then f.
  await page.keyboard.press('5');
  await page.keyboard.press('f');
  await until(() => state.patches.some((p) => p.rating === 5) && state.patches.some((p) => p.favorite === true), { message: 'the keys did not save' });
  // Swipe left: the older photo under the filter, in place of this one (back still leaves the editor).
  const depth = await page.evaluate(() => history.length);
  await swipe(page, -200, 10);
  await until(() => page.url().includes(`?edit=${C}`), { message: 'the swipe did not go to the older photo' });
  await drawn(page);
  assert.equal(await page.evaluate(() => history.length), depth, 'culling replaces the place rather than stacking it');
  // Nothing older than the last: it stays, and says so.
  await swipe(page, -200, 0);
  await page.locator('.toast', { hasText: 'No older photo' }).waitFor();
  assert.ok(page.url().includes(`?edit=${C}`));
  // A swipe right goes back to the newer one.
  await swipe(page, 200, 0);
  await until(() => page.url().includes(`?edit=${B}`), { message: 'the swipe right did not go to the newer photo' });
  await drawn(page);
  await shot(page, 'culled');
  assert.deepEqual(errors, []);
  await context.close();
});

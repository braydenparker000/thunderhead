// Photos in Chromium (PHOTOS.md §3.1), against a mock API and a fake Google Drive: importing a
// synthetic RAF (an invented JPEG inside a RAF header, tests/fixtures/make-raf.mjs) shows its
// embedded preview at once, uploads the original to Drive itself (a dropped chunk resumes the same
// session), registers what the file says (camera, capture time, film simulation) and sends a
// preview of at most 400 KB; the shelf by day; the full-bleed view, a hold for the sheet, a rating;
// delete and restore; the shelf and the view offline; and a Galaxy A35-sized phone. No CSP or page
// errors. Screens at 390×844 go to TH_SHOTS when it is set.
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
const OLD = '2026-09-12';
let site, mock, browser, base;
const state = { photos: [], previews: new Map(), registered: [], patches: [], senses: [], down: false, drive: { puts: 0, dropped: false } };

const photo = (over) => ({ drive_id: 'd0', name: 'DSCF0100.RAF', format: 'raf', bytes: 1000, sha256: 'b'.repeat(64), camera: 'FUJIFILM X-E5', film: 'Velvia', width: 640, height: 427, taken_at: Date.UTC(2026, 8, 12, 9), day: OLD, rating: 0, flag: null, preview: false, deleted_at: null, created_at: Date.now(), ...over });

before(async () => {
  if (live) return;
  mock = createServer(async (req, res) => {
    const cors = { 'Access-Control-Allow-Origin': req.headers.origin ?? '', 'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, TH-Client', Vary: 'Origin' };
    if (state.down) return res.destroy();
    if (req.method === 'OPTIONS') return res.writeHead(204, cors).end();
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const json = (status, value) => res.writeHead(status, { ...cors, 'Content-Type': 'application/json' }).end(JSON.stringify(value));
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return json(401, { error: { code: 'unauthorized', message: 'x', request_id: '' } });
    const url = new URL(req.url, 'http://x');
    const path = url.pathname;
    const live = state.photos.filter((p) => !p.deleted_at);
    let m;
    if (req.method === 'PUT' && path.startsWith('/v1/senses/batches/')) {
      const { events } = JSON.parse(body.toString());
      state.senses.push(...events);
      return json(200, { accepted: events.length, rejected: [] });
    }
    if (path === '/v1/photos' && url.searchParams.get('day')) {
      const ps = live.filter((p) => p.day === url.searchParams.get('day'));
      return json(200, { days: ps.length ? [{ day: ps[0].day, count: ps.length, photos: ps }] : [], next: null });
    }
    if (path === '/v1/photos') {
      const days = [...new Set(live.map((p) => p.day))].sort().reverse();
      return json(200, { days: days.map((d) => { const ps = live.filter((p) => p.day === d).sort((a, b) => b.taken_at - a.taken_at); return { day: d, count: ps.length, photos: ps.slice(0, 4) }; }), next: null });
    }
    if (path === '/v1/photos/deleted') return json(200, { items: state.photos.filter((p) => p.deleted_at) });
    if (path === '/v1/photos/upload-token') return json(200, { access_token: 'fake-drive-token', expires_at: Date.now() + 3e6, folder_id: 'folder-1' });
    if (path === '/v1/photos/drive' && req.method === 'DELETE') { state.connected = false; return res.writeHead(204, cors).end(); }
    if (path === '/v1/photos/drive') return json(200, { configured: true, connected: state.connected !== false, folder_name: state.connected !== false ? 'Thunderhead Photos' : null, revoked: false, connected_at: 1, account: state.connected !== false ? 'owner@example.test' : null });
    if (path === '/v1/photos/drive/connect') return json(200, { url: 'https://accounts.google.com/o/oauth2/v2/auth?scope=drive.file&state=s1' });
    if (path === '/v1/settings') return json(200, { 'owner.tz': 'UTC', min_client: 0 });
    if ((m = /^\/v1\/photos\/([^/]+)\/preview$/.exec(path))) {
      if (req.method === 'PUT') {
        state.previews.set(m[1], body);
        const p = state.photos.find((x) => x.id === m[1]);
        p.preview = true;
        return json(200, { photo: p });
      }
      const b = state.previews.get(m[1]);
      return b ? res.writeHead(200, { ...cors, 'Content-Type': 'image/jpeg' }).end(b) : json(404, { error: { code: 'not_found', message: 'x', request_id: '' } });
    }
    if ((m = /^\/v1\/photos\/([^/]+)\/restore$/.exec(path))) {
      const p = state.photos.find((x) => x.id === m[1]);
      p.deleted_at = null;
      return json(200, { photo: p });
    }
    if ((m = /^\/v1\/photos\/([^/]+)$/.exec(path))) {
      const p = state.photos.find((x) => x.id === m[1]);
      if (req.method === 'PUT') {
        const r = JSON.parse(body.toString());
        state.registered.push(r);
        const q = photo({ ...r, id: m[1], day: new Date(r.taken_at).toISOString().slice(0, 10) });
        state.photos.push(q);
        return json(201, { photo: q });
      }
      if (!p) return json(404, { error: { code: 'not_found', message: 'x', request_id: '' } });
      if (req.method === 'PATCH') { Object.assign(p, JSON.parse(body.toString())); state.patches.push(JSON.parse(body.toString())); }
      if (req.method === 'DELETE') p.deleted_at = Date.now();
      return json(200, { photo: p });
    }
    json(404, { error: { code: 'not_found', message: 'x', request_id: '' } });
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

/** Google Drive's resumable upload, faked: the first chunk drops, the status asks get "nothing yet". */
async function fakeDrive(context) {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Location, Range' };
  await context.route('https://www.googleapis.com/upload/drive/v3/files**', async (route) => {
    const r = route.request();
    if (r.method() === 'POST') {
      assert.equal(r.headers().authorization, 'Bearer fake-drive-token');
      assert.deepEqual(JSON.parse(r.postData()).parents, ['folder-1']);
      return route.fulfill({ status: 200, headers: { ...cors, Location: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=session-1' }, body: '' });
    }
    state.drive.puts++;
    const range = r.headers()['content-range'];
    if (!state.drive.dropped && !range.startsWith('bytes */')) {
      state.drive.dropped = true;
      return route.abort('connectionreset');
    }
    if (range.startsWith('bytes */')) return route.fulfill({ status: 308, headers: cors, body: '' });
    return route.fulfill({ status: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'drive-file-1' }) });
  });
}

async function open(path, device = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 }) {
  const context = await browser.newContext({ ...device, hasTouch: true });
  await fakeDrive(context);
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
  return { page, context, errors };
}

/** An invented picture: a sky, a hill and a sun, drawn in the browser as a JPEG. */
const drawJpeg = (page) => page.evaluate(async () => {
  const c = new OffscreenCanvas(640, 427);
  const g = c.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, 427);
  sky.addColorStop(0, '#2a6fb0'); sky.addColorStop(1, '#f2c27a');
  g.fillStyle = sky; g.fillRect(0, 0, 640, 427);
  g.fillStyle = '#ffd34d'; g.beginPath(); g.arc(470, 140, 46, 0, 7); g.fill();
  g.fillStyle = '#2f5d3a'; g.beginPath(); g.ellipse(250, 470, 420, 170, 0, 0, 7); g.fill();
  return [...new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 })).arrayBuffer())];
});
const shot = (page, name) => process.env.TH_SHOTS && page.screenshot({ path: `${process.env.TH_SHOTS}/photos-${name}.png` });

test('import a RAF: its preview at once, the original to Drive, the shelf by day, the view, delete and restore, offline', opts, async () => {
  state.photos.push(photo({ id: '019a0000-0000-7000-8000-000000000001' }));
  const { page, context, errors } = await open('/photos/');
  await page.waitForSelector(`.dayhead[data-day="${OLD}"]`);
  assert.match(await page.textContent(`.dayhead[data-day="${OLD}"]`), /1 photo$/);
  const raf = makeRaf(Uint8Array.from(await drawJpeg(page)));
  await page.setInputFiles('input[type=file]', { name: 'DSCF0123.RAF', mimeType: 'application/octet-stream', buffer: Buffer.from(raf) });
  // The embedded preview is on the shelf before the upload is through.
  await page.waitForSelector('.arrival img[src^="blob:"]', { timeout: 3000 });
  await shot(page, 'importing');
  await until(() => state.registered.length === 1 && state.previews.size === 1, { message: 'registered with its preview' });
  const r = state.registered[0];
  assert.deepEqual({ drive_id: r.drive_id, format: r.format, camera: r.camera, film: r.film, taken_at: r.taken_at, bytes: r.bytes, w: r.width },
    { drive_id: 'drive-file-1', format: 'raf', camera: 'FUJIFILM X-E5', film: 'Classic Chrome', taken_at: Date.UTC(2026, 9, 30, 17, 0, 5), bytes: raf.length, w: 640 });
  assert.match(r.sha256, /^[0-9a-f]{64}$/);
  // Its info (info.js): what the fixture's EXIF and maker note hold, the allowlist's keys only.
  assert.deepEqual(r.info, { film_mode: 0x600, saturation: 0, width: 640, height: 427 });
  assert.ok(state.drive.dropped && state.drive.puts >= 3, 'a dropped chunk asked how far it got and went on');
  const prev = [...state.previews.values()][0];
  assert.ok(prev[0] === 0xff && prev[1] === 0xd8 && prev.length <= 400 * 1024, 'a JPEG preview of at most 400 KB');
  await page.waitForSelector('.dayhead[data-day="2026-10-30"]');
  const days = await page.$$eval('.dayhead', (hs) => hs.map((h) => h.dataset.day));
  assert.deepEqual(days, ['2026-10-30', OLD], 'newest day first');
  await shot(page, 'shelf');
  // The full-bleed view: the preview, the day, the camera and its film simulation.
  await page.click('.day .tile');
  await page.waitForSelector('.view img.full[src^="blob:"]');
  assert.match(await page.textContent('.info'), /FUJIFILM X-E5 · Classic Chrome/);
  // A hold opens the sheet; four stars.
  const box = await page.locator('img.full').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForSelector('.psheet');
  await page.mouse.up();
  await shot(page, 'sheet');
  await page.click('.star[aria-label="4 stars"]');
  await until(() => state.patches.some((p) => p.rating === 4));
  await page.waitForSelector('.mark:text("★★★★")');
  await shot(page, 'view');
  // Delete, to Recently deleted, and back.
  await page.click('.vmore');
  await page.click('.psheet .danger');
  await page.click('.csheet .btn.danger');
  await page.waitForSelector('.shelf .dayhead');
  await until(async () => !(await page.$('.dayhead[data-day="2026-10-30"]')));
  await page.click('text=Recently deleted');
  await page.waitForSelector('.grow');
  await page.click('.grow .btn');
  await until(() => !state.photos.some((p) => p.deleted_at));
  await until(() => {
    const types = new Set(state.senses.map((e) => e.type));
    return ['photo.import', 'photo.rate', 'photo.delete'].every((t) => types.has(t));
  }, { timeout: 20_000, message: 'the senses went' });
  const imp = state.senses.find((e) => e.type === 'photo.import');
  assert.deepEqual([imp.ref, imp.data], [`photo:${state.registered.length && state.photos.at(-1).id}`, { format: 'raf', source: 'phone' }]);
  assert.ok(!JSON.stringify(state.senses).includes('DSCF'), 'no file name travels');
  // Offline: the shelf and the view from this phone.
  await page.goto(`${base}/photos/`);
  await page.waitForSelector('.dayhead[data-day="2026-10-30"]');
  state.down = true;
  await page.reload();
  await page.waitForSelector('.dayhead[data-day="2026-10-30"]');
  assert.match(await page.textContent('.line'), /Offline/);
  await page.click('.dayhead[data-day="2026-10-30"] ~ .tiles .tile');
  await page.waitForSelector('.view img.full[src^="blob:"]');
  state.down = false;
  assert.deepEqual(errors, []);
  await context.close();
});

test('on a Galaxy A35-sized phone (360×780 at 3×) the shelf fits, with 44 px targets', opts, async () => {
  const { page, context, errors } = await open('/photos/', { viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, isMobile: true });
  await page.waitForSelector('.dayhead');
  const fit = await page.evaluate(() => [document.querySelector('.shelf').scrollWidth, document.querySelector('.shelf').clientWidth]);
  assert.ok(fit[0] <= fit[1], 'no sideways scroll');
  const small = await page.$$eval('.add, .dayhead, .tile, .back', (els) => els.filter((e) => e.getBoundingClientRect().height < 44 && !e.classList.contains('tile')).length);
  assert.equal(small, 0);
  await shot(page, 'a35');
  assert.deepEqual(errors, []);
  await context.close();
});

test('Settings › Photos: Drive by its folder, Disconnect, Connect to Google’s consent; recent originals not yet', opts, async () => {
  const { page, context, errors } = await open('/settings/photos/');
  await page.waitForSelector('.sphotos .btn');
  assert.match(await page.textContent('.sphotos'), /Connected as owner@example\.test\. Originals go to “Thunderhead Photos”/);
  await page.waitForSelector('button[data-v="recent"][disabled]');
  await shot(page, 'settings');
  await page.click('.sphotos .btn');
  await page.click('.csheet .btn.danger');
  await page.waitForSelector('.sphotos .btn:text("Connect Google Drive")');
  let consent = null;
  await context.route('https://accounts.google.com/**', (route) => { consent = route.request().url(); return route.fulfill({ status: 200, contentType: 'text/html', body: '<p>consent</p>' }); });
  await page.click('.sphotos .btn');
  await until(() => consent !== null);
  assert.match(consent, /scope=drive\.file/);
  assert.deepEqual(errors, []);
  await context.close();
});

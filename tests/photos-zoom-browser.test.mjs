// The editor's zoom in Chromium (PHOTOS.md, the editor): a two-second pinch at 390×844 on the CC0 X-E5
// sample's working copy (tests/photos-engine.test.mjs downloads it; the synthetic JPEG otherwise), with
// the page's own requestAnimationFrame timestamps read for long frames; the point between the fingers
// stays under them; the detail on screen is never dropped mid-gesture and no tile is asked for until the
// fingers stop; a pan flung past the edge comes back inside; a double tap animates back to fit.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { timing, until } from './fixtures/waits.mjs';

const live = Boolean(process.env.SITE_URL);
const TOKEN = `th1_${'P'.repeat(43)}abcdef`;
const ID = '0192aaaa-bbbb-7ccc-8ddd-eeeeffff0001';
const SHOTS = process.env.TH_SHOTS;
const RAF = join(tmpdir(), 'th-photos-engine-sample', 'xe5-8509.raf');
const state = { jpeg: Buffer.alloc(0), raf: existsSync(RAF) ? readFileSync(RAF) : null };
const photo = () => ({ id: ID, drive_id: 'drive-file-9', ...(state.raf ? { name: 'DSCF0001.RAF', format: 'raf', bytes: state.raf.length, width: 7728, height: 5152 } : { name: 'IMG_0001.JPG', format: 'jpeg', bytes: state.jpeg.length, width: 3000, height: 2000 }), sha256: 'c'.repeat(64), camera: 'Example Camera', film: null, taken_at: Date.UTC(2026, 9, 3, 9), day: '2026-10-03', rating: 0, flag: null, preview: true, edited: false, deleted_at: null, created_at: 1 });
let site, mock, browser, base;

before(async () => {
  if (live) return;
  mock = createServer(async (req, res) => {
    const cors = { 'Access-Control-Allow-Origin': req.headers.origin ?? '', 'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, TH-Client', Vary: 'Origin' };
    if (req.method === 'OPTIONS') return res.writeHead(204, cors).end();
    for await (const _ of req);
    const json = (status, value) => res.writeHead(status, { ...cors, 'Content-Type': 'application/json' }).end(JSON.stringify(value));
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return json(401, { error: { code: 'unauthorized', message: 'x', request_id: '' } });
    const path = new URL(req.url, 'http://x').pathname;
    if (path.startsWith('/v1/senses/batches/')) return json(200, { accepted: 0, rejected: [] });
    if (path === '/v1/photos/upload-token') return json(200, { access_token: 'fake-drive-token', expires_at: Date.now() + 3e6, folder_id: 'folder-1' });
    if (path === '/v1/settings') return json(200, { 'owner.tz': 'UTC', min_client: 0 });
    if (path === `/v1/photos/${ID}/preview`) return json(404, { error: { code: 'not_found', message: 'x', request_id: '' } });
    if (path === `/v1/photos/${ID}`) return json(200, { photo: photo(), recipe: { Sharpness: 40 } });
    json(404, { error: { code: 'not_found', message: 'x', request_id: '' } });
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  site = await serve(0, { api: `http://127.0.0.1:${mock.address().port}` });
  base = `http://127.0.0.1:${site.address().port}`;
  browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--disable-features=WebGPU'] });
  const page = await browser.newPage();
  state.jpeg = Buffer.from(await page.evaluate(async () => {
    const c = new OffscreenCanvas(3000, 2000), g = c.getContext('2d');
    for (let y = 0; y < 2000; y += 50) for (let x = 0; x < 3000; x += 50) { g.fillStyle = `hsl(${(x / 3000) * 360} 60% ${30 + ((x + y) / 50) % 2 * 30}%)`; g.fillRect(x, y, 50, 50); }
    return [...new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 })).arrayBuffer())];
  }));
  await page.close();
});
after(async () => { await browser?.close(); site?.close(); mock?.close(); });

async function open() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await context.route('https://www.googleapis.com/drive/v3/files/**', (route) => route.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Content-Length', 'Content-Type': 'application/octet-stream' }, body: state.raf ?? state.jpeg }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/no-such-page`);
  await page.evaluate((token) => new Promise((resolve) => {
    const req = indexedDB.open('th-auth', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => { const tx = req.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put({ session_id: 's1', token, signed_in_at: Date.now(), username: 'example-owner' }, 'session'); tx.oncomplete = () => { req.result.close(); resolve(); }; };
  }), TOKEN);
  await page.goto(`${base}/photos/?edit=${ID}`, { waitUntil: 'load' });
  await until(() => page.evaluate(() => document.querySelector('.editor')?.dataset.frame === 'original'), { timeout: 150_000, message: 'the original never drew' });
  return { page, errors, cdp: await context.newCDPSession(page), stage: await page.locator('.estage').boundingBox() };
}
const ds = (page) => page.evaluate(() => Object.fromEntries(Object.entries(document.querySelector('.editor').dataset).map(([k, v]) => [k, v !== '' && Number.isFinite(Number(v)) ? Number(v) : v])));
const view = (page) => page.evaluate(() => document.querySelector('.editor').view());
/** Starts the page's frame log: every requestAnimationFrame timestamp, with the detail, the motion and the view then. */
const record = (page) => page.evaluate(() => {
  const log = { t: [], moving: [], cu: [], detail: new Set() }, ed = document.querySelector('.editor');
  /** @type {any} */ (window).frameLog = log;
  const loop = (t) => { log.t.push(t); log.moving.push(ed.dataset.moving === 'true'); log.cu.push(ed.view().cu); log.detail.add(ed.dataset.detail ?? 'none'); if (/** @type {any} */ (window).frameLog === log) requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
});
/** The log: gaps between frames, and the worst gap while the photo was gliding or animating. */
const stop = (page) => page.evaluate(() => {
  const log = /** @type {any} */ (window).frameLog;
  /** @type {any} */ (window).frameLog = null;
  const gaps = log.t.slice(1).map((t, i) => t - log.t[i]), moving = gaps.filter((_, i) => log.moving[i] && log.moving[i + 1]);
  return { gaps, frames: log.t.length, detail: [...log.detail], moving, worstMoving: Math.max(0, ...moving), minCu: Math.min(...log.cu) };
});
/** Touch points along `path(f)` (f from 0 to 1) for `ms` of wall time, one move per round trip. */
async function gesture(cdp, ms, path, last = async () => {}) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: path(0) });
  const t0 = Date.now();
  for (let f = 0; f < 1; f = Math.min(1, (Date.now() - t0) / ms)) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: path(f) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: path(1) });
  await last();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
const idle = (page) => until(async () => (await ds(page)).idle === 'true', { timeout: 60_000, message: 'the editor never came to rest' });
const shot = async (page, name) => { if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: `${SHOTS}/photos-zoom-${name}.png` }); } };

test('a two-second pinch holds the frame budget, stays under the fingers and keeps the detail on screen', { skip: live && 'local only (mocked API)', timeout: 240_000 }, async () => {
  const { page, errors, cdp, stage } = await open();
  const cx = stage.x + stage.width / 2, cy = stage.y + stage.height / 2;
  // Zoom in once and let the detail arrive, so the pinch starts with a tile on screen.
  await gesture(cdp, 400, (f) => [{ x: cx - 40 - 60 * f, y: cy, id: 1 }, { x: cx + 40 + 60 * f, y: cy, id: 2 }]);
  await until(async () => ['tile', 'working'].includes((await ds(page)).detail), { timeout: 60_000, message: 'no detail after the first pinch' });
  await idle(page);
  const { tiles: tiles0, frames: frames0, pauses: pauses0 = 0 } = await ds(page);
  const z0 = (await view(page)).z;
  // The pinch: the fingers spread and travel 60 px together; the photo point between them must follow.
  const m0 = [cx - 30, cy + 20], m1 = [cx + 30, cy - 40];
  const anchor = await page.evaluate(([x, y]) => document.querySelector('.editor').uvAt(x, y), m0);
  await record(page);
  let log, after, z1, drift;
  await gesture(cdp, 2000, (f) => {
    const mx = m0[0] + (m1[0] - m0[0]) * f, my = m0[1] + (m1[1] - m0[1]) * f, d = 60 + 60 * Math.sin(f * Math.PI * 0.75);
    return [{ x: mx - d, y: my, id: 1 }, { x: mx + d, y: my, id: 2 }];
  }, async () => { log = await stop(page); after = await ds(page); z1 = (await view(page)).z; drift = await page.evaluate(([x, y]) => document.querySelector('.editor').uvAt(x, y), m1); });
  const worst = Math.max(...log.gaps), long = log.gaps.filter((g) => g > 32).length;
  console.log(`# pinch (${state.raf ? 'X-E5 working copy' : 'synthetic JPEG'}): ${log.frames} frames in 2 s, worst ${worst.toFixed(1)} ms, ${long} over 32 ms, ${after.frames - frames0} redraws, ${after.tiles - tiles0} detail requests and ${(after.pauses ?? 0) - pauses0} pauses during it, detail seen: ${log.detail.join(', ')}; zoom ${z0.toFixed(2)} → ${z1.toFixed(2)}`);
  timing(long === 0, `${long} frames over 32 ms during the pinch (worst ${worst.toFixed(1)} ms)`);
  assert.ok(log.frames > 60, `only ${log.frames} frames in two seconds`);
  assert.ok(!log.detail.includes('none'), `the detail was dropped mid-gesture: ${log.detail}`);
  // A detail is asked for only when the fingers stop for 120 ms (a loaded machine can stall that long) or lift.
  assert.ok(after.tiles - tiles0 <= (after.pauses ?? 0) - pauses0, `${after.tiles - tiles0} details asked for while the fingers moved, ${(after.pauses ?? 0) - pauses0} pauses`);
  assert.ok(z1 > z0 * 1.4, `the pinch zoomed in: ${z0} → ${z1}`);
  for (const i of [0, 1]) assert.ok(Math.abs(drift[i] - anchor[i]) < 0.01, `the point between the fingers drifted: ${anchor} → ${drift}`);
  await idle(page);
  const rested = await ds(page);
  assert.ok(rested.tiles > after.tiles || after.pauses > pauses0, 'no detail was asked for once the fingers lifted');
  await shot(page, 'pinched');
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('a pan flung past the edge springs back inside; a double tap animates back to fit', { skip: live && 'local only (mocked API)', timeout: 240_000 }, async () => {
  const { page, errors, cdp, stage } = await open();
  const cx = stage.x + stage.width / 2, cy = stage.y + stage.height / 2;
  await gesture(cdp, 300, (f) => [{ x: cx - 30 - 90 * f, y: cy, id: 1 }, { x: cx + 30 + 90 * f, y: cy, id: 2 }]);
  await idle(page);
  // A fast drag to the right: momentum carries it on, the edge holds it back, it rests inside.
  await record(page);
  let moving;
  await gesture(cdp, 150, (f) => [{ x: cx - 100 + 400 * f, y: cy, id: 3 }], async () => { moving = await page.evaluate(() => ({ canvas: document.querySelector('.ecanvas').style.transform, back: !document.querySelector('.eback').hidden })); });
  assert.ok(moving.canvas && moving.back, `mid-drag the frame moves by a transform over the backdrop: ${JSON.stringify(moving)}`);
  await until(async () => (await page.evaluate(() => document.querySelector('.editor').dataset.moving)) !== 'true', { message: 'the fling never came to rest' });
  const fling = await stop(page);
  const v = await view(page), inside = await page.evaluate(() => document.querySelector('.editor').inside());
  const lo = (await page.evaluate(() => innerWidth)) / 2 / (await page.locator('.estage').boundingBox()).width / v.z;
  console.log(`# fling: ${fling.moving.length} frames gliding, worst ${fling.worstMoving.toFixed(1)} ms; past the edge to u ${fling.minCu.toFixed(3)}, rests at ${v.cu.toFixed(3)} (edge ${lo.toFixed(3)})`);
  timing(fling.worstMoving <= 32, `a glide frame took ${fling.worstMoving.toFixed(1)} ms`);
  assert.ok(fling.moving.length > 5, 'the fling did not glide');
  assert.ok(inside, `the view rests outside the photo: ${JSON.stringify(v)}`);
  assert.ok(fling.minCu < v.cu - 0.01, `the edge did not give: ${fling.minCu} against ${v.cu}`);
  // Double tap: animated, about 200 ms, to fit.
  await idle(page);
  await record(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy, id: 4 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy, id: 5 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await until(async () => (await view(page)).z === 1 && (await ds(page)).moving !== 'true', { message: 'the double tap never reached fit' });
  const tap = await stop(page);
  console.log(`# double tap to fit: ${tap.moving.length} frames animating, worst ${tap.worstMoving.toFixed(1)} ms`);
  timing(tap.worstMoving <= 32, `a double-tap frame took ${tap.worstMoving.toFixed(1)} ms`);
  assert.ok(tap.moving.length >= 6, `the double tap jumped instead of animating (${tap.moving.length} frames)`);
  await shot(page, 'fit');
  assert.deepEqual(errors, []);
  await page.context().close();
});

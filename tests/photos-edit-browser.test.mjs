// The Photos editor in Chromium (PHOTOS.md, the editor), against a mock API and a fake Google Drive:
// a synthetic JPEG (drawn in the page, never a photograph) opened from the shelf shows its preview,
// then its original from Drive through the GPU pipeline; three sliders move it; a hold shows it as
// shot; two fingers show the histogram; the recipe is saved (debounced) and found again after a
// reload; the panels at 390×844 and on a Galaxy A35-sized phone (360×780 at 3×); and a WebGL2-only
// run (WebGPU off by flag) draws the same within a tolerance. Screens go to TH_SHOTS when it is set.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { until } from './fixtures/waits.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (mocked API)' };
const TOKEN = `th1_${'P'.repeat(43)}abcdef`;
const ID = '0192aaaa-bbbb-7ccc-8ddd-eeeeffff0001';
const SHOTS = process.env.TH_SHOTS;
const state = { recipe: {}, puts: [], senses: [], jpeg: Buffer.alloc(0), preview: Buffer.alloc(0), raf: null };
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

async function open(b, path, device = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 }) {
  const context = await b.newContext({ ...device, hasTouch: true });
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
const shot = async (page, name) => { if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: `${SHOTS}/photos-edit-${name}.png` }); } };
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

test('open from the shelf, move three sliders, hold for as shot, two fingers for the histogram, the recipe kept', opts, async () => {
  const { page, errors } = await open(browser, '/photos/');
  await page.locator('.tile').first().click();
  await page.locator('.vedit').click();
  await ready(page);
  const gpu = await page.evaluate(() => document.querySelector('.editor').dataset.gpu);
  console.log(`# editor drew with ${gpu}`);
  const asShot = await probe(page);
  await drag(page, 'Exposure2012', 60);
  await page.locator('.echip[data-tool="Contrast2012"]').click();
  await drag(page, 'Contrast2012', 50);
  await page.locator('.epanel[data-id="color"]').click();
  await page.locator('.echip[data-tool="Saturation"]').click();
  await drag(page, 'Saturation', -80);
  await until(() => state.puts.length > 0 && state.recipe.Saturation < 0, { message: 'the recipe was never saved' });
  assert.ok(state.recipe.Exposure2012 > 0 && state.recipe.Contrast2012 > 0, JSON.stringify(state.recipe));
  const edited = await probe(page);
  assert.ok(mean(edited, asShot) > 2, 'the sliders changed the render');
  // Hold: the as-shot recipe while the finger stays.
  const s = await page.locator('.estage').boundingBox();
  await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2);
  await page.mouse.down();
  await until(() => page.evaluate(() => document.querySelector('.editor').dataset.before === 'true'), { message: 'no before on hold' });
  await shot(page, 'before');
  await page.mouse.up();
  await until(() => page.evaluate(() => document.querySelector('.editor').dataset.before === 'false'));
  // Two fingers: the histogram.
  const cdp = await page.context().newCDPSession(page);
  const pts = [{ x: s.x + 120, y: s.y + 200, id: 1 }, { x: s.x + 260, y: s.y + 200, id: 2 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts });
  await until(() => page.evaluate(() => document.querySelector('.editor').dataset.histogram === 'true'), { message: 'no histogram on two fingers' });
  await shot(page, 'histogram');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await until(() => state.senses.some((e) => e.type === 'photo.edit' && e.data.panel === 'light' && Object.keys(e.data).length === 1), { message: `no photo.edit sense: ${JSON.stringify(state.senses.map((e) => e.type))}` });
  // Reload: the recipe comes back.
  const kept = { ...state.recipe };
  await page.reload();
  await ready(page);
  assert.deepEqual(await page.evaluate(() => document.querySelector('.editor').recipe()), kept);
  assert.ok(mean(await probe(page), edited) < 1.5, 'the reloaded render matches');
  for (const id of ['light', 'color', 'effects', 'detail']) { await page.locator(`.epanel[data-id="${id}"]`).click(); await shot(page, id); }
  for (const t of ['curve', 'mix', 'grading']) {
    await page.locator(`.epanel[data-id="${t === 'curve' ? 'light' : 'color'}"]`).click();
    await page.locator(`.echip[data-tool="${t}"]`).click();
    await shot(page, t);
  }
  assert.deepEqual(errors.filter((e) => !/cannot present/.test(e)), []);
  await page.context().close();
});

test('WebGL2 only (WebGPU off by flag) draws the same within a tolerance; the A35 profile fits', opts, async () => {
  const a = await open(browser, `/photos/?edit=${ID}`);
  const b = await open(flat, `/photos/?edit=${ID}`, { viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, isMobile: true });
  await ready(a.page); await ready(b.page);
  const [ga, gb] = await Promise.all([a.page, b.page].map((p) => p.evaluate(() => document.querySelector('.editor').dataset.gpu)));
  assert.equal(gb, 'webgl2');
  const d = mean(await probe(a.page), await probe(b.page));
  console.log(`# ${ga} against WebGL2 only: mean difference ${d.toFixed(2)} of 255`);
  assert.ok(d < 2, `mean difference ${d.toFixed(2)} of 255`);
  await shot(b.page, 'a35');
  for (const sel of ['.epanel', '.echip', '.vback']) {
    const boxes = await b.page.locator(sel).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    for (const h of boxes) assert.ok(h >= 36, `${sel} is ${h} px tall`);
  }
  assert.equal(await b.page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  // WGSL against GLSL on the same pixels and recipe (offscreen: headless Chromium's software WebGPU
  // renders and reads back but cannot present to a canvas).
  const same = await a.page.evaluate(async () => {
    if (!(await navigator.gpu?.requestAdapter())) return null;
    const [{ webgpu }, { webgl2 }, { pack, toneLut }] = await Promise.all(['webgpu', 'gl', 'uniforms'].map((m) => import(`/apps/photos/edit/${m}.js`)));
    const w = 96, h = 64, data = new Uint16Array(w * h * 3);
    const f16 = (v) => { const b = new DataView(new ArrayBuffer(4)); b.setFloat32(0, v); const i = b.getUint32(0); return ((i >>> 16) & 0x8000) | ((((i >>> 23) & 0xff) - 112) << 10) | ((i & 0x7fffff) >>> 13); };
    for (let c = 0; c < 3; c++) for (let i = 0; i < w * h; i++) data[c * w * h + i] = f16(0.02 + 0.9 * (((i % w) / w) * (c === 1 ? 0.7 : 1)) * ((Math.floor(i / w) / h) * 0.5 + 0.5));
    const recipe = { Exposure2012: 0.4, Contrast2012: 20, Shadows2012: 30, Saturation: 15, HueAdjustmentRed: 20, Clarity2012: 25, PostCropVignetteAmount: -30, Sharpness: 60 };
    const img = { raw: true, asShot: [0.3127, 0.329], shot: { temperature: 6500, tint: 0 }, width: w, height: h };
    const u = pack(recipe, img, { scale: [1 / w, 1 / h], offset: [0, 0], size: [w, h], flip: 0, p0: [1 / w, 1 / h], tile: null }), lut = toneLut(recipe, true);
    const out = [];
    for (const make of [webgpu, webgl2]) {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      let r;
      r = await make(c, { offscreen: true }).catch(() => null);
      if (!r) return null;
      r.source({ kind: 'planar', width: w, height: h, data }, w, h);
      out.push([...(await r.read(u, lut, w, h))]);
    }
    return out[0].reduce((n, v, i) => n + Math.abs(v - out[1][i]), 0) / out[0].length;
  });
  if (same === null) console.log('# no WebGPU adapter here: WGSL against GLSL not compared');
  else { console.log(`# WGSL against GLSL: mean difference ${same.toFixed(2)} of 255`); assert.ok(same < 2); }
  assert.deepEqual([...a.errors, ...b.errors].filter((e) => !/cannot present/.test(e)), []);
  await a.context.close(); await b.context.close();
});

test('the X-E5 sample through the engine in a worker: the embedded preview first, then the working copy', { skip: (live && 'local only') || (!existsSync(RAF) && 'the CC0 sample is not downloaded (tests/photos-engine.test.mjs fetches it)'), timeout: 180_000 }, async () => {
  state.raf = readFileSync(RAF);
  state.recipe = {};
  try {
    const { page, errors } = await open(flat, `/photos/?edit=${ID}`, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true });
    await until(() => page.evaluate(() => document.querySelector('.editor')?.dataset.frame === 'original'), { timeout: 150_000, message: 'the RAF never drew' });
    const d = await page.evaluate(() => ({ ...document.querySelector('.editor').dataset }));
    console.log(`# X-E5 in headless Chromium: preview drawn at ${d.previewMs} ms, first real frame at ${d.firstMs} ms, wasm ${d.wasmMib} MiB (${d.gpu})`);
    assert.ok(Number(d.wasmMib) < 150);
    await drag(page, 'Exposure2012', 40);
    await page.locator('.estage').dblclick();
    await until(() => page.evaluate(() => document.querySelector('.editor').dataset.detail === 'tile'), { timeout: 60_000, message: 'no 1:1 tile' });
    await shot(page, 'raf-1to1');
    assert.deepEqual(errors, []);
    await page.context().close();
  } finally {
    state.raf = null;
  }
});

// Photos' first real frame (PHOTOS.md, the two-stage decode), on the CC0 X-E5 RAF in Chromium: the preview on
// screen under 0.5 s, the binned half-size frame the editor works on under 3 s × CI_FACTOR, the demosaiced copy
// later; once cross-origin isolated through the service worker (threads) and once with it blocked (one thread).
// The numbers are printed; budgets are enforced with TH_STRICT_TIMING=1 (fixtures/waits.mjs). The sample is the
// one tests/photos-engine.test.mjs downloads (never committed); without it this test skips.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { timing, until } from './fixtures/waits.mjs';

const RAF = join(tmpdir(), 'th-photos-engine-sample', 'xe5-8509.raf');
const skip = (process.env.SITE_URL && 'local only (mocked API)') || (!existsSync(RAF) && 'no CC0 sample (run tests/photos-engine.test.mjs first)');
// The runner against the phone's 3 s: measured 2026-11-05 on a shared 4-core x86 VM (load 5-9 from other jobs,
// software GL, the RAF served by Playwright in about 1.3 s), the threaded half-size frame took 6.6-8.8 s and one
// thread 5.9-7.9 s; CI_FACTOR 3 holds that runner to 9 s. The phone's own number is the editor's "Decoded in".
const CI_FACTOR = 3;
const TOKEN = `th1_${'P'.repeat(43)}abcdef`;
const ID = '0192aaaa-bbbb-7ccc-8ddd-eeeeffff0002';
let raf, preview, mock, site, browser, base;
const photo = () => ({ id: ID, drive_id: 'drive-file-7', name: 'DSCF0002.RAF', format: 'raf', bytes: raf.length, width: 7728, height: 5152, sha256: 'd'.repeat(64), camera: 'Example Camera', film: null, taken_at: Date.UTC(2026, 9, 4, 9), day: '2026-10-04', rating: 0, flag: null, preview: true, edited: false, deleted_at: null, created_at: 1 });

before(async () => {
  if (skip) return;
  raf = readFileSync(RAF);
  const { initSync, Engine } = await import(new URL('../frontend/photos/engine/photos_engine.js', import.meta.url).href);
  const wasm = initSync({ module: readFileSync(new URL('../frontend/photos/engine/photos_engine_bg.wasm', import.meta.url)) });
  const e = new Engine();
  const ptr = e.inputPtr(raf.length, 0);
  new Uint8Array(wasm.memory.buffer, ptr, raf.length).set(raf);
  const embedded = Buffer.from(e.decodeInput(true).previewJpeg);
  e.free();
  mock = createServer(async (req, res) => {
    const cors = { 'Access-Control-Allow-Origin': req.headers.origin ?? '', 'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, TH-Client', Vary: 'Origin' };
    if (req.method === 'OPTIONS') return res.writeHead(204, cors).end();
    for await (const _ of req);
    const json = (status, value) => res.writeHead(status, { ...cors, 'Content-Type': 'application/json' }).end(JSON.stringify(value));
    const path = new URL(req.url, 'http://x').pathname;
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return json(401, { error: { code: 'unauthorized', message: 'x', request_id: '' } });
    if (path.startsWith('/v1/senses/batches/')) return json(200, { accepted: 0, rejected: [] });
    if (path === '/v1/photos/upload-token') return json(200, { access_token: 'fake-drive-token', expires_at: Date.now() + 3e6, folder_id: 'folder-1' });
    if (path === '/v1/settings') return json(200, { 'owner.tz': 'UTC', min_client: 0 });
    if (path === `/v1/photos/${ID}/preview`) return res.writeHead(200, { ...cors, 'Content-Type': 'image/jpeg' }).end(preview);
    if (path === `/v1/photos/${ID}/recipe`) return json(200, { photo: photo(), recipe: {}, changed: false });
    if (path === `/v1/photos/${ID}`) return json(200, { photo: photo(), recipe: {} });
    if (path === '/v1/photos') return json(200, { days: [{ day: '2026-10-04', count: 1, photos: [photo()] }], next: null });
    json(404, { error: { code: 'not_found', message: 'x', request_id: '' } });
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  site = await serve(0, { api: `http://127.0.0.1:${mock.address().port}` });
  base = `http://127.0.0.1:${site.address().port}`;
  const exe = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
  browser = await chromium.launch({ ...exe, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader'] });
  // the import-time preview: the camera's embedded JPEG made 1024 px wide, as import.js does
  const page = await browser.newPage();
  preview = Buffer.from(await page.evaluate(async (bytes) => {
    const b = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }), { resizeWidth: 1024, resizeQuality: 'high' });
    const c = new OffscreenCanvas(b.width, b.height);
    c.getContext('2d').drawImage(b, 0, 0);
    return [...new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality: 0.85 })).arrayBuffer())];
  }, [...embedded]));
  await page.close();
});
after(async () => { await browser?.close(); site?.close(); mock?.close(); });

/** Opens the editor on the RAF and reads its timings. @param {boolean} worker the service worker (isolation) or none */
async function run(worker) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, serviceWorkers: worker ? 'allow' : 'block' });
  await context.route('https://www.googleapis.com/drive/v3/files/**', (r) => r.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Content-Length', 'Content-Type': 'application/octet-stream' }, body: raf }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
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
  if (worker) {
    await page.goto(`${base}/`, { waitUntil: 'load' });
    await until(() => page.evaluate(() => navigator.serviceWorker.controller !== null), { timeout: 60_000, message: 'the service worker never took control' });
  }
  await page.goto(`${base}/photos/?edit=${ID}`, { waitUntil: 'load' });
  const ed = () => page.evaluate(() => ({ ...document.querySelector('.editor')?.dataset, isolated: crossOriginIsolated, status: document.querySelector('.etitle')?.textContent }));
  const look = async () => { const px = await page.evaluate(async () => [...(await document.querySelector('.editor').probe(false)).px]); return px.reduce((a, v, i) => (i % 4 === 3 ? a : a + v), 0) / (px.length * 0.75); };
  const half = await until(async () => { const d = await ed(); return d.frame === 'original' && d; }, { timeout: 120_000, message: 'the first frame never drew' });
  half.mean = await look();
  const full = await until(async () => { const d = await ed(); return (d.fullMs || !('threads' in d)) && d; }, { timeout: 180_000, message: 'the demosaiced copy never came' });
  // the fit made on the binned frame (source.js keeps it per model): its held-out chromaticity error
  full.fit = await page.evaluate(() => JSON.parse(localStorage.getItem('th.photos.matrix.FUJIFILM X-E5') ?? 'null'));
  full.mean = await look();
  if (process.env.TH_SHOTS) await page.screenshot({ path: join(process.env.TH_SHOTS, `photos-speed-${worker ? 'threads' : 'one'}.png`) });
  await context.close();
  assert.deepEqual(errors, []);
  return { half, full };
}

for (const worker of [true, false]) {
  test(`the CC0 RAF: preview, binned frame and demosaiced copy (${worker ? 'isolated, threads' : 'no service worker, one thread'})`, { skip, timeout: 400_000 }, async () => {
    const { half, full } = await run(worker);
    assert.equal(half.isolated, worker);
    assert.equal(Number(half.threads) > 1, worker, `threads ${half.threads}`);
    console.log(`# ${worker ? 'threads' : 'one thread'} (${half.threads}): preview ${half.previewMs} ms, half-size frame ${half.firstMs} ms (wasm ${half.wasmMib} MiB), full ${full.fullMs} ms (wasm ${full.wasmMib} MiB); worker ms: ${half.stages}; render mean ${half.mean.toFixed(1)} then ${full.mean.toFixed(1)}; fit held-out ${full.fit?.after?.toFixed(4)} (fallback ${full.fit?.before?.toFixed(4)}); status "${full.status}"`);
    assert.match(full.status ?? '', /Decoded in \d+\.\d s/);
    timing(Number(half.previewMs) < 500, `preview ${half.previewMs} ms`);
    if (worker) timing(Number(half.firstMs) < 3000 * CI_FACTOR, `half-size frame ${half.firstMs} ms against ${3000 * CI_FACTOR}`);
    assert.ok(Number(half.wasmMib) < 60, `half-size path ${half.wasmMib} MiB of wasm`);
    assert.ok(Number(full.fullMs) > Number(half.firstMs));
    // the binned frame is a picture; later reads are only printed: headless software GL loses the editor's WebGL
    // context a few seconds after a RAF's first frame (on main too, 2026-11-05), so they read black here
    assert.ok(half.mean > 20 && half.mean < 235, `the binned frame's mean ${half.mean} of 255`);
  });
}

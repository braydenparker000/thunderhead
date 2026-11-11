// The new editor with no signal (frontend/sw.js `keepEditor`, frontend/lab/editor/boot.js; engine/raw/ROADMAP.md stage
// 5). Its files are not precached. Opened once with a signal, the service worker keeps what /lab/offline.json
// lists (/lab/editor/ and the engine at /lab/engine/); with no signal the editor then opens, its engine's worker and
// decoder too. A later release fetches only the files that changed, and with no signal an older release's editor
// still opens. The owner's switch (photos.offline) turns the keeping off.
// "No signal" is the test server dropping every connection (scripts/serve.mjs `signal`), not the browser's offline
// switch: on CI that switch did not reach the service worker, which then fetched what the test said it could not.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

const opts = { skip: Boolean(process.env.SITE_URL) && 'local only (its own releases)', timeout: 180_000 };
let server, browser, base;
before(async () => {
  server = await serve(0, { build: 1 });
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => { await browser?.close(); server?.close(); });

/** A context whose home page is under the service worker; `prefs` are the owner's settings on this phone. */
async function controlled(prefs = {}) {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 } });
  await context.addInitScript((p) => { for (const [k, v] of Object.entries(p)) localStorage.setItem(`th.s.${k}`, v); }, prefs);
  const page = await context.newPage();
  await page.goto(`${base}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 20000 });
  return { context, page };
}
/** Opens the editor and waits for the worker's word on keeping it. */
async function openEditor(page) {
  await page.addInitScript(() => { navigator.serviceWorker?.addEventListener('message', (e) => { if (e.data?.type === 'editorKept') window.__kept = e.data; }); });
  await page.goto(`${base}/lab/editor/`, { waitUntil: 'load' });
  await page.waitForSelector('#stage header');
}
const labCaches = (page) => page.evaluate(async () => (await caches.keys()).filter((n) => n.startsWith('th-lab-')).sort());

test('opened once with a signal, the editor opens with none: its page, its engine, the decoder', opts, async () => {
  server.release(1); server.signal(true);
  const { context, page } = await controlled();
  assert.deepEqual(await labCaches(page), [], 'nothing of the editor is kept before it is opened');
  await openEditor(page);
  await page.waitForFunction(() => window.__kept, null, { timeout: 60000 });
  const kept = await page.evaluate(() => window.__kept);
  assert.equal(kept.kept, true, kept.why);
  assert.ok(kept.fetched > 10_000_000, `the editor and its engine were fetched (${kept.fetched} bytes)`);
  assert.deepEqual(await labCaches(page), ['th-lab-1']);
  server.signal(false);   // no signal, for the page and the worker alike
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#stage header');
  assert.match(await page.textContent('#stage header'), /Library/);
  // The engine's worker and both decoders are there too (a RAF opens with no signal).
  const got = await page.evaluate(async () => Promise.all(['/lab/engine/decode-worker.js', '/lab/engine/pkg/th_raw_bg.wasm', '/lab/engine/pkg-threads/th_raw_bg.wasm', '/lab/engine/gpu.js', '/lab/editor/app/session.js']
    .map(async (u) => { const r = await fetch(u); return r.ok ? (await r.arrayBuffer()).byteLength > 0 : false; })));
  assert.deepEqual(got, [true, true, true, true, true]);
  assert.equal(await page.evaluate(() => crossOriginIsolated), true, 'still isolated from the kept page, so the decoder has its threads');
  assert.equal(await page.evaluate(() => fetch('/release.json').then(() => 'answered', () => 'no signal')), 'no signal', 'the server really is out of reach');
  // Opened again with a signal, nothing is fetched twice.
  server.signal(true);
  await page.evaluate(() => { window.__kept = null; });
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__kept, null, { timeout: 30000 });
  assert.deepEqual(await page.evaluate(() => ({ kept: window.__kept.kept, fetched: window.__kept.fetched })), { kept: true, fetched: 0 });
  await context.close();
});

test('a later release fetches only what changed, and with no signal the release before still opens', opts, async () => {
  server.release(1); server.signal(true);
  const { context, page } = await controlled();
  await openEditor(page);
  await page.waitForFunction(() => window.__kept?.kept, null, { timeout: 60000 });
  // Release 2: the same editor files (the test server stamps the build only into sw.js, config.js and the lists).
  server.release(2);
  await page.goto(`${base}/`, { waitUntil: 'load' });
  // The shell applies a new release at a safe moment and reloads (tests/sw-browser.test.mjs): wait that out.
  const applied = page.waitForEvent('framenavigated', { timeout: 30000 });
  await page.evaluate(async () => { (await navigator.serviceWorker.getRegistration()).update(); });
  await applied;
  await page.waitForLoadState('load');
  await page.waitForFunction(async () => { const k = await caches.keys(); return k.includes('th-2') && !k.includes('th-1'); }, null, { timeout: 30000 });
  // With no signal before the editor was opened under release 2, release 1's editor opens.
  server.signal(false);   // no signal, for the page and the worker alike
  await page.goto(`${base}/lab/editor/`, { waitUntil: 'load' });
  await page.waitForSelector('#stage header');
  assert.match(await page.textContent('#stage header'), /Library/);
  assert.deepEqual(await labCaches(page), ['th-lab-1'], "release 2's cannot be fetched, so release 1's is what opened");
  // With a signal again it is kept as release 2's: nothing changed, so nothing is fetched, and release 1's goes.
  server.signal(true);
  await openEditor(page);
  await page.waitForFunction(() => window.__kept, null, { timeout: 60000 });
  const kept = await page.evaluate(() => window.__kept);
  assert.deepEqual({ build: kept.build, kept: kept.kept, fetched: kept.fetched }, { build: 2, kept: true, fetched: 0 }, kept.why);
  assert.deepEqual(await labCaches(page), ['th-lab-2']);
  await context.close();
  server.release(1);
});

test('with "Keep the editor for offline use" off, nothing is kept', opts, async () => {
  server.release(1); server.signal(true);
  const { context, page } = await controlled({ 'photos.offline': 'false' });
  await openEditor(page);
  await page.waitForTimeout(1500);
  assert.equal(await page.evaluate(() => window.__kept ?? null), null);
  assert.deepEqual(await labCaches(page), []);
  await context.close();
});

// The service worker in Chromium against the local server (ARCHITECTURE.md §8 acceptance): it
// precaches the release, opens the shell and the sign-in pages offline, leaves the ported folders
// alone, and applies a new release only at a safe moment, then drops the old cache.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

let server, browser, base;
before(async () => {
  server = await serve(0, { build: 1 });
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => { await browser?.close(); server?.close(); });

async function controlled() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${base}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15000 });
  return { context, page, errors };
}
const cacheNames = (page) => page.evaluate(() => caches.keys());

test('installs, precaches the release and opens the shell and sign-in pages offline', async () => {
  server.release(1);
  const { context, page, errors } = await controlled();
  assert.deepEqual((await cacheNames(page)).filter((n) => n.startsWith('th-')), ['th-1']);
  const cached = await page.evaluate(async () => (await (await caches.open('th-1')).keys()).map((r) => new URL(r.url).pathname));
  for (const p of ['/index.html', '/signin/index.html', '/ui/icons.svg', '/apps/home/home.js']) assert.ok(cached.includes(p), p);
  assert.ok(!cached.some((p) => p.startsWith('/music/') || p === '/sw.js'), 'ported folders and sw.js stay out');
  await context.setOffline(true);
  // Study has its own page (P7), precached like the shell and sign-in.
  for (const [path, marker] of [['/', '#ask'], ['/study/', '#study'], ['/signin/', 'form']]) {
    await page.goto(`${base}${path}`, { waitUntil: 'load' });
    assert.ok(await page.$(marker), `${path} offline`);
  }
  // a folder the release doesn't know (an app added later) is not answered from the cache
  const music = await page.goto(`${base}/music/`).then(() => 'loaded', () => 'network');
  assert.equal(music, 'network');
  await context.setOffline(false);
  assert.deepEqual(errors.filter((e) => !/ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(e)), []);
  await context.close();
});

test('a new release waits while the ask bar holds text, then applies and drops the old cache', async () => {
  server.release(1);
  const { context, page } = await controlled();
  await page.fill('#q', 'half a thought');
  server.release(2);
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
  await page.waitForFunction(async () => Boolean((await navigator.serviceWorker.getRegistration()).waiting), null, { timeout: 15000 });
  // The shell looks every 5 s; with text in the ask bar nothing may reload.
  let reloaded = false;
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) reloaded = true; });
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(6000);
  assert.equal(reloaded, false, 'reloaded while typing');
  await page.fill('#q', '');
  await page.$eval('#q', (q) => q.blur());
  await page.waitForEvent('framenavigated', { timeout: 10000 });
  await page.waitForLoadState('load');
  await page.waitForFunction(async () => (await caches.keys()).includes('th-2'), null, { timeout: 10000 });
  await page.waitForFunction(async () => !(await caches.keys()).includes('th-1'), null, { timeout: 10000 });
  await context.close();
});

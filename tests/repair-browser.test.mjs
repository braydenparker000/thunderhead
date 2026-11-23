// Repair in Chromium at 390×844 (frontend/boot-guard.js, frontend/repair/, MENU-AND-SETTINGS.md §6.8): a phone whose
// cached release has a home script that does not parse (its copy in the service worker's cache replaced by a
// syntax error) shows nothing on the first start, the boot guard's panel on the second; Repair clears the code
// caches and the service workers, home comes up from the network signed in, a downloaded episode stays, and home says
// what was done. A healthy start slowed six times shows no panel, twice in a row. Local only; mocked API.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { timing, until } from './fixtures/waits.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (mocked API, its own releases)', timeout: 180_000 };
const OLD = 'https://jarvis-hub-api.braydenparker999.workers.dev';
const TOKEN = `th1_${'R'.repeat(43)}abcdef`;
let site, mock, browser, base;

before(async () => {
  if (live) return;
  mock = createServer((req, res) => {
    const cors = { 'Access-Control-Allow-Origin': req.headers.origin ?? '*', Vary: 'Origin' };
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...cors, 'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-None-Match, TH-Client' });
      return res.end();
    }
    const json = (body, status = 200) => { res.writeHead(status, { ...cors, 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    const answers = {
      '/v1/auth/me': { session_id: 's1', notices: [], recovery_confirmed: true },
      '/v1/threads/today': { thread: null, messages: [], seq: 1, day: new Date().toISOString().slice(0, 10) },
      '/v1/settings': { 'owner.tz': 'UTC', 'mind.status': { state: 'asleep', note: null, since: null } },
      '/v1/surfaces': { items: [], seq: 1 }, '/v1/verbs/pending': { items: [] },
      '/v1/proposals': { items: [] }, '/v1/changes': { items: [], next_after: 1, more: false },
    };
    const path = new URL(req.url, 'http://x').pathname;
    if (path in answers) return json(answers[path]);
    json({ error: { code: 'not_found', message: 'no', request_id: 't' } }, 404);
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  site = await serve(0, { api: `http://127.0.0.1:${mock.address().port}` });
  base = `http://127.0.0.1:${site.address().port}`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => { await browser?.close(); site?.close(); mock?.close(); });

/** A signed-in phone with the shell's service worker in charge of home and its release cached whole. */
async function phone() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'allow' });
  await context.route(`${OLD}/**`, (r) => r.abort());
  // When home marks itself started (boot-guard.js thStarted), recorded inside the page.
  await context.addInitScript(() => {
    let real;
    Object.defineProperty(window, 'thStarted', { configurable: true, set(f) { real = f; }, get() { return () => { window.__started = performance.now(); return real?.(); }; } });
  });
  const page = await context.newPage();
  await page.goto(`${base}/no-such-page`);
  await page.evaluate((token) => new Promise((resolve) => { const req = indexedDB.open('th-auth', 1); req.onupgradeneeded = () => req.result.createObjectStore('kv'); req.onsuccess = () => { const tx = req.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put({ session_id: 's1', token, signed_in_at: Date.now(), username: 'example-owner' }, 'session'); tx.oncomplete = () => { req.result.close(); resolve(); }; }; }), TOKEN);
  await page.goto(`${base}/`, { waitUntil: 'load' });
  await page.waitForSelector('html[data-signed-in]');
  await until(() => page.evaluate(async () => navigator.serviceWorker.controller !== null && Boolean(await caches.match('/precache.json', { cacheName: 'th-1' }))), { timeout: 60_000, message: 'the release is cached whole and its worker in charge' });
  await page.waitForFunction(() => window.__started !== undefined);
  return { context, page };
}
const panel = (page) => page.evaluate(() => document.getElementById('th-boot-guard') !== null);
const session = (page) => page.evaluate(() => new Promise((resolve) => { const req = indexedDB.open('th-auth'); req.onsuccess = () => { const g = req.result.transaction('kv').objectStore('kv').get('session'); g.onsuccess = () => { resolve(g.result?.token ?? null); req.result.close(); }; }; }));

test('a cached home that does not parse: nothing on the first start, the panel on the second; Repair brings home up from the network, signed in', opts, async () => {
  const { context, page } = await phone();
  await page.evaluate(async () => {
    await (await caches.open('th-1')).put('/apps/home/home.js', new Response('export const = ;', { headers: { 'content-type': 'text/javascript' } }));
    await (await caches.open('jarvis-podcast-audio-v1')).put('/podcasts/offline/an-episode', new Response(new Uint8Array(64)));
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => localStorage.getItem('th.boot') === '1', null, { timeout: 40_000 });
  assert.equal(await panel(page), false, 'one miss shows nothing');
  assert.equal(await page.evaluate(() => window.__started), undefined, 'the cached home really did not start');
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#th-boot-guard', { timeout: 40_000 });
  assert.equal(await page.locator('#th-boot-guard p').textContent(), 'Thunderhead didn’t start.');
  assert.equal(await page.evaluate(() => localStorage.getItem('th.boot')), '2');
  await page.locator('#th-boot-guard button', { hasText: 'Repair' }).click();
  await page.waitForURL(`${base}/`, { timeout: 30_000 });
  await page.waitForSelector('html[data-signed-in]');
  await page.waitForFunction(() => window.__started !== undefined, null, { timeout: 30_000 });
  await until(async () => (await page.textContent('#toast')).startsWith('Repaired:'), { message: 'home says what Repair did' });
  assert.match(await page.textContent('#toast'), /^Repaired: \d+ code caches? and \d+ workers? cleared\. Sign-in and your data stayed\.$/);
  assert.equal(await panel(page), false);
  assert.equal(await page.evaluate(() => localStorage.getItem('th.boot')), null);
  assert.equal(await session(page), TOKEN, 'still signed in');
  assert.ok(await page.evaluate(async () => Boolean(await caches.match('/podcasts/offline/an-episode', { cacheName: 'jarvis-podcast-audio-v1' }))), 'the downloaded episode stayed');
  const home = await page.evaluate(async () => { const r = await caches.match('/apps/home/home.js', { cacheName: 'th-1' }); return r ? r.text() : null; });
  assert.notEqual(home, 'export const = ;', 'the broken copy is gone');
  await context.close();
});

test('a healthy start slowed six times shows no panel, twice in a row', opts, async () => {
  const { context, page } = await phone();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
  for (let i = 0; i < 2; i++) {
    await page.reload({ waitUntil: 'load' });
    const at = await page.waitForFunction(() => window.__started, null, { timeout: 60_000 }).then((h) => h.jsonValue());
    timing(at < 12_000, `start ${i + 1} marked at ${Math.round(at)} ms, slowed six times`);
    assert.equal(await panel(page), false);
    assert.equal(await page.evaluate(() => localStorage.getItem('th.boot')), null);
  }
  await context.close();
});

test('Repair with no signal: About says it needs a connection and stays; /repair/ that cannot reach home clears nothing', opts, async () => {
  const { context, page } = await phone();
  const held = () => page.evaluate(async () => ({ caches: (await caches.keys()).filter((n) => /^th-\d+$/.test(n)).length, workers: (await navigator.serviceWorker.getRegistrations()).length }));
  // The worker installs (filling its cache) after the page shows: count once it is active, so a late
  // install is not mistaken for something Repair added.
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  const before = await held();
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('th:open', { detail: { name: 'about' } })));
  await page.waitForSelector('#about-repair');
  await context.setOffline(true);
  await page.locator('#about-repair').click();
  await until(() => page.evaluate(() => [...document.querySelectorAll('.line')].some((e) => e.textContent === 'Repair needs a connection. Connect, then try again.')), { message: 'About says it needs a connection' });
  assert.equal(page.url(), `${base}/`, 'stays');
  await context.setOffline(false);
  // The page loads, then home and the release file can't be reached (a weak signal): nothing is cleared.
  await context.route((url) => url.pathname === '/' || url.pathname === '/release.json', (r) => (r.request().method() === 'HEAD' ? r.abort('internetdisconnected') : r.fallback()));
  await page.goto(`${base}/repair/`);
  await page.waitForSelector('#again:not([hidden])');
  assert.equal(await page.textContent('#say'), 'Repair needs a connection, and the site can’t be reached now. Nothing was cleared.');
  assert.deepEqual(await held(), before, 'every code cache and worker stayed');
  await context.close();
});

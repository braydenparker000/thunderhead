// Apps inside the Thunderhead and the island (th/island/island.js, th/ported/frames.js; NEXT-BATCH.md
// part 3), in Chromium against a mock new Worker: Music opens as a layer inside home in a frame its
// worker trusts (a one-time token), so the framed player gets the owner's session; Back shrinks it
// into the island and a tap brings it back; the phone's commands reach the player through it. The
// same player framed by another site's page gets no session. Local only; no network.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (mocked API)', timeout: 120_000 };
const OLD = 'https://jarvis-hub-api.braydenparker999.workers.dev';
const TOKEN = `th1_${'C'.repeat(43)}abcdef`;
let site, mock, other, browser, base, api, otherBase;
/** Catalog requests the mock saw, with or without the session. */
const seen = [];

before(async () => {
  if (live) return;
  mock = createServer((req, res) => {
    const cors = { 'Access-Control-Allow-Origin': req.headers.origin ?? '*', Vary: 'Origin' };
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...cors, 'Access-Control-Allow-Methods': 'GET, POST, PUT', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-None-Match, TH-Client' });
      return res.end();
    }
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/v1/music/catalog') {
      seen.push({ auth: req.headers.authorization ?? '' });
      res.writeHead(200, { ...cors, 'Content-Type': 'application/json', ETag: '"m1-island"', 'Access-Control-Expose-Headers': 'ETag' });
      return res.end(JSON.stringify({ version: 1, kind: 'r2-library', complete: true, count: 0, generatedAt: '2026-11-01T00:00:00.000Z', tracks: [] }));
    }
    res.writeHead(404, { ...cors, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 'not_found', message: 'no', request_id: 't' } }));
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  api = `http://127.0.0.1:${mock.address().port}`;
  site = await serve(0, { api });
  base = `http://127.0.0.1:${site.address().port}`;
  // Another site: the same player in its frame.
  other = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<!doctype html><iframe id="f" src="${base}/music/" style="width:390px;height:700px"></iframe>`);
  });
  await new Promise((r) => other.listen(0, 'localhost', r));
  otherBase = `http://localhost:${other.address().port}`;
  browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--autoplay-policy=no-user-gesture-required'] });
});
after(async () => { await browser?.close(); site?.close(); mock?.close(); other?.close(); });

async function signedIn(context) {
  await context.route(`${OLD}/**`, (route) => route.abort());
  const page = await context.newPage();
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
  return page;
}

test('Music opens as a layer that its worker trusts; Back makes it the island; a tap brings it back; commands reach it', opts, async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'allow' });
  const page = await signedIn(context);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && /Content Security Policy|Refused/i.test(m.text())) errors.push(m.text()); });
  await page.goto(`${base}/`);
  seen.length = 0;
  assert.equal(await page.evaluate(() => import('/th/island/island.js').then((m) => m.openApp('music'))), true);
  const frame = page.locator('iframe.th-app');
  await frame.waitFor({ state: 'attached' });
  assert.match(await frame.getAttribute('src'), /^\/music\/\?th-frame=[0-9a-f]{32}$/, 'opened with a one-time token');
  // The framed player asks for the catalog with the owner's session: its worker trusts this frame.
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline && !seen.some((s) => s.auth === `Bearer ${TOKEN}`)) await new Promise((r) => setTimeout(r, 200));
  assert.ok(seen.some((s) => s.auth === `Bearer ${TOKEN}`), `the framed player was given the session (${JSON.stringify(seen)})`);

  // Music reloads itself in the frame (a day/night switch does): its page claims the trust back.
  await page.evaluate(() => document.querySelector('iframe.th-app').contentWindow.location.reload());
  await page.waitForFunction(() => document.querySelector('iframe.th-app').contentWindow.__cp?.player, null, { timeout: 20_000 });
  await page.waitForTimeout(1500);
  seen.length = 0;
  // The player's next library request, after the page has claimed its trust back.
  await page.evaluate((old) => document.querySelector('iframe.th-app').contentWindow.fetch(`${old}/music/library.json`).catch(() => {}), OLD);
  const again = Date.now() + 10_000;
  while (Date.now() < again && !seen.some((s) => s.auth === `Bearer ${TOKEN}`)) await new Promise((r) => setTimeout(r, 200));
  assert.ok(seen.some((s) => s.auth === `Bearer ${TOKEN}`), 'trusted again after it reloaded itself');
  // No token's address is ever stored: the page came from Music's own address.
  const stored = await page.evaluate(async () => (await Promise.all((await caches.keys()).map(async (k) => (await (await caches.open(k)).keys()).map((r) => r.url)))).flat());
  assert.ok(!stored.some((u) => u.includes('th-frame=')), stored.filter((u) => u.includes('th-frame=')).join(' '));

  // Back: into the island; the frame stays loaded behind the chat.
  await page.goBack();
  await page.waitForSelector('.th-island:not([hidden])');
  await page.waitForFunction(() => document.querySelector('iframe.th-app')?.classList.contains('away'));
  assert.equal(await page.evaluate(() => document.body.dataset.island), 'music');
  assert.equal(await page.evaluate(() => location.pathname), '/', 'still home');
  // A tap on the island: Music grows back.
  await page.locator('.th-island').click();
  await page.waitForFunction(() => !document.querySelector('iframe.th-app')?.classList.contains('away'));
  await page.waitForSelector('.th-island', { state: 'hidden' });

  // The commands act on the player in the frame (nothing is queued here, so pause is safe to call).
  const r = await page.evaluate(() => import('/th/island/island.js').then((m) => m.control('sleep', 20)));
  assert.deepEqual([r.ok, r.text], [true, 'Music stops in 20 minutes.']);
  assert.equal(await page.evaluate(() => document.querySelector('iframe.th-app').contentWindow.__cp.player.sleep?.seconds), 1200);
  // On the island: a moon and the minutes left (waiting at its full time while nothing plays).
  await page.goBack();
  await page.waitForSelector('.th-island.sleep:not([hidden])');
  assert.equal(await page.locator('.th-island .zz b').textContent(), '20');
  assert.match(await page.locator('.th-island').getAttribute('aria-label'), /stops in 20 min/);
  // Held open, the card turns it off; the island's moon goes.
  const box = await page.locator('.th-island').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForSelector('.th-wide');
  await page.mouse.up();
  await page.locator('.th-wide button', { hasText: 'Sleep off (20 min)' }).click();
  await page.waitForFunction(() => !document.querySelector('iframe.th-app').contentWindow.__cp.player.sleep);
  await page.waitForSelector('.th-island:not(.sleep)');
  await page.waitForFunction(() => document.querySelector('.toast:not(.utoast)')?.textContent.includes('Sleep timer off.'));
  await page.evaluate(() => import('/th/island/island.js').then((m) => m.close()));
  assert.equal(await page.locator('iframe.th-app').count(), 0);
  const none = await page.evaluate(() => import('/th/island/island.js').then((m) => m.control('pause')));
  assert.equal(none.ok, false);
  assert.deepEqual(errors, []);
  await context.close();
});

test("the same player framed by another site's page gets no session", opts, async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'allow' });
  const page = await signedIn(context);
  // The worker is installed, as it would be after the owner used Music.
  await page.goto(`${base}/music/`);
  await page.evaluate(async () => { await navigator.serviceWorker.register('/music/sw.js', { scope: '/music/' }); await navigator.serviceWorker.ready; });
  // That top-level page's own requests (trusted, rightly) finish before the count starts.
  await page.goto(`${base}/no-such-page`);
  await page.waitForTimeout(2000);
  seen.length = 0;
  await page.goto(`${otherBase}/`);
  const f = page.frameLocator('#f');
  await f.locator('body').waitFor({ state: 'attached', timeout: 20_000 });
  await page.waitForTimeout(4000);
  assert.ok(!seen.some((s) => s.auth.startsWith('Bearer ')), `no session for another site's frame (${JSON.stringify(seen)})`);
  // Nor with a made-up token: a token is only good once home gave it to the worker.
  await page.evaluate((u) => { document.getElementById('f').src = `${u}/music/?th-frame=${'a'.repeat(32)}`; }, base);
  await page.waitForTimeout(4000);
  assert.ok(!seen.some((s) => s.auth.startsWith('Bearer ')), 'a made-up token is no key');
  await context.close();
});

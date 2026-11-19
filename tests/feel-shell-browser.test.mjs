// The shell's feel report in Chromium at 390×844 against the mocked Worker: holding for the ring and swiping for
// the menu are timed under their names (ui/feel/log.js), and Settings › About › "Copy feel report" copies a report
// that starts with the screen's refresh rate and carries both, with no address in it (ui/feel/report.js).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { API, mockApi, TOKEN } from './fixtures/mock-api.mjs';
import { afterFirstPaint, until } from './fixtures/waits.mjs';

const opts = { skip: Boolean(process.env.SITE_URL) && 'local only (mocked API)' };
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'Authorization, Content-Type, TH-Client', 'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE' };
let server, browser, base;
before(async () => {
  if (opts.skip) return;
  server = await serve(0, { api: API });
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => { await browser?.close(); server?.close(); });

const resting = (page) => page.evaluate(async () => (await import('/th/motion.js')).whenResting());
const names = (page) => page.evaluate(async () => (await import('/ui/feel/log.js')).feelEntries().map((e) => e.name));

test('the ring and the menu are in the copied feel report, which names no address', opts, async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    try { localStorage.setItem('th.p.sent', '1'); } catch {}
    // The clipboard as the page sees it (headless Chromium has no clipboard to read back).
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => { window.copied = t; } } });
  });
  await mockApi(page, {});
  const reply = (route, body) => route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  await page.route(`${API}/v1/settings`, (route) => (route.request().method() === 'OPTIONS' ? route.fulfill({ status: 204, headers: CORS }) : reply(route, { 'owner.tz': 'UTC', min_client: 0 })));
  await page.route(`${API}/v1/health`, (route) => reply(route, { ok: true, version: { id: '5e1f0c2a-0000-4000-8000-000000000001', tag: null }, min_client: 0, at: Date.now() }));
  await page.route(`${API}/v1/ops/meter?days=1`, (route) => reply(route, { items: [], today: { day: '2026-11-02', rows_read: 1, rows_written: 1, read_pct: 0, written_pct: 0, pct: 0, hold_until: null } }));
  await page.goto(`${base}/no-such-page`);
  await page.evaluate((token) => new Promise((resolve) => { const req = indexedDB.open('th-auth', 1); req.onupgradeneeded = () => req.result.createObjectStore('kv'); req.onsuccess = () => { const tx = req.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put({ session_id: 's1', token, signed_in_at: Date.now(), username: 'example-owner' }, 'session'); tx.oncomplete = () => { req.result.close(); resolve(); }; }; }), TOKEN);
  await page.goto(`${base}/`, { waitUntil: 'load' });
  await page.waitForSelector('html[data-signed-in]');
  await afterFirstPaint(page);

  // Hold an empty spot for the ring, let it rest, then let go without choosing (it folds back).
  const spot = await page.evaluate(() => { const r = document.querySelector('#app').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height * 0.4 }; });
  await page.mouse.move(spot.x, spot.y); await page.mouse.down();
  await page.waitForFunction(() => document.querySelector('#ring').classList.contains('show'));
  await page.waitForFunction(() => !document.querySelector('#ring').classList.contains('moving'));
  await page.mouse.up();
  await until(async () => (await names(page)).includes('ring:close'), { message: 'the ring closed' });
  // Swipe left for the menu.
  await page.mouse.move(330, spot.y); await page.mouse.down();
  await page.mouse.move(250, spot.y, { steps: 4 }); await page.mouse.move(40, spot.y, { steps: 8 }); await page.mouse.up();
  await resting(page);
  await until(async () => (await names(page)).includes('menu:open'), { message: 'the menu opened' });

  await page.evaluate(() => document.dispatchEvent(new CustomEvent('th:open', { detail: { name: 'about' } })));
  await page.waitForSelector('.spage.in #about-feel');
  await page.waitForFunction(() => !document.querySelector('.spage').classList.contains('moving'));
  await page.click('#about-feel');
  const text = await until(() => page.evaluate(() => window.copied), { message: 'the report was copied' });
  const lines = text.split('\n');
  assert.match(lines[0], /^Thunderhead feel report · screen (\d+ Hz|not measured yet)/);
  assert.match(lines[1], /^motion (full|reduced|off) · /);
  assert.match(text, /^ring:open\s+\d+/m);
  assert.match(text, /^ring:close\s+\d+/m);
  assert.match(text, /^menu:open\s+\d+/m);
  assert.match(text, /^settings:in\s+\d+/m);
  assert.match(text, /^what froze/m);
  assert.doesNotMatch(text, /https?:|127\.0\.0\.1|th\.test|example-owner|\/\w+\.js|[?#&=]/, 'no address, query or name');
  assert.equal(await page.textContent('#toast, .toast'), 'Feel report copied');
  assert.deepEqual(errors, []);
  await context.close();
});

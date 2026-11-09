// The settings second pass (MENU-AND-SETTINGS.md §6.6, §6.7), in Chromium at 390×844 against the
// mocked Worker: the mind's name, the owner's day and evening hours and Keep conversations are rows
// on their pages; the name goes to the Worker and the shell says it where it said "the mind"; and
// ui/theme.js's Auto flips at the owner's hours with a faked clock. Invented values only.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { API, mockApi, TOKEN } from './fixtures/mock-api.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (mocked API)' };
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'Authorization, Content-Type, TH-Client', 'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE' };
let server, browser, base;
before(async () => {
  if (live) return;
  server = await serve(0, { api: API });
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => { await browser?.close(); server?.close(); });

/** Signed in on home, the Worker's settings `stored` (GET) and every PATCH kept in `patches`. */
async function open(stored = {}, { theme = 'light', clock } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', timezoneId: 'UTC' });
  if (clock) await context.clock.install({ time: clock });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((t) => {
    try {
      if (!sessionStorage.getItem('seeded')) {
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem('th.p.sent', '1');
        localStorage.setItem('th-theme', t);
      }
    } catch {}
  }, theme);
  await mockApi(page, {});
  const w = { stored: { 'owner.tz': 'UTC', min_client: 0, ...stored }, patches: [] };
  const reply = (route, status, body) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  await page.route(`${API}/v1/settings`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    if (req.method() === 'GET') return reply(route, 200, w.stored);
    const body = req.postDataJSON();
    w.patches.push(body);
    Object.assign(w.stored, body);
    return reply(route, 200, body);
  });
  await page.goto(`${base}/no-such-page`);
  await page.evaluate((token) => new Promise((resolve) => { const req = indexedDB.open('th-auth', 1); req.onupgradeneeded = () => req.result.createObjectStore('kv'); req.onsuccess = () => { const tx = req.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put({ session_id: 's1', token, signed_in_at: Date.now(), username: 'example-owner' }, 'session'); tx.oncomplete = () => { req.result.close(); resolve(); }; }; }), TOKEN);
  await page.goto(`${base}/`, { waitUntil: 'load' });
  await page.waitForSelector('html[data-signed-in]');
  return { page, context, errors, w };
}

async function show(page, name) {
  await page.evaluate((n) => document.dispatchEvent(new CustomEvent('th:open', { detail: { name: n } })), name);
  await page.waitForSelector(`.spage.in .scatalog[data-group="${name}"]:not([aria-busy])`);
  await page.waitForFunction(() => { const p = document.querySelector('.spage'); return p && !p.classList.contains('moving') && !p.getAnimations().length; });
}
const shot = (page, name) => page.screenshot({ path: new URL(`../.deploy/settings-second-${name}.png`, import.meta.url).pathname });

test('the three rows are on their pages; the name goes to the Worker and the shell says it', opts, async () => {
  const { page, context, errors, w } = await open();
  await show(page, 'mind');
  const rows = await page.$$eval('.spage.in [data-key]', (n) => n.map((x) => x.dataset.key));
  for (const key of ['mind.name', 'mind.day_start', 'mind.night_start']) assert.ok(rows.includes(key), key);
  assert.equal(await page.textContent('.spage.in .page-title'), 'The mind', 'no name yet: the mind');
  await page.click('[data-key="mind.name"]');
  await page.fill('.sheet input.field', 'Wren');
  await page.click('.sheet .btn');
  await page.waitForFunction(() => document.querySelector('[data-key="mind.name"] .row-value')?.textContent === 'Wren');
  await page.click('[data-key="mind.night_start"]');
  await page.click('.sheet [data-v="21:00"], .sheet [data-value="21:00"]');
  await page.waitForFunction(() => document.querySelector('[data-key="mind.night_start"] .row-value')?.textContent === '21:00');
  await page.waitForFunction(() => !document.querySelector('.sheet'));
  await page.locator('[data-key="mind.day_start"]').scrollIntoViewIfNeeded();
  await shot(page, 'mind');
  assert.deepEqual(w.patches, [{ 'mind.name': 'Wren' }, { 'mind.night_start': '21:00' }]);
  await show(page, 'privacy');
  const retention = await page.$eval('[data-key="privacy.retention"]', (n) => ({ detail: n.querySelector('.row-detail')?.textContent, h: n.getBoundingClientRect().height }));
  assert.match(retention.detail, /filed under a topic are kept/);
  await page.locator('[data-key="privacy.retention"]').scrollIntoViewIfNeeded();
  await shot(page, 'privacy');
  // The shell: Settings' row and page title, and the copy module everywhere else.
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('th:open', { detail: { name: 'settings' } })));
  await page.waitForSelector('.spage.in [data-page="mind"]');
  assert.equal(await page.textContent('.spage.in [data-page="mind"] .row-title'), 'Wren');
  assert.equal(await page.evaluate(async () => (await import('/th/copy.js')).mindName()), 'Wren');
  assert.deepEqual(errors, []);
  await context.close();
});

test('Auto flips at the owner’s hours, 07:00 and 22:00 unless set, with a faked clock', opts, async () => {
  const { page, context, errors, w } = await open({}, { theme: 'auto', clock: new Date('2026-11-04T21:59:00Z') });
  // A fast-forward fires the flip's timer, but its callback can land just after fastForward resolves
  // (seen in the headless shell CI uses): wait up to 2 s for the expected theme, then assert as before.
  const theme = (want) => page.waitForFunction((t) => document.documentElement.dataset.theme === t, want, { timeout: 2000 }).catch(() => {})
    .then(() => page.evaluate(() => document.documentElement.dataset.theme));
  assert.equal(await theme('light'), 'light', '21:59: day');
  await page.clock.fastForward('01:30');
  assert.equal(await theme('dark'), 'dark', '22:00: night');
  // The owner moves their hours on another phone: home's next read of the settings brings them.
  Object.assign(w.stored, { 'mind.night_start': '23:00', 'mind.day_start': '06:00' });
  await page.evaluate((s) => import('/th/copy.js').then((m) => m.keepShell(s)), w.stored);
  assert.equal(await theme('light'), 'light', '22:00 with evening from 23:00: day');
  await page.clock.fastForward(60 * 60_000);
  assert.equal(await theme('dark'), 'dark', '23:00: night');
  await page.clock.fastForward((6 * 60 + 59) * 60_000);
  assert.equal(await theme('dark'), 'dark', '05:59: still night');
  await page.clock.fastForward(60_000);
  assert.equal(await theme('light'), 'light', '06:00: day');
  await shot(page, 'theme');
  assert.deepEqual(errors, []);
  await context.close();
});

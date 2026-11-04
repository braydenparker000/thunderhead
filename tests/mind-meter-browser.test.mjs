// Settings › The mind's "Today" (MENU-AND-SETTINGS.md §6.6, MIND-PLAN §5.4) in Chromium at 390×844
// against the mocked Worker: the block at the top of the page, above the lead line and the settings,
// draws GET /v1/mind/usage's counts (the wakes the mind set itself against the wake budget, the
// minutes awake, the night shift's minutes, the 7 days before), counts only; with the budget at Off
// it says so; when the Worker can't answer it says that, and the page's settings still work; the
// cold-wake line carries the outside reads beside it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { API, mockApi, TOKEN, USAGE } from './fixtures/mock-api.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (mocked API)' };
let server, browser, base;
before(async () => {
  if (live) return;
  server = await serve(0, { api: API });
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => { await browser?.close(); server?.close(); });

/** Signed in at phone size, on Settings › The mind once its settings are in. */
async function openMind(overrides = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => { try { localStorage.setItem('th.p.sent', '1'); } catch {} });
  await mockApi(page, overrides);
  await page.goto(`${base}/no-such-page`);
  await page.evaluate((token) => new Promise((resolve) => { const req = indexedDB.open('th-auth', 1); req.onupgradeneeded = () => req.result.createObjectStore('kv'); req.onsuccess = () => { const tx = req.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put({ session_id: 's1', token, signed_in_at: Date.now(), username: 'example-owner' }, 'session'); tx.oncomplete = () => { req.result.close(); resolve(); }; }; }), TOKEN);
  await page.goto(`${base}/`, { waitUntil: 'load' });
  await page.waitForSelector('html[data-signed-in]');
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('th:open', { detail: { name: 'mind' } })));
  await page.waitForSelector('.spage.in .scatalog[data-group="mind"]:not([aria-busy])');
  // A page slides in on springs.page (settings.js): it carries .moving until it rests.
  await page.waitForFunction(() => { const p = document.querySelector('.spage'); return p && !p.classList.contains('moving') && !p.getAnimations().length; });
  return { page, context, errors };
}

const lines = (page) => page.$$eval('.spage.in [data-meter] .group p', (ps) => ps.map((p) => [p.className, p.textContent]));

test('Today draws the usage counts at the top of The mind, counts only', opts, async () => {
  const { page, context, errors } = await openMind();
  await page.waitForSelector('.spage.in [data-meter] .snow');
  assert.deepEqual(await lines(page), [
    ['snow', '4 of 12 wakes I set myself, 1 more refused · 3 waiting'],
    ['shelp', 'Awake 76 min · 6 wakes for you · night shift 24 min'],
    ['shelp', 'Last 7 days: Mon 3 · Sun 5 · Sat 7 · Fri 6 · Thu 8 · Wed 10 · Tue 9 wakes'],
  ]);
  const layout = await page.evaluate(() => {
    const body = document.querySelector('.spage.in .sbody');
    const meter = body.querySelector('[data-meter]');
    const order = [...body.children].map((n) => (n === meter ? 'meter' : n.classList.contains('slead') ? 'lead' : n.classList.contains('scatalog') ? 'settings' : 'other'));
    return {
      order: order.filter((o) => o !== 'other'),
      title: meter.querySelector('.group-title').textContent,
      rows: meter.querySelectorAll('.row, button, [data-key]').length,
      wide: [...meter.querySelectorAll('*')].some((n) => n.getBoundingClientRect().right > innerWidth + 0.5),
    };
  });
  assert.deepEqual(layout, { order: ['meter', 'lead', 'settings'], title: 'Today', rows: 0, wide: false });
  // The budget it counts against is the setting below (five stops: a sheet picker), at its default.
  assert.equal(await page.$eval('[data-key="mind.wake_budget"] .row-value', (v) => v.textContent), '12 a day');
  await page.click('[data-key="mind.wake_budget"]');
  await page.waitForSelector('[role="radio"][data-value="40"]');
  const stops = await page.$$eval('[role="radio"][data-value]', (b) => b.map((x) => x.textContent.trim()));
  assert.deepEqual(stops, ['Off', '6 a day', '12 a day', '24 a day', '40 a day']);
  assert.deepEqual(errors, []);
  await context.close();
});

test('Today with the wake budget at Off, and when the Worker cannot answer', opts, async () => {
  const off = await openMind({ usage: { ...USAGE, budget: 0, live: 0 } });
  await off.page.waitForSelector('.spage.in [data-meter] .snow');
  assert.equal((await lines(off.page))[0][1], 'I set no wakes myself: you turned them off.');
  await off.context.close();
  const down = await openMind({ usage: 'fail' });
  await down.page.waitForSelector('.spage.in [data-meter] .sempty');
  assert.deepEqual(await lines(down.page), [['sempty', "I couldn't read today's count just now."]]);
  // The settings below still answer.
  assert.ok(await down.page.$('[data-key="mind.voice"] .seg-option.on'));
  await down.context.close();
});

test('the cold-wake line carries the outside reads beside it; a day with only lookups says that', opts, async () => {
  const lat = (l) => ({ ...USAGE, today: { ...USAGE.today, latency: l } });
  const both = await openMind({ usage: lat({ replies: 2, claim_s: 12, reply_s: 30, lookups: 3, outside_s: 18 }) });
  await both.page.waitForSelector('.spage.in [data-meter] .snow');
  assert.deepEqual((await lines(both.page)).at(-1), ['shelp', 'From cold: 12 s to wake, then 30 s to the first reply (2 times today). Looking things up: 18 s to the answer (3 times).']);
  await both.context.close();
  const only = await openMind({ usage: lat({ replies: 0, claim_s: null, reply_s: null, lookups: 1, outside_s: 9 }) });
  await only.page.waitForSelector('.spage.in [data-meter] .snow');
  assert.deepEqual((await lines(only.page)).at(-1), ['shelp', 'Looking things up: 9 s to the answer (1 time today).']);
  assert.deepEqual(only.errors, []);
  await only.context.close();
});

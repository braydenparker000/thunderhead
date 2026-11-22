// Settings › For the builder (MENU-AND-SETTINGS.md §4.10), in Chromium at 360 px wide against a
// mocked Worker that keeps items as the real one does (API.md §11.30): reading, then the open items
// newest first; one opens to what happened and its notes; Mark done moves it to Done, Reopen brings
// it back; Add one adds by hand; Copy all copies the open list as plain text; nothing open says so;
// a failed read says why. Invented words only.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { API, mockApi, TOKEN } from './fixtures/mock-api.mjs';
import { resting } from './fixtures/waits.mjs';

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

const item = (id, at, title, extra = {}) => ({ id, at, title, what: `${title}, every time.`, where: 'Music', kind: 'broken', origin: 'mind', from_message_id: null,
  release: 'abcdef012345', seen: null, state: 'open', done_at: null, updated_at: at, notes: [], ...extra });

/** The mocked Worker's list; `fail` makes the reads answer 500. */
async function issues(page, start) {
  const w = { items: new Map(start.map((i) => [i.id, i])), puts: [], patches: [], fail: false };
  const reply = (route, status, body) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  await page.route(new RegExp(`^${API}/v1/issues`), async (route) => {
    const req = route.request(), url = new URL(req.url()), id = url.pathname.split('/')[3];
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    if (req.headers().authorization !== `Bearer ${TOKEN}`) return reply(route, 401, { error: { code: 'unauthorized' } });
    if (req.method() === 'GET') {
      if (w.fail) return reply(route, 500, { error: { code: 'internal' } });
      const state = url.searchParams.get('state');
      return reply(route, 200, { items: [...w.items.values()].filter((i) => i.state === state).sort((a, b) => b.at - a.at), more: false });
    }
    const body = JSON.parse(req.postData() ?? '{}');
    if (req.method() === 'PUT') { w.puts.push(body); const i = item(id, Date.now(), body.title, { ...body, where: body.where ?? null, origin: 'owner_device' }); w.items.set(id, i); return reply(route, 201, { issue: i }); }
    w.patches.push(body);
    const i = w.items.get(id);
    Object.assign(i, body, { done_at: body.state === 'done' ? Date.now() : null });
    return reply(route, 200, { issue: i });
  });
  return w;
}

async function open(start) {
  const context = await browser.newContext({ viewport: { width: 360, height: 800 }, serviceWorkers: 'block', timezoneId: 'UTC', locale: 'en-GB' });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    try { localStorage.setItem('th.p.sent', '1'); } catch {}
    // The clipboard, kept where the test can read it.
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => { window.copied = t; } } });
  });
  await mockApi(page, {});
  const w = await issues(page, start);
  await page.goto(`${base}/no-such-page`);
  await page.evaluate((token) => new Promise((resolve) => { const req = indexedDB.open('th-auth', 1); req.onupgradeneeded = () => req.result.createObjectStore('kv'); req.onsuccess = () => { const tx = req.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put({ session_id: 's1', token, signed_in_at: Date.now(), username: 'example-owner' }, 'session'); tx.oncomplete = () => { req.result.close(); resolve(); }; }; }), TOKEN);
  await page.goto(`${base}/`, { waitUntil: 'load' });
  await page.waitForSelector('html[data-signed-in]');
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('th:open', { detail: { name: 'settings' } })));
  await page.click('.spage.in [data-page="builder"]');
  await page.waitForFunction(() => [...document.querySelectorAll('.spage.in .page-title')].some((h) => h.textContent === 'For the builder'));
  await resting(page);
  return { page, context, errors, w };
}

const DAY = 86_400_000;
const now = Date.UTC(2026, 10, 20, 9);

test('the open items newest first, details and notes, Mark done and Reopen, Add one, Copy all', opts, async () => {
  const older = item('019a0000-0000-7000-8000-000000000001', now - 2 * DAY, 'Podcasts forgets my place', { where: 'Podcasts', kind: 'annoying', notes: [{ id: 'n1', at: now - DAY, by: 'mind', text: 'Again on the long episode.' }] });
  const newer = item('019a0000-0000-7000-8000-000000000002', now, 'Music skips the first second');
  const { page, context, errors, w } = await open([older, newer]);
  await page.waitForSelector('.spage.in [data-issue]');
  assert.deepEqual(await page.$$eval('.spage.in [data-items] [data-issue] .row-title', (n) => n.map((x) => x.textContent)), ['Music skips the first second', 'Podcasts forgets my place']);
  assert.equal(await page.isHidden('.spage.in details[data-add-fold] ~ details'), true, 'no Done fold while nothing is done');

  // An item opens to what happened and its notes.
  await page.click(`.spage.in [data-issue="${older.id}"]`);
  await page.waitForSelector('.spage.in [data-what]');
  assert.equal(await page.textContent('.spage.in [data-what]'), 'Podcasts forgets my place, every time.');
  assert.match(await page.textContent('.spage.in [data-note]'), /The mind, .*Again on the long episode\./);

  // Copy all: the open list as plain text.
  await page.click('.spage.in [data-copy]');
  await page.waitForFunction(() => window.copied?.startsWith('For the builder: 2 open'));
  const text = await page.evaluate(() => window.copied);
  assert.match(text, /1\. Music skips the first second \(Broken, Music, 2026-11-20\)/);
  assert.match(text, /Note \(the mind, 2026-11-19\): Again on the long episode\./);

  // Mark done: it leaves the open list for Done; Reopen brings it back.
  await page.click('.spage.in .mdetail .btn');
  await page.waitForFunction(() => document.querySelectorAll('.spage.in [data-items] [data-issue]').length === 1);
  assert.deepEqual(w.patches, [{ state: 'done' }]);
  await page.click('.spage.in [data-done] ~ summary, .spage.in details:has([data-done]) > summary');
  await page.click(`.spage.in [data-done] [data-issue="${older.id}"]`);
  await page.click('.spage.in [data-done] .mdetail .btn');
  await page.waitForFunction(() => document.querySelectorAll('.spage.in [data-items] [data-issue]').length === 2);
  assert.deepEqual(w.patches.at(-1), { state: 'open' });

  // Add one by hand.
  await page.click('.spage.in details[data-add-fold] > summary');
  await page.click('.spage.in [data-add] .btn[type="submit"]');
  await page.waitForFunction(() => /Say what it is/.test(document.querySelector('.spage.in [data-add] [role="status"]')?.textContent ?? ''));
  await page.fill('#issue-title', '  The ring opens late ');
  await page.fill('#issue-what', 'It takes a second.');
  await page.click('.spage.in [data-add] .seg-option[data-v="idea"]');
  await page.click('.spage.in [data-add] .btn[type="submit"]');
  await page.waitForFunction(() => document.querySelectorAll('.spage.in [data-items] [data-issue]').length === 3);
  assert.deepEqual(w.puts, [{ title: 'The ring opens late', what: 'It takes a second.', kind: 'idea' }]);
  assert.equal(await page.inputValue('#issue-title'), '');

  // Nothing wider than the screen.
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= 360), 'fits 360 px');
  assert.deepEqual(errors, []);
  await context.close();
});

test('nothing open says so; a failed read says why', opts, async () => {
  const { page, context, errors, w } = await open([]);
  await page.waitForFunction(() => /Nothing open/.test(document.querySelector('.spage.in .line')?.textContent ?? ''));
  assert.equal(await page.isDisabled('.spage.in [data-copy]'), true);
  w.fail = true;
  await page.click('.spage.in details[data-add-fold] > summary');
  await page.fill('#issue-title', 'Slow');
  await page.fill('#issue-what', 'The menu is slow.');
  await page.click('.spage.in [data-add] .btn[type="submit"]');
  await page.waitForFunction(() => /went wrong on our side/.test(document.querySelector('.spage.in .line')?.textContent ?? ''));
  assert.deepEqual(errors, []);
  await context.close();
});

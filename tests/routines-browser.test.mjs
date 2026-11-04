// Settings › The mind › Routines (MENU-AND-SETTINGS.md §6.6, MIND-PLAN §3.6) in Chromium at 390×844
// against the mocked Worker: the fold reads GET /v1/routines only when it opens, then draws each
// routine with its name and condition in words, its switch, when it last ran and Undo for that run;
// a failed run says why; one that is off can be removed. Switch, Undo and Remove each send their
// call and read the list again. Synthetic routines only.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { API, mockApi, TOKEN } from './fixtures/mock-api.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (mocked API)' };
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
let server, browser, base;
before(async () => {
  if (live) return;
  server = await serve(0, { api: API });
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => { await browser?.close(); server?.close(); });

const ID = (n) => `0192f0c4-0000-7000-8000-00000000000${n}`;
const routine = (n, over = {}) => ({ id: ID(n), name: 'Morning music', what: 'Morning music is queued.', why: 'an invented reason', when: 'Weekdays at 07:30',
  condition: { at: '07:30', days: ['mon', 'tue', 'wed', 'thu', 'fri'] }, steps: ['music.queue'], on: true, permit: 'tell', proposal_id: ID(9),
  approved_at: Date.UTC(2026, 10, 1), next_at: Date.UTC(2026, 10, 5, 7, 30), last_run_at: Date.UTC(2026, 10, 4, 7, 30), last_ledger_id: ID(8),
  last_undone: false, last_error: null, ...over });

/** Signed in at phone size, on Settings › The mind, with the routines answered from `list`. */
async function openMind(list) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', timezoneId: 'UTC' });
  const page = await context.newPage();
  const errors = [];
  const heard = { reads: 0, calls: [] };
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => { try { localStorage.setItem('th.p.sent', '1'); } catch {} });
  await mockApi(page, {});
  const reply = (route, status, body) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  await page.route(`${API}/v1/routines**`, (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    if (req.method() === 'GET') { heard.reads++; return reply(route, 200, { items: list() }); }
    heard.calls.push([req.method(), new URL(req.url()).pathname, req.postDataJSON?.() ?? null]);
    return reply(route, 200, {});
  });
  await page.route(`${API}/v1/ledger/*/undo`, (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    heard.calls.push(['POST', new URL(route.request().url()).pathname, route.request().postDataJSON()]);
    return reply(route, 200, { status: 'undone' });
  });
  await page.goto(`${base}/no-such-page`);
  await page.evaluate((token) => new Promise((resolve) => { const req = indexedDB.open('th-auth', 1); req.onupgradeneeded = () => req.result.createObjectStore('kv'); req.onsuccess = () => { const tx = req.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put({ session_id: 's1', token, signed_in_at: Date.now(), username: 'example-owner' }, 'session'); tx.oncomplete = () => { req.result.close(); resolve(); }; }; }), TOKEN);
  await page.goto(`${base}/`, { waitUntil: 'load' });
  await page.waitForSelector('html[data-signed-in]');
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('th:open', { detail: { name: 'mind' } })));
  await page.waitForSelector('.spage.in .scatalog[data-group="mind"]:not([aria-busy])');
  await page.waitForFunction(() => { const p = document.querySelector('.spage'); return p && !p.classList.contains('moving') && !p.getAnimations().length; });
  return { page, context, errors, heard };
}

const boxes = (page) => page.$$eval('#mind-routines [data-routine]', (bs) => bs.map((b) => ({
  id: b.dataset.routine,
  sw: b.querySelector('[role="switch"]')?.getAttribute('aria-checked'),
  text: b.textContent,
  buttons: [...b.querySelectorAll('.sbtn')].map((x) => [x.textContent, x.getAttribute('aria-label'), x.getBoundingClientRect().height]),
})));

test('Routines: each with its condition in words, its switch, its last run and Undo; off, Remove', opts, async () => {
  let items = [routine(1), routine(2, { name: 'Evening wind-down', when: 'Every day at 21:00', on: false, last_run_at: Date.UTC(2026, 10, 3, 21), last_error: 'step 1 (music.queue): not_found', last_ledger_id: null })];
  const { page, context, errors, heard } = await openMind(() => items);
  assert.equal(heard.reads, 0, 'read only when it opens');
  await page.click('#mind-routines summary');
  await page.waitForSelector('#mind-routines [data-routine]');
  await page.locator('#mind-routines').scrollIntoViewIfNeeded();
  // SHOT=<file.png> keeps a look at it at phone size.
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
  const [a, b] = await boxes(page);
  assert.equal(a.sw, 'true');
  assert.equal(a.text, 'Morning musicWeekdays at 07:30Last ran 4 Nov, 07:30.Undo');
  assert.deepEqual(a.buttons.map(([t, n]) => [t, n]), [['Undo', 'Undo the last run of Morning music']]);
  assert.equal(b.sw, 'false');
  assert.equal(b.text, 'Evening wind-downEvery day at 21:00Last try 3 Nov, 21:00 stopped: step 1 (music.queue): not_found.Remove');
  for (const [, , h] of [...a.buttons, ...b.buttons]) assert.ok(h >= 44, `a button is ${h}px`);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no sideways scroll');
  // Undo the last run: its ledger row's undo, then the list again.
  items = [{ ...items[0], last_undone: true }, items[1]];
  await page.click(`#mind-routines [data-routine="${ID(1)}"] .sbtn`);
  await page.waitForFunction(() => document.querySelector('#mind-routines [data-routine]')?.textContent.includes('then undone'));
  assert.deepEqual(heard.calls.at(-1), ['POST', `/v1/ledger/${ID(8)}/undo`, {}]);
  // The switch: off, then the list again with Remove.
  items = [{ ...items[0], on: false }, items[1]];
  await page.click(`#mind-routines [data-routine="${ID(1)}"] [role="switch"]`);
  await page.waitForFunction((id) => document.querySelector(`#mind-routines [data-routine="${id}"] .sbtn`)?.textContent === 'Remove', ID(1));
  assert.deepEqual(heard.calls.at(-1), ['POST', `/v1/routines/${ID(1)}/switch`, { on: false }]);
  assert.ok(await page.waitForSelector("text=Morning music is off. It won't run until you switch it on."));
  // Remove, once off.
  items = [items[1]];
  await page.click(`#mind-routines [data-routine="${ID(1)}"] .sbtn`);
  await page.waitForFunction(() => document.querySelectorAll('#mind-routines [data-routine]').length === 1);
  assert.deepEqual(heard.calls.at(-1), ['DELETE', `/v1/routines/${ID(1)}`, null]);
  assert.equal(heard.reads, 4);
  assert.deepEqual(errors, []);
  await context.close();
});

test('Routines: none yet says so', opts, async () => {
  const { page, context, errors } = await openMind(() => []);
  await page.click('#mind-routines summary');
  assert.ok(await page.waitForSelector('#mind-routines >> text=No routines yet. I ask before I set one up.'));
  assert.deepEqual(errors, []);
  await context.close();
});

// The night shift's tiles on the Briefing page in Chromium at 390×844 against the mocked Worker
// (BRIEFING.md §2, §4): after "Waiting on you", the study tile pairs with it as two halves, the
// built-overnight tile shows its big number, a note asked wide spans the row, and a tap opens a
// tile's place in its app. And the tiles the Worker fills itself (2026-11-02): the day's line under
// the title, Due (a tap opens today's and tomorrow's reminders), Holidays (nothing to open), and the
// line that says why the night's tiles are missing. CSP violations are console errors, so the test
// also proves the page fits.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { API, mockApi, TOKEN } from './fixtures/mock-api.mjs';
import { briefingState, calendarTile } from './fixtures/mock-briefing.mjs';
import { resting, until } from './fixtures/waits.mjs';
/** The Briefing in view and at rest (home.js go(): it stops being inert, then the springs settle). */
const briefRest = async (page) => {
  await page.waitForFunction(() => !document.querySelector('#brief').inert);
  await resting(page);
};

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

const night = (slot, more) => ({ kind: 'night', slot, detail: null, big: null, wide: false, app: null, path: null, why: 'Because.', ...more });

test('night tiles: in order, halves paired, a big number, a wide note, a tap opens its place', opts, async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const state = briefingState();
  state.page.tiles.push(
    night('study', { label: 'Study', value: 'Book A, chapter 3', detail: 'p. 212 · 20 min', app: 'study', path: '/study/?book=b1&p=212', ledger_id: '0192f0c4-0000-7000-8000-00000000c0de' }),
    night('built', { label: 'Built overnight', value: 'A calm playlist', big: '31', detail: 'songs, ready in Music', app: 'music', path: '/music/#pl=calm123456' }),
    night('note.1', { label: 'Note', value: 'Bring the umbrella', wide: true }),
  );
  const api = await mockApi(page, { briefing: state });
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
  errors.length = 0;
  await page.goto(`${base}/`, { waitUntil: 'load' });
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('th:go', { detail: 'brief' })));
  await page.waitForSelector('#brief .tile.night');
  assert.deepEqual(await page.$$eval('#brief .grid > .tile', (ts) => ts.map((t) => [t.className, t.querySelector('.k').textContent, t.querySelector('.big')?.textContent ?? null, t.querySelector('.v')?.textContent])), [
    ['tile gold half', 'Waiting on you', null, 'Forget the old address?'],
    ['tile half night', 'Study', null, 'Book A, chapter 3'],
    ['tile half night wide', 'Built overnight', '31', 'A calm playlist'],
    ['tile wide night', 'Note', null, 'Bring the umbrella'],
  ]);
  assert.equal(await page.locator('#brief .tile.night', { hasText: 'Note' }).evaluate((t) => t.tagName), 'DIV');
  await briefRest(page);
  await page.locator('#brief .tile.night', { hasText: 'Study' }).click();
  await page.waitForURL(/\/study\/\?book=b1&p=212$/);
  assert.deepEqual(errors.filter((e) => !/study|pdf/i.test(e)), []);
  // The tap acted on the night's arrangement (M-16): its ledger row, sent from Study with its own
  // opening (Study's own data isn't mocked here).
  const sent = () => api.calls.filter((c) => c.call.startsWith('PUT /v1/senses/batches/')).flatMap((c) => c.body.events);
  await until(() => sent().length >= 2).catch(() => {});
  assert.deepEqual(sent().map((e) => [e.type, e.ref ?? null]).sort(), [['briefing.tile', 'ledger:0192f0c4-0000-7000-8000-00000000c0de'], ['study.open', null]]);
  await context.close();
});

/** Signs this context in (the token the mocked Worker takes) and opens the Briefing; console errors
 * count from the app's own load. */
async function openBriefing(page, errors) {
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
  errors.length = 0;
  await page.goto(`${base}/`, { waitUntil: 'load' });
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('th:go', { detail: 'brief' })));
}

test('the Worker’s own tiles: the day’s line, Due with its sheet, Holidays, and why the night’s tiles are missing', opts, async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const state = briefingState();
  const at = (d, h, m = 0) => { const t = new Date(); t.setDate(t.getDate() + d); t.setHours(h, m, 0, 0); return t.getTime(); };
  state.page.today = { date: 'Monday 2 November', line: '2 reminders due today, 3 new episodes and 12 songs added.' };
  state.page.night = 'The night shift ran out of time before arranging this page.';
  state.page.tiles.push(
    { kind: 'due', label: 'Due', value: '2 today · 1 tomorrow', detail: 'Next at 14:30', today: 2, tomorrow: 1,
      items: [{ id: 'r1', text: 'Call the plumber', at: at(0, 14, 30) }, { id: 'r2', text: 'Pick up the parcel', at: at(0, 18) }, { id: 'r3', text: 'Water the plants', at: at(1, 9) }] },
    night('study', { label: 'Study', value: 'Book A, chapter 3', detail: 'p. 212 · 20 min', app: 'study', path: '/study/?book=b1&p=212' }),
    { kind: 'holiday', label: 'Holidays', value: 'Example Day', detail: 'Wednesday 11 November · in 9 days', date: '2026-11-11', in_days: 9 },
  );
  await mockApi(page, { briefing: state });
  errors.length = 0;
  await openBriefing(page, errors);
  await page.waitForSelector('#brief .tile.due');
  // The date and the day's line are the Worker's; the line sits under the title.
  assert.equal(await page.locator('#bdate').textContent(), 'Monday 2 November');
  assert.equal(await page.locator('#brief .btitle + .btoday').textContent(), '2 reminders due today, 3 new episodes and 12 songs added.');
  // After "Waiting on you": Due (a button), the night's tile, then Holidays (nothing to open), in pairs.
  assert.deepEqual(await page.$$eval('#brief .grid > .tile', (ts) => ts.map((t) => [t.tagName, t.className, t.querySelector('.k').textContent, t.querySelector('.v').textContent, t.querySelector('.s')?.textContent ?? null])), [
    ['BUTTON', 'tile gold half', 'Waiting on you', 'Forget the old address?', 'One tap on home'],
    ['BUTTON', 'tile half due', 'Due', '2 today · 1 tomorrow', 'Next at 14:30'],
    ['BUTTON', 'tile half night', 'Study', 'Book A, chapter 3', 'p. 212 · 20 min'],
    ['DIV', 'tile half holiday', 'Holidays', 'Example Day', 'Wednesday 11 November · in 9 days'],
  ]);
  assert.equal(await page.locator('#brief .tile.holiday use').getAttribute('href'), '/ui/icons.svg#calendar-star');
  assert.equal(await page.locator('#brief .bnight').textContent(), 'The night shift ran out of time before arranging this page.');
  // Every tile fits the phone: no horizontal scroll, no tile wider than the page.
  assert.ok(await page.evaluate(() => [...document.querySelectorAll('#brief .grid > .tile')].every((t) => t.getBoundingClientRect().right <= innerWidth)));
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/briefing-worker-tiles.png` });
  // Due opens its list: today's then tomorrow's, each with its time and words.
  await briefRest(page);
  await page.locator('#brief .tile.due').click();
  const sheet = page.locator('.dsheet');
  await sheet.waitFor();
  assert.deepEqual(await sheet.locator('.dday').allTextContents(), ['Today', 'Tomorrow']);
  assert.deepEqual(await sheet.locator('.dlist li').allTextContents(), ['14:30Call the plumber', '18:00Pick up the parcel', '09:00Water the plants']);
  if (process.env.SHOTS) await resting(page).then(() => page.screenshot({ path: `${process.env.SHOTS}/briefing-due-sheet.png` }));
  await page.keyboard.press('Escape');
  await sheet.waitFor({ state: 'detached' });
  assert.deepEqual(errors, []);
  await context.close();
});

test('Today: the calendar’s events with their times and places, the all-day ones as one line, tomorrow’s first, a failing link’s line', opts, async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const state = briefingState();
  state.page.today = { date: 'Tuesday 3 November', line: '3 things on today and 1 reminder due today.' };
  state.page.tiles.push(calendarTile({ notice: 'Calendar not reachable since Sunday 21:30' }));
  await mockApi(page, { briefing: state });
  await openBriefing(page, errors);
  await page.waitForSelector('#brief .tile.cal');
  const t = page.locator('#brief .tile.cal');
  // Wide, after "Waiting on you"; nothing to open.
  assert.deepEqual(await page.$$eval('#brief .grid > .tile', (ts) => ts.map((x) => x.querySelector('.k').textContent)), ['Waiting on you', 'Today']);
  assert.equal(await t.evaluate((n) => [n.tagName, n.classList.contains('wide')].join()), 'DIV,true');
  assert.equal(await t.locator('use').getAttribute('href'), '/ui/icons.svg#calendar-blank');
  assert.deepEqual(await t.locator('.v, .s').allTextContents(), [
    '15:00 Dentist · High Street',
    '18:30 Dinner',
    'All day: Bins out',
    'Tomorrow 09:00 Standup',
    'Calendar not reachable since Sunday 21:30',
  ]);
  assert.deepEqual(await t.locator('.v').allTextContents(), ['15:00 Dentist · High Street', '18:30 Dinner']);
  assert.equal(await t.getAttribute('aria-label'), 'Today, 15:00 Dentist · High Street, 18:30 Dinner, All day: Bins out, Tomorrow 09:00 Standup, Calendar not reachable since Sunday 21:30');
  assert.equal(await page.locator('#brief .btoday').textContent(), '3 things on today and 1 reminder due today.');
  assert.ok(await t.evaluate((n) => n.getBoundingClientRect().right <= innerWidth && document.scrollingElement.scrollWidth <= innerWidth));
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/briefing-today.png` });
  // Only the failing link's line: the tile says so on its own.
  state.page.tiles = [{ ...calendarTile(), today: [], tomorrow: null, value: 'Calendar not reachable', detail: 'A calendar link redirects elsewhere.', notice: 'A calendar link redirects elsewhere.' }];
  await page.reload({ waitUntil: 'load' });
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('th:go', { detail: 'brief' })));
  await page.waitForFunction(() => document.querySelector('#brief .tile.cal .v')?.textContent === 'Calendar not reachable');
  assert.deepEqual(await t.locator('.v, .s').allTextContents(), ['Calendar not reachable', 'A calendar link redirects elsewhere.']);
  assert.deepEqual(errors, []);
  await context.close();
});

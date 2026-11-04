// The night's report on the Briefing in Chromium at 390×844 against the mocked Worker (BRIEFING.md
// "The report card"): the first tile, folded to "Overnight", the headline and the counts; a tap (or
// Enter) opens its lines in place with `aria-expanded`, a line that names a ledger row has an Undo
// (POST /v1/ledger/:id/undo) and says Undone once undone, also after the page redraws; a second tap
// folds it. CSP violations are console errors, so the test also proves the page fits.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { API, mockApi, TOKEN } from './fixtures/mock-api.mjs';
import { briefingState } from './fixtures/mock-briefing.mjs';
import { resting, until } from './fixtures/waits.mjs';

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

const KEPT = '0192f0c4-0000-7000-8000-0000000000a1';
const CLOSED = '0192f0c4-0000-7000-8000-0000000000a2';
const report = {
  kind: 'report', label: 'Overnight', value: 'A quiet night, two things kept', detail: '1 fact · 1 loose end', day: '2026-11-03',
  lines: [
    { kind: 'memory', text: 'Kept that you like calm music in the evening', path: null, ledger_id: KEPT, undo: 'open' },
    { kind: 'music', text: 'Music is ready for the evening', path: '/music/', ledger_id: null, undo: null },
    { kind: 'loose_ends', text: 'Closed the loose end about the invented boiler', path: null, ledger_id: CLOSED, undo: 'undone' },
  ],
  cut: [5, 6],
};

test('the report: first, folded; a tap opens its lines, Undo undoes a line, a second tap folds it', opts, async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const state = briefingState();
  state.page.tiles.unshift(report);
  const api = await mockApi(page, { briefing: state, chat: { ledger: [{ id: KEPT, kind: 'memory', status: 'done', at: Date.now() }] } });
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
  await page.waitForSelector('#brief .tile.report');
  await page.waitForFunction(() => !document.querySelector('#brief').inert);
  await resting(page);
  const tiles = await page.$$eval('#brief .grid > .tile', (ts) => ts.map((t) => t.querySelector('.k').textContent));
  assert.deepEqual(tiles.slice(0, 2), ['Overnight', 'Waiting on you']);
  const head = page.locator('#brief .tile.report .ohead');
  const lines = page.locator('#brief .tile.report .rlines');
  assert.equal(await head.getAttribute('aria-expanded'), 'false');
  assert.equal(await lines.isVisible(), false);
  assert.match(await head.textContent(), /A quiet night, two things kept1 fact · 1 loose end/);
  await page.screenshot({ path: process.env.TH_SHOT_DIR ? `${process.env.TH_SHOT_DIR}/report-folded.png` : undefined });

  await head.click();
  assert.equal(await head.getAttribute('aria-expanded'), 'true');
  assert.equal(await lines.isVisible(), true);
  assert.deepEqual(await page.$$eval('#brief .tile.report li', (ls) => ls.map((l) => [l.className, l.textContent])), [
    ['rline', 'Kept that you like calm music in the eveningUndo'],
    ['rline', 'Music is ready for the evening'],
    ['rline undone', 'Closed the loose end about the invented boiler' + 'Undone'],
    ['rcut', 'Cut by the time limit: steps 5, 6'],
  ]);
  assert.equal(await page.locator('#brief .tile.report a.rt').getAttribute('href'), '/music/');
  // Every line and button is at least 44 px tall at phone size.
  for (const h of await page.$$eval('#brief .tile.report .rline', (ls) => ls.map((l) => l.getBoundingClientRect().height))) assert.ok(h >= 44, String(h));
  await page.screenshot({ path: process.env.TH_SHOT_DIR ? `${process.env.TH_SHOT_DIR}/report-open.png` : undefined });

  const reads = () => api.calls.filter((c) => c.call === 'GET /v1/briefing').length;
  const before = reads();
  await page.getByRole('button', { name: 'Undo: Kept that you like calm music in the evening' }).click();
  await until(() => api.calls.some((c) => c.call === `POST /v1/ledger/${KEPT}/undo`));
  await until(() => reads() > before);
  await page.waitForFunction(() => document.querySelector('#brief .tile.report .rline')?.classList.contains('undone'));
  assert.equal(await page.locator('#brief .tile.report .rline').first().textContent(), 'Kept that you like calm music in the eveningUndone');
  assert.equal(await head.getAttribute('aria-expanded'), 'true', 'still open after the redraw');

  await head.click();
  assert.equal(await head.getAttribute('aria-expanded'), 'false');
  assert.equal(await lines.isVisible(), false);
  await head.focus();
  await page.keyboard.press('Enter');
  assert.equal(await head.getAttribute('aria-expanded'), 'true');
  assert.deepEqual(errors, []);
  await context.close();
});

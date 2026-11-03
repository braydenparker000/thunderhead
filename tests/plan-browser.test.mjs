// A plan's line on home (API.md §11.11, MIND-PLAN §3.4), in Chromium against the mock Worker: today's
// plan shows as one line card, its ledger row's `what` with an Undo, drawn like the mind's other home
// lines (`data-ledger`); the Undo calls the ledger's undo for that row, says so, and the line goes.
// An undone plan, or one from before today, shows nothing. Synthetic data only.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { API, mockApi, TOKEN } from './fixtures/mock-api.mjs';

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

const PLAN = '0192f0c4-0000-7000-8000-0000000000d1';
const row = (id, what, at, status = 'done') => ({ seq: 1, id, at, actor: 'mind:chat', kind: 'plan', what, why: 'the owner asked to set up the evening', ref: `plan:${id}`, topic_key: null, undoable: true, status, tainted: false, proposal_id: null, permit: 'tell', undone_at: null });
const ledger = [
  row(PLAN, 'Set up your evening.', Date.now() - 60_000),
  row('0192f0c4-0000-7000-8000-0000000000d2', 'An undone plan.', Date.now() - 120_000, 'undone'),
  row('0192f0c4-0000-7000-8000-0000000000d3', 'A plan from before today.', new Date('2026-10-28T20:00').getTime()),
];

test('a plan shows one line with Undo, and Undo calls the ledger route for its row', opts, async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => { try { localStorage.setItem('th.p.sent', '1'); } catch {} });
  const api = await mockApi(page, { chat: { ledger } });
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
  await page.goto(`${base}/`, { waitUntil: 'load' });
  const card = page.locator(`#talk .note[data-ledger="${PLAN}"]`);
  await card.waitFor();
  assert.equal((await card.locator('.nt').textContent()).trim(), 'Set up your evening. Undo');
  assert.equal(await page.locator('#talk .note').count(), 1, 'the undone plan and yesterday’s show nothing');
  const asked = api.calls.find((c) => c.call.startsWith('GET /v1/ledger'));
  assert.ok(asked, 'home read the day’s plans');
  // The Undo: the ledger's undo for that row, then the line goes.
  await card.locator('button.nu').click();
  await page.waitForFunction((id) => !document.querySelector(`#talk .note[data-ledger="${id}"]`), PLAN);
  const undo = api.calls.filter((c) => c.call.startsWith('POST /v1/ledger/'));
  assert.deepEqual(undo.map((c) => c.call), [`POST /v1/ledger/${PLAN}/undo`]);
  assert.deepEqual(undo[0].body, {});
  await page.waitForFunction(() => /Undone\./.test(document.body.textContent ?? ''));
  assert.deepEqual(errors.filter((e) => !/frame|music/i.test(e)), []);
  await context.close();
});

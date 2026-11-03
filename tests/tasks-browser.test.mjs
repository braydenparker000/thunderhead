// "@muse" in the chat and the menu's Tasks, in Chromium at 390×844 against the mocked Worker
// (tests/fixtures/mock-api.mjs, mock-work.mjs): typed in the ask bar, the hint says what it will do
// and the message goes marked for Muse, answered by the Worker's line, with no working card; one past
// 500 characters stays in the bar. The Tasks group draws
// from the orders (hidden while there are none), its sheet shows Muse's progress lines, and Cancel
// cancels. Muse's done line is reply-style, plain words, with its Open chip. Every step waits on what
// the page shows or the mock saw, or on the page's own clock run forward. CSP violations are console errors, so
// each test also proves the page fits its CSP. Set SHOTS=<dir> to keep the screenshots.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { API, mockApi, TOKEN } from './fixtures/mock-api.mjs';
import { order } from './fixtures/mock-work.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (mocked API)' };
const SHOTS = process.env.SHOTS || '';
let server, browser, base;
before(async () => {
  if (live) return;
  server = await serve(0, { api: API });
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
});
after(async () => { await browser?.close(); server?.close(); });

const THREAD = '0192f0c4-0000-7000-8000-0000000000aa';
const owner = (id, body) => ({ seq: 1, id, thread_id: THREAD, author: 'owner', origin: 'owner_device', kind: 'text', body, meta: null, attachments: [], reply_to: null, created_at: Date.now() - 300_000, delivered_at: null, acked_at: null, answered_at: Date.now() - 290_000 });
const ASKED = "Asked Muse. I'll tell you when it lands.";

async function open({ theme = 'light', work = {}, clock = false, messages = [owner('0192f0c4-0000-7000-8000-0000000000m1', 'Good morning')] } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block', timezoneId: 'UTC' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript((t) => { try { localStorage.setItem('th-theme', t); } catch {} }, theme);
  const api = await mockApi(page, { chat: { messages, presence: { state: 'listening', note: null, since: Date.now() } }, work });
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
  // The page's own clock, run forward by the test where time must pass (never a real wait).
  if (clock) await page.clock.install();
  await page.goto(`${base}/`, { waitUntil: 'load' });
  await page.waitForSelector('#talk .you');
  await page.waitForFunction(() => document.querySelector('#cmdhint') !== null);
  return { page, context, errors, api };
}
async function eventually(read, want, message) {
  const end = Date.now() + 15_000;
  let got = await read();
  while (!isDeepStrictEqual(got, want) && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 20));
    got = await read();
  }
  assert.deepEqual(got, want, message);
}
const shot = async (page, name, theme) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-${theme === 'light' ? 'day' : 'night'}.png` }); };
const type = async (page, text) => { await page.fill('#q', text); await page.dispatchEvent('#q', 'input'); };
const puts = (api) => api.calls.filter((c) => c.call.startsWith('PUT /v1/messages/'));
const menu = async (page) => {
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('th:go', { detail: 'side' })));
  await page.waitForSelector('#side.open');
};
/** The Tasks group as [heading, count, rows as "title | state | age"], or null while hidden. */
const tasks = (page) => page.evaluate(() => {
  const g = document.querySelector('#convos section.cg[data-g="tasks"]');
  return g && [g.querySelector('.gl').textContent, g.querySelector('.gn').textContent,
    ...[...g.querySelectorAll('.row.task')].map((r) => ['.tl', '.l2', '.when'].map((s) => r.querySelector(s).textContent).join(' | '))];
});

test('"@muse …" says what it will do, goes marked for Muse and is answered by the Worker; no working card', opts, async () => {
  for (const theme of ['light', 'dark']) {
    const { page, context, errors, api } = await open({ theme, clock: true });
    await type(page, '@muse grab me three indie catalogs');
    await eventually(() => page.textContent('#cmdhint'), 'Asks Muse. It shows in the menu under Tasks.');
    await page.press('#q', 'Enter');
    await eventually(() => puts(api).length, 1);
    assert.deepEqual(puts(api)[0].body, { body: '@muse grab me three indie catalogs', mention: 'muse' });
    await page.waitForFunction((t) => [...document.querySelectorAll('#talk .sys')].some((n) => n.textContent === t), ASKED);
    assert.equal(await page.inputValue('#q'), '');
    // It waits on Muse, never the mind: past the 1.5 s a reply's working card takes, none shows.
    await page.clock.runFor(2500);
    assert.equal(await page.$('#working .work:not(.fold)'), null, 'no working card for Muse');
    await shot(page, 'muse-asked', theme);
    // Past 500 characters it stays in the bar, with the reason.
    await type(page, `@Muse, ${'x'.repeat(501)}`);
    await eventually(() => page.textContent('#cmdhint'), 'Too long for Muse: 500 characters at most.');
    await page.press('#q', 'Enter');
    await page.waitForFunction(() => document.querySelector('#toast')?.textContent.includes('Too long for Muse'));
    assert.equal(puts(api).length, 1, 'nothing more was sent');
    assert.notEqual(await page.inputValue('#q'), '');
    assert.deepEqual(errors, []);
    await context.close();
  }
});

test('the Tasks group lists the orders; its sheet shows the progress lines and cancels; none hides it', opts, async () => {
  const now = Date.now();
  const working = order({ title: 'grab me three indie catalogs', status: 'claimed', state: 'working', created_at: now - 12 * 60_000 });
  const done = order({ title: 'a tab for an old folk song', status: 'done', state: 'done', created_at: now - 3 * 3_600_000, result: { added: { files: 1 }, ids: [], note: 'One tab, saved in Guitar.' } });
  const failed = order({ title: 'the lost demo tapes', status: 'failed', state: 'failed', created_at: now - 5 * 3_600_000, heartbeat_note: 'Nothing matched those words' });
  const at = (h, m) => Date.UTC(2026, 10, 3, h, m);
  const notes = { [working.id]: [
    { seq: 1, id: crypto.randomUUID(), author: 'muse', body: 'Found three artists.', order_id: working.id, created_at: at(9, 41) },
    { seq: 2, id: crypto.randomUUID(), author: 'muse', body: 'Uploading the second catalog.', order_id: working.id, created_at: at(9, 47) },
  ] };
  for (const theme of ['light', 'dark']) {
    const { page, context, errors, api } = await open({ theme, work: { orders: [failed, done, { ...working }], notes } });
    await menu(page);
    await eventually(() => tasks(page), ['Tasks', '3',
      'grab me three indie catalogs | Working | 12 min',
      'a tab for an old folk song | Done | 3 h',
      'the lost demo tapes | Failed | 5 h']);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 0, 'no sideways scroll');
    await shot(page, 'tasks', theme);
    await page.click('#convos .row.task[data-state="working"]');
    await page.waitForSelector('.tasksheet .tasklog p');
    await eventually(() => page.$$eval('.tasksheet .tasklog p', (ps) => ps.map((p) => p.textContent)), ['09:41 · Found three artists.', '09:47 · Uploading the second catalog.']);
    assert.equal(await page.textContent('.tasksheet .sheet-title'), 'grab me three indie catalogs');
    assert.equal(await page.textContent('.tasksheet .taskstate'), 'Working · 12 min');
    await shot(page, 'task-sheet', theme);
    await page.click('.tasksheet button.danger');
    await eventually(() => api.calls.filter((c) => /^POST \/v1\/work\/orders\/[^/]+\/cancel$/.test(c.call)).map((c) => c.call.split('/')[4]), [working.id]);
    await page.waitForFunction(() => !document.querySelector('.tasksheet'));
    await eventually(() => page.evaluate(() => document.querySelector('#convos .row.task')?.querySelector('.l2').textContent), 'Cancelled');
    // A done task's sheet says what came of it and offers no Cancel.
    await page.click('#convos .row.task[data-state="done"]');
    await page.waitForSelector('.tasksheet .taskout');
    assert.equal(await page.textContent('.tasksheet .taskout'), 'One tab, saved in Guitar.');
    assert.equal(await page.$('.tasksheet button.danger'), null);
    assert.deepEqual(errors, []);
    await context.close();
  }
  // No orders: no group at all.
  const { page, context, errors, api } = await open();
  await menu(page);
  await eventually(() => api.calls.some((c) => c.call === 'GET /v1/work/orders'), true);
  await page.waitForSelector('#convos .row.all, #convos .cline');
  assert.equal(await tasks(page), null, 'the group hides while there are none');
  assert.deepEqual(errors, []);
  await context.close();
});

test("Muse's done line is reply-style, its words plain, with the Open chip; a new task shows in the menu as it is asked", opts, async () => {
  for (const theme of ['light', 'dark']) {
    const { page, context, errors, api } = await open({ theme });
    const chip = { label: 'Open in Music', app: 'music', path: '/music/' };
    api.chat.muse('Muse added 41 songs from 3 artists. **Three** catalogs.', { work: { id: 'x', state: 'done' }, chip });
    await page.waitForSelector('#talk .reply');
    assert.equal(await page.textContent('#talk .reply'), 'Muse added 41 songs from 3 artists. **Three** catalogs.');
    assert.equal(await page.$('#talk .reply strong'), null, "Muse's words are never Markdown");
    await page.waitForSelector('#talk .chip.in');
    assert.equal(await page.textContent('#talk .chip'), 'Open in Music');
    await shot(page, 'muse-done', theme);
    if (theme === 'dark') {
      await page.click('#talk .chip');
      await page.waitForFunction(() => /^\/music\/(\?th-frame=[0-9a-f]{32})?$/.test(document.querySelector('iframe.th-app')?.getAttribute('src') ?? ''));
    } else {
      // Asked while the menu is open: the `work` change brings the row.
      await menu(page);
      await page.waitForSelector('#convos .row.thr, #convos .row.all, #convos .cline');
      await page.evaluate(() => document.dispatchEvent(new CustomEvent('th:go', { detail: 'home' })));
      await page.waitForSelector('#side:not(.open)');
      await type(page, '@muse find subtitles for the film night');
      await page.press('#q', 'Enter');
      await menu(page);
      await eventually(async () => (await tasks(page))?.[2], 'find subtitles for the film night | Asked | now');
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
});

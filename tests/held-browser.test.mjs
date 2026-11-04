// Off the record and Delete on the phone, in Chromium at 390×844 against the mocked Worker
// (tests/fixtures/mock-held.mjs): the + sheet's sixth item starts a conversation off the record,
// whose quiet marker ("Off the record · gone in 7 days") and the bar's words show while home shows
// it; a message goes to it by id and the mind's answer appears in it; End or "back on the record"
// returns to today; "off the record" said as a phone command starts one too; nothing of it is
// cached. In the menu a held card offers Delete, whose sheet asks once in the agreed words; Now's
// card offers Delete alone and empties today; Settings › Recently deleted lists them with Restore.
// CSP violations are console errors, so each test also proves the page fits its CSP. Set
// SHOTS=<dir> to keep the screenshots (sheet, marker, delete sheet, now sheet, recently deleted, the
// menu's row and the past view), THEME=dark for the night theme's.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { API, mockApi, TOKEN } from './fixtures/mock-api.mjs';
import { outlast, resting } from './fixtures/waits.mjs';
import { T } from './fixtures/mock-threads.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (mocked API)' };
const SHOTS = process.env.SHOTS || '';
/** THEME=dark looks at the night theme (the screenshots are named the same). */
const THEME = process.env.THEME || 'light';
let server, browser, base;
before(async () => {
  if (live) return;
  server = await serve(0, { api: API });
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
});
after(async () => { await browser?.close(); server?.close(); });

const TODAY_ID = '0192f0c4-0000-7000-8000-0000000000aa';
const owner = (id, body) => ({ seq: 1, id, thread_id: TODAY_ID, author: 'owner', origin: 'owner_device', kind: 'text', body, meta: null, attachments: [], reply_to: null, created_at: Date.now() - 300_000, delivered_at: null, acked_at: null, answered_at: Date.now() - 200_000 });

async function open(chat = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block', timezoneId: 'UTC' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript((t) => { try { localStorage.setItem('th-theme', t); } catch {} }, THEME);
  const api = await mockApi(page, { chat: { messages: [owner('0192f0c4-0000-7000-8000-0000000000m1', 'Good morning, a calm start please')], ...chat } });
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
  await page.waitForSelector('#talk .you');
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
/** A screenshot once everything on the page has finished moving (only with SHOTS). */
const shot = async (page, name) => {
  if (!SHOTS) return;
  await resting(page);
  await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {}))));
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
};
const talk = (page) => page.$$eval('#talk .you, #talk .reply', (els) => els.map((e) => e.textContent.trim()));
const menu = async (page) => {
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('th:go', { detail: 'side' })));
  await page.waitForSelector('#convos .row.thr');
  await page.waitForFunction(() => !document.querySelector('#side').classList.contains('moving'));
  await resting(page);
};
/** Holds a card 600 ms (the hold is 450), on the page's own timers so the hold's runs first. */
async function hold(page, selector) {
  const box = await page.locator(selector).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await outlast(page, 600);
  await page.mouse.up();
  await page.waitForSelector('.holdsheet.in');
}

test('the + sheet starts one off the record: the marker and the bar say so, it is answered there, End returns', opts, async () => {
  const { page, context, errors, api } = await open({ reply: { after: 150, text: 'Kept between us.' } });
  await page.click('#plus');
  await page.waitForSelector('#opts.show');
  assert.equal(await page.textContent('#opts [data-act="otr"]'), 'Off the record');
  await shot(page, 'otr-sheet');
  await page.click('#opts [data-act="otr"]');
  await page.waitForSelector('#otr');
  assert.equal((await page.textContent('#otr')).replace('End', '').trim(), 'Off the record · gone in 7 days');
  assert.equal(await page.getAttribute('#q', 'placeholder'), 'Off the record');
  await eventually(() => talk(page), [], "today's conversation steps aside");
  const started = api.calls.find((c) => /^PUT \/v1\/threads\/[^/]+\/off-record$/.test(c.call));
  const id = started.call.split('/')[3];
  await page.fill('#q', 'a quiet thought for no one else');
  await page.press('#q', 'Enter');
  await eventually(() => talk(page), ['a quiet thought for no one else', 'Kept between us.']);
  const sent = api.calls.find((c) => c.call.startsWith('PUT /v1/messages/'));
  assert.equal(sent.body.thread_id, id, 'the message names the conversation off the record');
  await shot(page, 'otr-marker');
  // Nothing of it in this phone's cache.
  const cached = await page.evaluate(() => new Promise((resolve) => {
    const req = indexedDB.open('th-data');
    req.onsuccess = () => {
      const db = req.result;
      if (![...db.objectStoreNames].includes('kv')) return resolve('');
      const all = db.transaction('kv').objectStore('kv').getAll();
      all.onsuccess = () => resolve(JSON.stringify(all.result));
    };
    req.onerror = () => resolve('');
  }));
  assert.doesNotMatch(cached, /quiet thought|Kept between us/);
  await page.click('#otr button');
  await page.waitForSelector('#otr', { state: 'detached' });
  assert.equal(await page.getAttribute('#q', 'placeholder'), 'Ask anything');
  await eventually(() => talk(page), ['Good morning, a calm start please'], 'back to today');
  assert.deepEqual(errors, []);
  await context.close();
});

test('"off the record" said as a phone command starts one; "back on the record" ends it', opts, async () => {
  const { page, context, errors, api } = await open();
  await page.fill('#q', 'Off the record');
  await eventually(() => page.textContent('#cmdhint'), 'A conversation off the record: I answer, remember none of it, gone in 7 days.');
  await page.press('#q', 'Enter');
  await page.waitForSelector('#otr');
  assert.equal(api.calls.filter((c) => c.call.startsWith('PUT /v1/messages/')).length, 0, 'the order is not sent as words');
  await page.fill('#q', 'back on the record');
  await page.press('#q', 'Enter');
  await page.waitForSelector('#otr', { state: 'detached' });
  assert.equal(await page.evaluate(() => localStorage.getItem('th.p.otr')), null);
  assert.deepEqual(errors, []);
  await context.close();
});

test('a held card offers Delete; its sheet asks once in the agreed words; Undo restores it', opts, async () => {
  const { page, context, errors, api } = await open();
  await menu(page);
  await hold(page, `#convos .row.thr[data-id="${T.yesterday}"]`);
  assert.deepEqual(await page.$$eval('.holdsheet .csacts button', (b) => b.map((x) => x.textContent)), ['Continue this', 'Rename', 'Pin', 'Delete']);
  await page.click('.holdsheet .csacts .del');
  await page.waitForSelector('.csheet.on');
  assert.equal(await page.textContent('.csheet h2'), 'Delete this conversation?');
  assert.equal(await page.textContent('.csheet p'), 'It goes now; you can undo for 30 days in Settings › Recently deleted.');
  await shot(page, 'delete-sheet');
  await page.click('.csheet .btn.danger');
  await page.waitForSelector(`#convos .row.thr[data-id="${T.yesterday}"]`, { state: 'detached' });
  assert.ok(api.calls.some((c) => c.call === `DELETE /v1/threads/${T.yesterday}`));
  await page.click('#toast button');
  await page.waitForSelector(`#convos .row.thr[data-id="${T.yesterday}"]`);
  assert.ok(api.calls.some((c) => c.call === `POST /v1/threads/${T.yesterday}/restore`));
  assert.deepEqual(errors, []);
  await context.close();
});

test("Now's card held offers Delete alone; deleting today empties home for a fresh today", opts, async () => {
  const { page, context, errors } = await open();
  await menu(page);
  await hold(page, '#now');
  assert.deepEqual(await page.$$eval('.holdsheet .csacts button', (b) => b.map((x) => x.textContent)), ['Delete']);
  await shot(page, 'now-sheet');
  await page.click('.holdsheet .csacts .del');
  await page.waitForSelector('.csheet.on');
  await page.click('.csheet .btn.danger');
  await eventually(() => talk(page), [], 'today is empty');
  assert.deepEqual(errors, []);
  await context.close();
});

test('Settings › Recently deleted lists them with when they go; Restore brings one back', opts, async () => {
  const { page, context, errors, api } = await open();
  await page.evaluate(() => fetch('https://api.th.test/v1/threads/0192f0c4-0000-7000-8000-000000000101', { method: 'DELETE', headers: { Authorization: 'Bearer x' } }));
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('th:go', { detail: 'side' })));
  await page.click('#settings');
  await page.waitForSelector('.spage.in .slink[data-page="deleted"]');
  assert.equal(await page.textContent('.slink[data-page="deleted"] .t'), 'Recently deleted');
  await page.click('.slink[data-page="deleted"]');
  await page.waitForSelector('.sdel');
  assert.equal(await page.textContent('.sdel .t'), 'A calm playlist for the evening');
  assert.match((await page.textContent('.sdel small')).replace(/\u00a0/g, ' '), /^Deleted \d+ \w+ · gone in 30 days · 3 messages$/);
  await shot(page, 'recently-deleted');
  await page.click('.sdel .btn');
  await page.waitForSelector('.sdel', { state: 'detached' });
  assert.equal(await page.textContent('.spage.in .line'), 'Nothing deleted in the last 30 days.');
  assert.ok(api.calls.some((c) => c.call === `POST /v1/threads/${T.yesterday}/restore`));
  assert.deepEqual(errors, []);
  await context.close();
});

test('the menu tags one off the record and its past view says when it goes; the menu search never finds it', opts, async () => {
  const { page, context, errors } = await open({ reply: { after: 100, text: 'Understood.' } });
  await page.fill('#q', 'off the record');
  await page.press('#q', 'Enter');
  await page.waitForSelector('#otr');
  await page.fill('#q', 'the heron by the river');
  await page.press('#q', 'Enter');
  await eventually(() => talk(page), ['the heron by the river', 'Understood.']);
  await page.click('#otr button');
  await page.waitForSelector('#otr', { state: 'detached' });
  await menu(page);
  const row = '#convos .row.thr:has(.tag.otr)';
  await page.waitForSelector(row);
  assert.equal(await page.textContent(`${row} .tag`), 'Off the record');
  await shot(page, 'otr-menu');
  await page.click(row);
  await page.waitForSelector('.past .pmeta');
  assert.equal(await page.textContent('.past .ptl'), 'Off the record');
  assert.equal(await page.textContent('.past .pmeta'), '2 messages · gone in 7 days');
  await shot(page, 'otr-past');
  await page.click('.past button');
  await menu(page);
  await page.click('#search');
  // Off the record is never found: read once the Worker has answered this query.
  const answered = page.waitForResponse((r) => new URL(r.url()).pathname === '/v1/search' && new URL(r.url()).searchParams.get('q') === 'heron');
  await page.fill('#side input[type="search"]', 'heron');
  await answered;
  const found = await page.$$eval('#side .srow, #side [data-ref]', (r) => r.filter((x) => /heron/i.test(x.textContent)).length);
  assert.equal(found, 0);
  assert.deepEqual(errors, []);
  await context.close();
});

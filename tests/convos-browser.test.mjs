// The menu's Conversations and Search, and an older conversation on home, in Chromium at 390×844
// against the mocked Worker (tests/fixtures/mock-threads.mjs): the groups (Now, Yesterday, This
// week with an imported old chat marked, All conversations by month, 30 at a time), titles as text
// only, the read-only past view with Back to now (the pill, Back, Now, and sending), a long
// imported thread paging back, search (local first, the Worker's rows appended, accent-folded,
// "Show all N", a hit opening its thread highlighted, nothing found, offline), and the list's
// error and offline lines. CSP violations are console errors, so each test also proves the page
// fits its CSP. Set SHOTS=<dir> to keep the screenshots (day and night: menu, all, past, search).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { API, mockApi, TOKEN } from './fixtures/mock-api.mjs';
import { T } from './fixtures/mock-threads.mjs';

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

const TODAY_ID = '0192f0c4-0000-7000-8000-0000000000aa';
const owner = (id, body) => ({ seq: 1, id, thread_id: TODAY_ID, author: 'owner', origin: 'owner_device', kind: 'text', body, meta: null, attachments: [], reply_to: null, created_at: Date.now() - 300_000, delivered_at: null, acked_at: null, answered_at: null });

async function open({ theme = 'light' } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block', timezoneId: 'UTC' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript((t) => { try { localStorage.setItem('th-theme', t); } catch {} }, theme);
  const api = await mockApi(page, { chat: { messages: [owner('0192f0c4-0000-7000-8000-0000000000m1', 'Good morning, a calm start please')] } });
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
  const end = Date.now() + 5_000;
  let got = await read();
  while (!isDeepStrictEqual(got, want) && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 20));
    got = await read();
  }
  assert.deepEqual(got, want, message);
}
const shot = async (page, name, theme) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-${theme === 'light' ? 'day' : 'night'}.png` }); };
const menu = async (page) => {
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('th:go', { detail: 'side' })));
  await page.waitForSelector('#convos .row.thr');
  await page.waitForTimeout(450);
};
const menuOpen = (page) => page.$eval('#side', (s) => s.classList.contains('open'));
/** The Conversations section as [kind, text…] rows. */
const section = (page) => page.$$eval('#convos > *', (els) => els.map((e) => (e.classList.contains('grp') ? ['grp', e.textContent] : [e.classList.contains('all') ? 'all' : 'row', ...[...e.querySelectorAll('.tl, .src, small, .t')].filter((x) => !x.matches('.t') || !x.children.length).map((x) => x.textContent)])));
const partOfDay = (h) => (h >= 5 && h < 12 ? 'this morning' : h >= 12 && h < 18 ? 'this afternoon' : h >= 18 && h < 22 ? 'this evening' : 'tonight');
const hidden = (page, sel) => page.$eval(sel, (e) => getComputedStyle(e).display === 'none');

test('the menu groups conversations: Now, Yesterday, This week with an old chat marked, then All conversations by month', opts, async () => {
  for (const theme of ['light', 'dark']) {
    const { page, context, errors } = await open({ theme });
    await menu(page);
    assert.equal(await page.textContent('#now small'), partOfDay(new Date().getUTCHours()), 'Now carries its part of the day');
    assert.deepEqual(await section(page), [
      ['grp', 'Yesterday'],
      ['row', 'A calm playlist for the evening', '21:40'],
      ['grp', 'This week'],
      ['row', 'Bars 9 to 12, slow then up to tempo', 'from the old Chats', 'Tue'],
      ['row', 'Monday 26 October', 'Mon'],
      ['all', 'All conversations'],
    ]);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 0, 'no sideways scroll');
    await shot(page, 'menu', theme);
    // The full list: older than this week, by month, newest first, 30 at a time.
    await page.click('#convos .row.all');
    await page.waitForSelector('.allconvos .row.thr');
    const months = () => page.$$eval('.allconvos .grp', (g) => g.map((x) => x.textContent));
    const rows = () => page.$$eval('.allconvos .row.thr', (r) => r.length);
    await eventually(rows, 30);
    assert.deepEqual(await months(), ['September 2026', 'August 2026']);
    assert.deepEqual(await page.$$eval('.allconvos .row.thr', (r) => r.slice(0, 2).map((x) => [x.querySelector('.tl').textContent, x.querySelector('small').textContent])),
      [['Planning the garden beds', '19 Sep'], ['<img src=x onerror="document.title=1">Tags stay text', '2 Sep']]);
    assert.equal(await page.$('#app img'), null, 'a title is text, never markup');
    await shot(page, 'all', theme);
    await page.click('.allconvos .btn');
    await eventually(rows, 38);
    assert.deepEqual(await months(), ['September 2026', 'August 2026', 'July 2026', 'December 2025']);
    assert.equal(await page.$eval('.allconvos .row.thr:last-of-type .src', (s) => s.textContent), 'from the old Chats');
    assert.ok(await page.$eval('.allconvos .btn', (b) => b.hidden), 'nothing more to show');
    assert.equal(await page.title(), 'Thunderhead');
    // A row there opens the thread on home.
    await page.click(`.allconvos [data-id="${T.september}"]`);
    await page.waitForSelector('#home.pastview #past .you');
    assert.equal(await page.textContent('.past span'), 'Planning the garden beds · 19 Sep');
    await page.waitForFunction(() => !document.querySelector('.allconvos'));
    assert.deepEqual(errors, []);
    await context.close();
  }
});

test('an older conversation shows read-only with Back to now; Back, the pill, Now and sending each return to today', opts, async () => {
  for (const theme of ['light', 'dark']) {
    const { page, context, errors, api } = await open({ theme });
    const openYesterday = async () => {
      await menu(page);
      await page.click(`#convos [data-id="${T.yesterday}"]`);
      await page.waitForSelector('#home.pastview #past .reply');
      await eventually(() => menuOpen(page), false, 'the menu closes');
    };
    await openYesterday();
    assert.equal(await page.textContent('.past span'), 'A calm playlist for the evening · Yesterday');
    assert.deepEqual(await page.$$eval('#past .you, #past .reply, #past .sys', (n) => n.map((x) => x.textContent)),
      ['Put on something calm for the evening', 'It is in Music, under Evening.', 'Yesterday is filed in the menu.']);
    assert.equal(await page.$eval('#past .reply', (r) => getComputedStyle(r).fontStyle), 'italic');
    for (const sel of ['#say', '#talk']) assert.ok(await hidden(page, sel), `${sel} steps aside`);
    assert.equal(await page.$('#past button.retry, #past .chip'), null, 'nothing to act on');
    await page.waitForTimeout(300);
    await shot(page, 'past', theme);
    // Back
    await page.goBack();
    await page.waitForFunction(() => !document.querySelector('#home.pastview'));
    assert.equal(await page.$('#past'), null);
    assert.equal(await hidden(page, '#talk'), false);
    // The pill's button
    await openYesterday();
    await page.click('.past button');
    await page.waitForFunction(() => !document.querySelector('#home.pastview'));
    // Now, in the menu: back to today and the menu closes; tapped again it says it is already here.
    await openYesterday();
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('th:go', { detail: 'side' })));
    await page.waitForTimeout(450);
    await page.click('#now');
    await page.waitForFunction(() => !document.querySelector('#home.pastview'));
    await eventually(() => menuOpen(page), false);
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('th:go', { detail: 'side' })));
    await page.waitForTimeout(450);
    await page.click('#now');
    await eventually(() => page.textContent('#toast'), 'This is the current conversation');
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('th:go', { detail: 'home' })));
    await page.waitForTimeout(450);
    // Sending returns to now first, then sends.
    await openYesterday();
    await page.fill('#q', 'Back to today then');
    await page.press('#q', 'Enter');
    await page.waitForFunction(() => !document.querySelector('#home.pastview'));
    await eventually(() => api.calls.filter((c) => c.call.startsWith('PUT /v1/messages/')).map((c) => c.body.body), ['Back to today then']);
    await page.waitForFunction(() => [...document.querySelectorAll('#talk .you')].some((y) => y.textContent === 'Back to today then'));
    assert.deepEqual(errors, []);
    await context.close();
  }
});

test('a long imported old chat shows its newest 200, then earlier ones above', opts, async () => {
  const { page, context, errors, api } = await open();
  await menu(page);
  await page.click(`#convos [data-id="${T.imported}"]`);
  await page.waitForSelector('#past .earlier');
  assert.equal(await page.textContent('.past span'), 'Bars 9 to 12, slow then up to tempo · Tuesday');
  const count = () => page.$$eval('#past [data-id]', (n) => n.length);
  assert.equal(await count(), 200);
  assert.ok(await page.$eval('#convo', (c) => c.scrollHeight - c.scrollTop - c.clientHeight < 4), 'scrolled to the bottom');
  await page.click('#past .earlier');
  await eventually(count, 230);
  assert.equal(await page.$('#past .earlier'), null);
  assert.equal(await page.textContent('#past [data-id] .you, #past .you'), 'Can you find the canción from the evening walk?');
  assert.ok(api.calls.some((c) => c.call === `GET /v1/threads/${T.imported}/messages` && /before_seq=/.test(c.query)));
  assert.deepEqual(errors, []);
  await context.close();
});

test('search: this phone first, the Worker appended, accent-folded, Show all, a hit opening its thread highlighted', opts, async () => {
  for (const theme of ['light', 'dark']) {
    const { page, context, errors, api } = await open({ theme });
    await menu(page);
    await page.click('#search');
    await page.waitForSelector('.sbox input');
    assert.ok(await page.$eval('.sbox input', (i) => i === document.activeElement), 'the field has focus');
    assert.ok(await hidden(page, '#convos'), 'the rest of the panel steps aside');
    const groups = () => page.$$eval('.sres .grp', (g) => g.map((x) => x.textContent));
    const rows = (g) => page.$$eval('.sres > *', (els, g) => {
      const out = [];
      let cur = null;
      for (const e of els) if (e.classList.contains('grp')) cur = e.textContent; else if (cur === g && e.matches('.srow')) out.push([...e.querySelectorAll('.tl, .sn, .src')].map((x) => x.textContent).join(' | '));
      return out;
    }, g);
    // One character shows nothing.
    await page.fill('.sbox input', 'c');
    await page.waitForTimeout(300);
    assert.deepEqual(await page.$$eval('.sres > *', (e) => e.length), 0);
    // Local rows at once, then the Worker's appended after them: the title hit stays first.
    await page.fill('.sbox input', 'calm');
    await eventually(groups, ['Conversations', 'What I remember']);
    await eventually(async () => (await rows('Conversations')).length, 3);
    assert.deepEqual(await rows('Conversations'), [
      'A calm playlist for the evening · 28 Oct',
      'Now | Good morning, a calm start please',
      'A calm playlist for the evening · 28 Oct | Put on something calm for the evening',
    ]);
    await eventually(() => rows('What I remember'), ['Likes calm music in the evening | You said']);
    assert.equal(await page.$eval('.sres .srow .sn b', (b) => b.textContent), 'calm');
    await shot(page, 'search', theme);
    // Go to: app and settings names.
    await page.fill('.sbox input', 'devi');
    await eventually(() => rows('Go to'), ['Devices']);
    // Show all N.
    await page.fill('.sbox input', 'number');
    await eventually(() => page.$$eval('.sres .showall', (b) => b.map((x) => x.textContent)), ['Show all 50']);
    assert.equal((await rows('Conversations')).length, 5);
    await page.click('.sres .showall');
    assert.equal((await rows('Conversations')).length, 50);
    // Accent-folded: the same hits either way; the hit opens its old chat on home, highlighted.
    await page.fill('.sbox input', 'canción');
    await eventually(async () => (await rows('Conversations')).length, 1);
    const folded = await rows('Conversations');
    await page.fill('.sbox input', 'cancion');
    await page.waitForTimeout(400);
    await eventually(() => rows('Conversations'), folded);
    assert.deepEqual(folded, ['Bars 9 to 12, slow then up to tempo · 27 Oct | Can you find the canción from the evening walk?']);
    await page.click('.sres .srow');
    await page.waitForSelector('#home.pastview #past .hit');
    assert.equal(await page.textContent('#past .hit'), 'Can you find the canción from the evening walk?');
    await eventually(() => menuOpen(page), false);
    assert.equal(await page.$eval('#search', (s) => s.hidden), false, 'search mode is over');
    await page.waitForFunction(() => !document.querySelector('#past .hit'), null, { timeout: 4000 });
    assert.ok(api.calls.some((c) => c.call === '/v1/search' || c.call === 'GET /v1/search'));
    assert.deepEqual(errors, []);
    await context.close();
  }
});

test('search: nothing found offers to ask instead; Escape leaves; offline searches this phone only', opts, async () => {
  const { page, context, errors } = await open();
  await menu(page);
  await page.click('#search');
  await page.fill('.sbox input', 'zzzz');
  await page.waitForSelector('.sres .askme');
  assert.equal(await page.textContent('.sres .cline'), 'Nothing found for “zzzz”.');
  await page.click('.sres .askme');
  await eventually(() => menuOpen(page), false);
  assert.equal(await page.inputValue('#q'), 'zzzz');
  await page.fill('#q', '');
  await menu(page);
  await page.click('#search');
  await page.press('.sbox input', 'Escape');
  await page.waitForFunction(() => !document.querySelector('.sbox'));
  assert.equal(await hidden(page, '#convos'), false);
  await context.setOffline(true);
  await page.evaluate(() => dispatchEvent(new Event('offline')));
  await page.click('#search');
  await page.fill('.sbox input', 'garden');
  await eventually(() => page.$$eval('.sres > *', (e) => e.map((x) => x.textContent)), ['Offline: searching this phone only.', 'Conversations', 'Planning the garden beds · 19 Sep']);
  assert.deepEqual(errors.filter((e) => !/ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(e)), []);
  await context.close();
});

test('the list and a thread say when they cannot load, and Retry or reopening loads them', opts, async () => {
  const { page, context, errors, api } = await open();
  api.state.chat.fail['/v1/threads'] = 1;
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('th:go', { detail: 'side' })));
  await page.waitForSelector('#convos .cline');
  assert.match(await page.textContent('#convos .cline'), /^Couldn't load your conversations\./);
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('th:go', { detail: 'home' })));
  await page.waitForTimeout(450);
  await menu(page);
  assert.equal(await page.$('#convos .cline'), null);
  // Offline: the list this phone has, and a thread that waits with Retry.
  await context.setOffline(true);
  await page.evaluate(() => { dispatchEvent(new Event('offline')); document.dispatchEvent(new CustomEvent('th:changed', { detail: ['thread'] })); });
  await eventually(() => page.textContent('#convos .cline'), 'Offline: showing what this phone has.');
  await page.click(`#convos [data-id="${T.monday}"]`);
  await page.waitForSelector('#past .retry');
  assert.match(await page.textContent('#past .sys'), /^You're offline\. This conversation shows once you're back\./);
  assert.equal(await page.textContent('.past span'), 'Monday 26 October · Monday');
  await context.setOffline(false);
  await page.evaluate(() => dispatchEvent(new Event('online')));
  await page.click('#past .retry');
  await page.waitForSelector('#past .reply');
  assert.equal(await page.textContent('#past .reply'), 'You were at 84. Try 88 next.');
  assert.deepEqual(errors.filter((e) => !/ERR_INTERNET_DISCONNECTED|Failed to load resource|503/.test(e)), []);
  await context.close();
});

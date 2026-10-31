// The menu's Conversations and Search, and an older conversation on home, in Chromium at 390×844
// against the mocked Worker (tests/fixtures/mock-threads.mjs): the groups (Now's card, Yesterday,
// Earlier this week with an imported old chat tagged, Last week; each folding and remembered, All
// conversations by month, 30 at a time), titles as text only, the read-only past view with Back to
// now (the card, Back, Now, and sending), a Markdown reply read as text, a long imported thread
// paging back, search (local first, the Worker's rows appended, accent-folded,
// "Show all N", a hit opening its thread highlighted, nothing found, offline), and the list's
// error and offline lines. CSP violations are console errors, so each test also proves the page
// fits its CSP. Set SHOTS=<dir> to keep the screenshots (day and night: menu, folded, all, past,
// prose, search).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { API, mockApi, TOKEN } from './fixtures/mock-api.mjs';
import { PLAN, T } from './fixtures/mock-threads.mjs';

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
/** A row as "title | date | tag | second line". */
const rowText = (r) => [...r.querySelectorAll('.tl, .when, .tag, .sum, .row.all .l2')].map((x) => x.textContent).join(' | ');
/** The Conversations section: each group as [name, count, rows…], then the All row. */
const section = (page) => page.$$eval('#convos > *', (els, f) => {
  const text = new Function(`return ${f}`)();
  return els.map((e) => (e.matches('section.cg') ? [e.querySelector('.gl').textContent, e.querySelector('.gn').textContent, ...[...e.querySelectorAll('.row')].map(text)] : [e.matches('.all') ? 'all' : 'row', text(e)]));
}, rowText.toString());
const pastMeta = (page) => page.$eval('.pmeta', (e) => e.lastChild.textContent);
const partOfDay = (h) => (h >= 5 && h < 12 ? 'this morning' : h >= 12 && h < 18 ? 'this afternoon' : h >= 18 && h < 22 ? 'this evening' : 'tonight');
const hidden = (page, sel) => page.$eval(sel, (e) => getComputedStyle(e).display === 'none');

test('the menu groups conversations by the calendar: Now, Yesterday, Earlier this week, Last week, then All conversations by month', opts, async () => {
  for (const theme of ['light', 'dark']) {
    const { page, context, errors } = await open({ theme });
    await page.evaluate(() => localStorage.removeItem('th.convos.closed'));
    await menu(page);
    assert.equal(await page.textContent('#now small'), partOfDay(new Date().getUTCHours()), 'Now carries its part of the day');
    assert.match(await page.textContent('#now .sub'), /^Thursday 29 October( · \d+ messages?)?$/, "Now's card says which day it is");
    // The mock's today is Thursday 29 October: its week began on Monday 26, so Saturday 24 is last week.
    assert.deepEqual(await section(page), [
      ['Yesterday', '1', 'A calm playlist for the evening | 21:40 | 3 messages'],
      ['Earlier this week', '2', 'Bars 9 to 12, slow then up to tempo | Tue 27 | Old Chats | 230 messages', 'Monday 26 October | Mon 26 | 2 messages'],
      ['Last week', '1', 'Weekend practice plan | Sat 24 | Scales first, then bars 9 to 12 at 84.'],
      ['all', 'All conversations | By month, newest first'],
    ]);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 0, 'no sideways scroll');
    assert.ok(await page.$eval('#side', (s) => s.scrollWidth <= s.clientWidth), 'the menu does not scroll sideways');
    await shot(page, 'menu', theme);
    // A heading folds its rows away (they leave the tab order), says so, and stays folded on reload.
    const week = 'section.cg[data-g="week"]';
    await page.click(`${week} .ghead`);
    assert.equal(await page.getAttribute(`${week} .ghead`, 'aria-expanded'), 'false');
    await page.waitForFunction((w) => getComputedStyle(document.querySelector(`${w} .gin`)).visibility === 'hidden' && document.querySelector(`${w} .gbody`).getBoundingClientRect().height < 1, week);
    await shot(page, 'folded', theme);
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('#talk .you');
    await menu(page);
    assert.equal(await page.getAttribute(`${week} .ghead`, 'aria-expanded'), 'false', 'folded stays folded');
    assert.equal(await page.getAttribute('section.cg[data-g="last"] .ghead', 'aria-expanded'), 'true');
    await page.click(`${week} .ghead`);
    await page.waitForFunction((w) => document.querySelector(`${w} .gbody`).getBoundingClientRect().height > 100, week);
    assert.equal(await page.getAttribute(`${week} .ghead`, 'aria-expanded'), 'true');
    // The full list: every conversation but Now, by month, newest first, 30 at a time.
    await page.click('#convos .row.all');
    await page.waitForSelector('.allconvos .row.thr');
    const months = () => page.$$eval('.allconvos .gl', (g) => g.map((x) => x.textContent));
    const rows = () => page.$$eval('.allconvos .row.thr', (r) => r.length);
    await eventually(rows, 30);
    assert.deepEqual(await months(), ['October', 'September', 'August']);
    assert.deepEqual(await page.$$eval('.allconvos [data-g="m:2026-09"] .row.thr', (r) => r.map((x) => [x.querySelector('.tl').textContent, x.querySelector('.when').textContent])),
      [['Planning the garden beds', 'Sat 19'], ['<img src=x onerror="document.title=1">Tags stay text', 'Wed 2']]);
    assert.equal(await page.$('#app img'), null, 'a title is text, never markup');
    await page.waitForTimeout(400);
    await shot(page, 'all', theme);
    await page.click('.allconvos .btn');
    await eventually(rows, 42);
    assert.deepEqual(await months(), ['October', 'September', 'August', 'July', 'December 2025']);
    assert.equal(await page.textContent('.allconvos .alllead'), '42 conversations, newest first.');
    assert.equal(await page.$$eval('.allconvos .row.thr', (r) => r.at(-1).querySelector('.tag')?.textContent), 'Old Chats');
    assert.ok(await page.$eval('.allconvos .btn', (b) => b.hidden), 'nothing more to show');
    assert.equal(await page.title(), 'Thunderhead');
    // A month folds there too.
    await page.click('.allconvos [data-g="m:2026-08"] .ghead');
    assert.equal(await page.getAttribute('.allconvos [data-g="m:2026-08"] .ghead', 'aria-expanded'), 'false');
    // A row there opens the thread on home.
    await page.click(`.allconvos [data-id="${T.september}"]`);
    await page.waitForSelector('#home.pastview #past .you');
    assert.equal(await page.textContent('.past .ptl'), 'Planning the garden beds');
    assert.equal(await pastMeta(page), 'Saturday 19 September · 1 message');
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
    assert.equal(await page.textContent('.past .ptl'), 'A calm playlist for the evening');
    assert.equal(await pastMeta(page), 'Yesterday · 3 messages');
    assert.deepEqual(await page.$$eval('#past .you, #past .reply, #past .sys', (n) => n.map((x) => x.textContent)),
      ['Put on something calm for the evening', 'It is in Music, under Evening.', 'Yesterday is filed in the menu.']);
    assert.equal(await page.$eval('#past .reply', (r) => getComputedStyle(r).fontStyle), 'normal', 'read as home reads it');
    for (const sel of ['#talk']) assert.ok(await hidden(page, sel), `${sel} steps aside`);
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

test('a Markdown reply reads as rich text in the voice: a heading, lists, bold, code, a table and a link, tags kept as text', opts, async () => {
  for (const theme of ['light', 'dark']) {
    const { page, context, errors } = await open({ theme });
    await menu(page);
    await page.click(`#convos [data-id="${T.saturday}"]`);
    await page.waitForSelector('#past .reply h3');
    const p = '#past .reply:has(h3)';
    assert.deepEqual(await page.$eval(p, (r) => [getComputedStyle(r).fontStyle, getComputedStyle(r).fontFamily.split(',')[0]]), ['normal', 'Quicksand']);
    assert.equal(await page.textContent(`${p} h3`), 'Practice plan for the weekend');
    assert.deepEqual(await page.$$eval(`${p} ul > li`, (l) => l.map((x) => x.textContent)), ['Scales first, ten minutes', 'Bars 9 to 12 at 84 bpm, then up']);
    assert.equal(await page.textContent(`${p} li b`), 'Scales');
    assert.equal(await page.textContent(`${p} li code`), '84 bpm');
    assert.deepEqual(await page.$$eval(`${p} tr`, (r) => r.map((x) => [...x.children].map((c) => `${c.tagName}:${c.textContent}`).join(' '))), ['TH:Day TH:Minutes', 'TD:Mon TD:30', 'TD:Wed TD:45']);
    assert.deepEqual(await page.$eval(`${p} a`, (a) => [a.getAttribute('href'), a.textContent, a.rel]), ['https://example.com/metronome', 'example.com/metronome', 'noopener noreferrer']);
    assert.equal(await page.$('#app img'), null, 'a tag in a reply is text');
    assert.ok((await page.textContent(p)).includes('<img src=x onerror="document.title=1">'));
    assert.equal(PLAN.split('\n')[0], '## Practice plan for the weekend');
    assert.ok(await page.$eval('#convo', (c) => c.scrollWidth <= c.clientWidth), 'nothing scrolls sideways');
    await page.waitForTimeout(300);
    await shot(page, 'prose', theme);
    assert.deepEqual(errors, []);
    await context.close();
  }
});

test('a long imported old chat shows its newest 200, then earlier ones above', opts, async () => {
  const { page, context, errors, api } = await open();
  await menu(page);
  await page.click(`#convos [data-id="${T.imported}"]`);
  await page.waitForSelector('#past .earlier');
  assert.equal(await page.textContent('.past .ptl'), 'Bars 9 to 12, slow then up to tempo');
  assert.equal(await page.textContent('.past .tag'), 'Old Chats');
  assert.equal(await pastMeta(page), 'Tuesday 27 October · 230 messages');
  assert.equal(await page.$$eval('#past .reply', (r) => r.every((x) => getComputedStyle(x).fontStyle === 'normal')), true, 'an old chat reads upright, as every reply does');
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
    await eventually(() => rows('Go to'), ['Sign-in & devices']);
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
  assert.equal(await page.textContent('.past .ptl'), 'Monday 26 October');
  assert.equal(await pastMeta(page), '2 messages', 'the day is the title already');
  await context.setOffline(false);
  await page.evaluate(() => dispatchEvent(new Event('online')));
  await page.click('#past .retry');
  await page.waitForSelector('#past .reply');
  assert.equal(await page.textContent('#past .reply'), 'You were at 84. Try 88 next.');
  assert.deepEqual(errors.filter((e) => !/ERR_INTERNET_DISCONNECTED|Failed to load resource|503/.test(e)), []);
  await context.close();
});

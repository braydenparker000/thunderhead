// Home's decision card in Chromium at 390×844 against the mocked Worker (HOME.md §3, §2.1 rows 4–8,
// §3.5; SECURITY.md §4.3): one card under the voice line with the gold edge; "1 of 2"; Yes sends the
// card's spec hash, folds, and the next card rises; "Not yet" and "No"; a card held for quiet hours
// stays away; a failed decision says so and can be tried again; offline sends nothing; a tap right
// after the page comes back into view is ignored; the date line's "· 1 waiting" when the card is out
// of view. CSP violations are console errors, so each test also proves the page fits its CSP.
// Set SHOTS=<dir> to keep screenshots of the card (day and night).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { API, mockApi, TOKEN } from './fixtures/mock-api.mjs';
import { proposal } from './fixtures/mock-proposals.mjs';

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

async function open({ theme = 'light', proposals = [], chat = {} } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript((t) => { try { localStorage.setItem('th-theme', t); localStorage.setItem('th.p.sent', '1'); } catch {} }, theme);
  const api = await mockApi(page, { proposals, chat });
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
  errors.length = 0; // the 404 page used to reach the origin
  await page.goto(`${base}/`, { waitUntil: 'load' });
  await page.waitForSelector('#talk', { state: 'attached' });
  // Taps in the first 500 ms after the page appears are ignored on purpose (SECURITY.md §4.3).
  await page.waitForTimeout(600);
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
const say = (page) => page.$$eval('#say .ln', (ls) => ls.map((l) => l.textContent));
const card = (page) =>
  page.$$eval('#decision .card:not(.gone)', (cs) =>
    cs.map((c) => ({
      why: c.querySelector('.why')?.textContent,
      q: c.querySelector('.q')?.textContent,
      buttons: [...c.querySelectorAll('.decide button')].map((b) => b.textContent),
    })),
  );
const gold = (page) => page.$eval('#edge', (e) => e.classList.contains('gold'));
const decided = (api) => api.proposals.state.decided.map(({ id, decision, spec_hash }) => ({ id, decision, spec_hash }));

test('one card under the voice line, with the gold edge; Yes folds it and the next rises', opts, async () => {
  for (const theme of ['light', 'dark']) {
    const a = proposal({ expires_at: Date.now() + 3_600_000, odds: 0.9 });
    const b = proposal({ created_by: 'mind:chat', class: 'access', question: 'Revoke the old night key?', options: ['Revoke it', 'Not yet'], safe: 'snooze' });
    const { page, context, errors, api } = await open({ theme, proposals: [a, b] });
    await eventually(() => card(page), [{ why: "Night shift · Can't be undone1 of 2", q: a.question, buttons: ['Delete', 'Keep them'] }]);
    assert.equal(await gold(page), true);
    await eventually(() => say(page), ['Two things need you.', 'The rest is handled.']);
    // The card sits right under the voice line, above the conversation.
    assert.equal(await page.$eval('#say', (s) => s.nextElementSibling?.id), 'decision');
    const details = await page.$$eval('#decision .dx', (ds) => ds.map((d) => d.textContent));
    assert.deepEqual(details, [a.why, 'About 90% sure.', a.if_ignored]);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/decision-${theme === 'light' ? 'day' : 'night'}.png` });
    await page.click('#decision .yes');
    await eventually(() => decided(api), [{ id: a.id, decision: 'approve', spec_hash: a.spec_hash }]);
    await eventually(() => card(page), [{ why: 'From our chat · Changes access', q: b.question, buttons: ['Revoke it', 'Not yet'] }]);
    await eventually(() => say(page), ['One thing needs you.', 'The rest is handled.']);
    // "Not yet" puts the last one off: no card, no gold, and the voice line says so.
    await page.click('#decision .decide button:not(.yes)');
    await eventually(() => decided(api).at(-1), { id: b.id, decision: 'snooze', spec_hash: b.spec_hash });
    await eventually(() => card(page), []);
    await eventually(() => gold(page), false);
    await eventually(() => say(page), ['Nothing needs you now.']);
    assert.deepEqual(errors, [], `${theme}: ${errors.join('; ')}`);
    await context.close();
  }
});

test('a card held for quiet hours stays away; one that arrives while open rises', opts, async () => {
  const held = proposal({ show_from: Date.now() + 3_600_000 });
  const { page, context, errors, api } = await open({ proposals: [held] });
  assert.deepEqual(await card(page), []);
  assert.equal(await gold(page), false);
  assert.deepEqual(await say(page), ['Nothing needs you.']);
  const now = proposal({ question: 'Forget this fact for good?', options: ['Forget it', 'Keep it'] });
  api.proposals.add(now);
  await eventually(async () => (await card(page)).map((c) => c.q), ['Forget this fact for good?']);
  await page.click('#decision .decide button:not(.yes)');
  await eventually(() => decided(api), [{ id: now.id, decision: 'reject', spec_hash: now.spec_hash }]);
  await eventually(() => say(page), ['Nothing needs you now.']);
  assert.deepEqual(errors, []);
  await context.close();
});

test('a failed decision says so and can be tried again; offline nothing is sent', opts, async () => {
  const p = proposal();
  const { page, context, errors, api } = await open({ proposals: [p] });
  await page.waitForSelector('#decision .card');
  api.proposals.state.failDecide = 1;
  await page.click('#decision .yes');
  await page.waitForSelector('#decision .err:not([hidden])');
  assert.equal(await page.textContent('#decision .err'), "Didn't go through. Try again.");
  assert.equal(await page.$eval('#decision .yes', (b) => b.disabled), false);
  await context.setOffline(true);
  await page.click('#decision .yes');
  await eventually(() => page.textContent('.toast'), 'Needs a connection. Nothing was decided.');
  assert.equal(api.proposals.state.decided.length, 1, 'nothing sent offline');
  await context.setOffline(false);
  await page.click('#decision .yes');
  await eventually(() => api.proposals.state.decided.length, 2);
  await eventually(() => card(page), []);
  // The failed request and the offline one are console errors by design; nothing else is.
  assert.deepEqual(errors.filter((e) => !/503|ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(e)), []);
  await context.close();
});

test('a tap right after the page comes back into view is ignored', opts, async () => {
  const p = proposal();
  const { page, context, api } = await open({ proposals: [p] });
  await page.waitForSelector('#decision .card');
  // Once the card has risen, the page "comes back" and the tap lands at once (no waiting for
  // the card to settle, which would take longer than the 500 ms window).
  await page.$eval('#decision .card', (c) => Promise.all(c.getAnimations().map((a) => a.finished)));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.click('#decision .yes', { force: true });
  await page.waitForTimeout(150);
  assert.equal(api.proposals.state.decided.length, 0);
  await page.waitForTimeout(500);
  await page.click('#decision .yes');
  await eventually(() => api.proposals.state.decided.length, 1);
  await context.close();
});

test('the date line says "· 1 waiting" while the card is out of view, and a tap brings it back', opts, async () => {
  const thread = '0192f0c4-0000-7000-8000-0000000000aa';
  const messages = Array.from({ length: 30 }, (_, i) => ({
    seq: i + 1, id: `0192f0c4-0000-7000-8000-${String(900 + i).padStart(12, '0')}`, thread_id: thread,
    author: i % 2 ? 'mind' : 'owner', origin: i % 2 ? 'mind' : 'owner_device', kind: 'text', body: `Line ${i} of a long day.`,
    meta: null, attachments: [], reply_to: null, created_at: Date.now() - (60 - i) * 60_000, delivered_at: null, acked_at: null, answered_at: Date.now(),
  }));
  const { page, context, errors } = await open({ proposals: [proposal()], chat: { messages } });
  await page.waitForSelector('#decision .card');
  await page.$eval('#convo', (c) => { c.scrollTop = c.scrollHeight; });
  await page.waitForSelector('#waiting:not([hidden])');
  assert.equal(await page.textContent('#waiting'), '· 1 waiting');
  await page.click('#waiting');
  await page.waitForSelector('#waiting[hidden]', { state: 'attached' });
  assert.deepEqual(errors, []);
  await context.close();
});

// Home's conversation in Chromium at 390×844 against the mocked Worker and its live socket
// (tests/fixtures/mock-api.mjs): first run, a reply over the socket with its chip, waking, the
// mind not waking, the offline outbox, Stop, a verb run on this phone, a home line and the
// generic card. CSP violations are console errors, so each test also proves the page fits its CSP.
// Set SHOTS=<dir> to keep the screenshots (day and night: empty, conversation, waking, not waking).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { API, mockApi, TOKEN } from './fixtures/mock-api.mjs';

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

const NOT_WAKING = "The mind isn't waking (likely a usage limit or an outage). I'll answer when it's back.";
const owner = (id, body, extra = {}) => ({ seq: 1, id, thread_id: '0192f0c4-0000-7000-8000-0000000000aa', author: 'owner', origin: 'owner_device', kind: 'text', body, meta: null, attachments: [], reply_to: null, created_at: Date.now() - 300_000, delivered_at: null, acked_at: null, answered_at: null, ...extra });

async function open({ theme = 'light', chat = {}, clock = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript((t) => { try { localStorage.setItem('th-theme', t); } catch {} }, theme);
  const api = await mockApi(page, { chat });
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
  if (clock) await page.clock.install();
  await page.goto(`${base}/`, { waitUntil: 'load' });
  if (clock) await page.clock.runFor(300);
  await page.waitForSelector('#talk', { state: 'attached' });
  await page.waitForTimeout(300);
  return { page, context, errors, api };
}
const say = (page) => page.$$eval('#say .ln', (ls) => ls.map((l) => l.textContent));
const shot = async (page, name, theme) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-${theme === 'light' ? 'day' : 'night'}.png` }); };
const send = async (page, text) => { await page.fill('#q', text); await page.press('#q', 'Enter'); };

test('first run: the voice line welcomes; nothing else on the page', opts, async () => {
  for (const theme of ['light', 'dark']) {
    const { page, context, errors } = await open({ theme });
    assert.deepEqual(await say(page), ["I'm here.", 'Ask me anything, any time.']);
    assert.equal(await page.$$eval('#talk .turn', (t) => t.length), 0);
    await page.waitForTimeout(900);
    await shot(page, 'empty', theme);
    assert.deepEqual(errors, []);
    await context.close();
  }
});

test('a message goes out at once; the reply arrives over the socket, reveals, and its chip opens the app', opts, async () => {
  for (const theme of ['light', 'dark']) {
    const reply = { after: 400, text: 'It is in Music, under Evening. – first track\n– then the rest', meta: { chip: { label: 'Open in Music', app: 'music', path: '/music/' } } };
    const { page, context, errors, api } = await open({ theme, chat: { reply, presence: { state: 'listening', note: null, since: Date.now() } } });
    await send(page, 'Put on something calm for the evening');
    await page.waitForSelector('#talk .you');
    assert.equal(await page.inputValue('#q'), '');
    await page.waitForSelector('#talk .reply');
    assert.equal(await page.$eval('#talk .reply', (r) => getComputedStyle(r).fontStyle), 'italic');
    assert.match(await page.textContent('#talk .reply'), /It is in Music, under Evening\./);
    await page.waitForSelector('#talk .chip.in');
    assert.equal(await page.textContent('#talk .chip'), 'Open in Music');
    assert.equal(api.calls.filter((c) => c.call.startsWith('PUT /v1/messages/')).length, 1);
    assert.equal(await page.$('#talk .slot'), null, 'nothing waits any more');
    await page.waitForTimeout(700);
    await shot(page, 'conversation', theme);
    if (theme === 'dark') {
      await page.click('#talk .chip');
      await page.waitForURL(`${base}/music/`);
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
});

test('waking: … after 1.2 s, then "Waking up…" at 8 s, with the edge thinking', opts, async () => {
  for (const theme of ['light', 'dark']) {
    const { page, context, errors } = await open({ theme, clock: true });
    await send(page, 'Are you there?');
    await page.waitForSelector('#talk .you');
    await page.clock.runFor(1500);
    await page.waitForSelector('#talk .wait.dots');
    assert.ok(await page.$eval('#edge', (e) => e.classList.contains('think')));
    await page.clock.runFor(7000);
    await page.waitForSelector('#talk .wait.waking');
    assert.equal(await page.textContent('#talk .wait'), 'Waking up…');
    await shot(page, 'waking', theme);
    assert.deepEqual(errors, []);
    await context.close();
  }
});

test("the mind not waking: the honest line, the error edge, and the voice line's row 3", opts, async () => {
  for (const theme of ['light', 'dark']) {
    const messages = [owner('m1', 'Can you check the weather tomorrow'), { ...owner('m2', NOT_WAKING), seq: 2, author: 'system', origin: 'system', created_at: Date.now() - 60_000 }];
    const { page, context, errors } = await open({ theme, chat: { messages, presence: { state: 'failed', note: null, since: Date.now() } } });
    await page.waitForSelector('#talk .sys');
    assert.equal(await page.textContent('#talk .sys'), NOT_WAKING);
    assert.deepEqual(await say(page), ["I can't wake just now.", "I'll answer when I'm back."]);
    assert.ok(await page.$eval('#edge', (e) => e.classList.contains('err')));
    assert.equal(await page.$('#talk .wait'), null, 'no waking line under the honest one');
    await page.waitForTimeout(900);
    await shot(page, 'not-waking', theme);
    assert.deepEqual(errors, []);
    await context.close();
  }
});

test('offline: the message waits with its meta, then goes once when the phone is back', opts, async () => {
  const { page, context, errors, api } = await open();
  await context.setOffline(true);
  await page.evaluate(() => dispatchEvent(new Event('offline')));
  await send(page, 'Remind me about the call');
  await page.waitForSelector('#talk .meta');
  assert.equal(await page.textContent('#talk .meta'), "Sends when you're back online");
  assert.match(await page.$eval('#date', (d) => getComputedStyle(d, '::after').content), /Offline/);
  await context.setOffline(false);
  await page.evaluate(() => dispatchEvent(new Event('online')));
  // Sent: the Worker has it (the bubble's meta goes as soon as it is sending, so wait on the call).
  for (let i = 0; i < 100 && api.state.chat.messages.length === 0; i++) await page.waitForTimeout(50);
  await page.waitForFunction(() => !document.querySelector('#talk .meta'));
  assert.equal(api.calls.filter((c) => c.call.startsWith('PUT /v1/messages/')).length, 1);
  // A second load shows it once, from the server, with nothing left in the outbox.
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#talk .you');
  assert.equal(await page.$$eval('#talk .you', (b) => b.length), 1);
  assert.deepEqual(errors.filter((e) => !/ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(e)), []);
  await context.close();
});

test('a failed send says so and Retry sends it', opts, async () => {
  const { page, context, errors, api } = await open({ clock: true, chat: { failSay: 9 } });
  const puts = () => api.calls.filter((c) => c.call.startsWith('PUT /v1/messages/')).length;
  const until = async (ok) => { for (let i = 0; i < 100 && !ok(); i++) await new Promise((r) => setTimeout(r, 50)); };
  await send(page, 'Hello there');
  // Each retry waits 2, 5, then 15 s; the page's clock moves only once the try before has failed.
  for (const [n, ms] of [[1, 2500], [2, 5500], [3, 15500]]) {
    await until(() => puts() >= n);
    await page.waitForTimeout(150);
    await page.clock.runFor(ms);
  }
  await until(() => puts() >= 4);
  await page.waitForSelector('#talk .meta.bad');
  assert.match(await page.textContent('#talk .meta'), /^Didn't send · Retry$/);
  api.state.chat.failSay = 0;
  await page.click('#talk .retry');
  await page.waitForFunction(() => !document.querySelector('#talk .meta'));
  assert.equal(api.calls.filter((c) => c.call.startsWith('PUT /v1/messages/')).length, 5, 'one try and three retries, then the tap');
  assert.deepEqual(errors.filter((e) => !/503/.test(e)), []);
  await context.close();
});

test('Stop: while the mind works on an answer, Stop asks it to stop after the current step', opts, async () => {
  const { page, context, errors, api } = await open({ chat: { messages: [owner('m1', 'Rebuild the playlist')], presence: { state: 'working', note: null, since: Date.now() } } });
  await page.waitForSelector('#talk .stop');
  await page.waitForFunction(() => document.querySelector('#edge').classList.contains('think'), null, { timeout: 3000 });
  await page.click('#talk .stop');
  await page.waitForSelector('#talk .stopping');
  assert.ok(api.calls.some((c) => c.call === 'POST /v1/mind/stop'));
  assert.deepEqual(errors, []);
  await context.close();
});

test('a verb queued for this phone runs once and reports its undo; one it lacks is unsupported_verb', opts, async () => {
  const verb = (id, name, args) => ({ id, verb: name, schema: 1, ref: null, args, device_id: null, status: 'pending', proposal_id: null, created_at: Date.now(), expires_at: Date.now() + 86_400_000, result: null, error: null, ledger_id: null });
  const { page, context, errors, api } = await open({ chat: { verbs: [verb('v1', 'shell.appearance', { mode: 'night' }), verb('v2', 'music.queue_add', { ref: 'music:1' })] } });
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await page.waitForFunction(() => true);
  await page.waitForTimeout(300);
  const results = api.state.chat.results;
  assert.deepEqual(results.find((r) => r.id === 'v1'), { id: 'v1', ok: true, result: { previous: 'day' }, undo: { verb: 'shell.appearance', schema: 1, args: { mode: 'day' } } });
  assert.deepEqual(results.find((r) => r.id === 'v2'), { id: 'v2', ok: false, error: { code: 'unsupported_verb' } });
  assert.equal(await page.evaluate(() => localStorage.getItem('th-theme')), 'dark');
  assert.deepEqual(errors, []);
  await context.close();
});

test("a home line is the voice line's second line; a kind this phone can't draw shows its why", opts, async () => {
  const surface = (kind, slot, payload, why) => ({ app: 'home', slot, kind, schema: 1, payload, why, topic_key: 't', ref: null, expires_at: null, written_at: Date.now(), seq: 1, ledger_id: null });
  const surfaces = [surface('line', 'line.1', { text: 'Your new playlist is in Music.' }, 'a playlist was made tonight'), surface('banner', 'top', { x: 1 }, 'A newer kind of card, shown plainly.')];
  const { page, context, errors } = await open({ chat: { surfaces, messages: [owner('m1', 'hi', { answered_at: Date.now() })] } });
  await page.waitForFunction(() => document.querySelectorAll('#say .ln').length === 2);
  assert.deepEqual(await say(page), ['Nothing needs you.', 'Your new playlist is in Music.']);
  assert.equal(await page.textContent('.fallbacks .card .q'), 'A newer kind of card, shown plainly.');
  assert.deepEqual(errors, []);
  await context.close();
});

// Home's conversation in Chromium at 390×844 against the mocked Worker and its live socket
// (tests/fixtures/mock-api.mjs): first run, a reply over the socket with its chip, waking, the
// mind not waking, the offline outbox, Stop, a verb run on this phone, a home line and the
// generic card; and the review cases: changes during a slow or failed load, a failed message left
// in the outbox, IndexedDB refusing writes, concurrent outbox writes, and sign-out with unsent
// messages. CSP violations are console errors, so each test also proves the page fits its CSP.
// Set SHOTS=<dir> to keep the screenshots (day and night: empty, conversation, waking, not waking).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
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

async function open({ theme = 'light', chat = {}, clock = false, outbox = [], init = null, path = '/', setup = null } = {}) {
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
  // Messages already in the outbox, one key each (th/chat/store.js).
  if (outbox.length) await page.evaluate((items) => new Promise((resolve, reject) => {
    const req = indexedDB.open('th-data', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => {
      const tx = req.result.transaction('kv', 'readwrite');
      for (const m of items) tx.objectStore('kv').put(m, `chat.outbox.${m.id}`);
      tx.oncomplete = () => { req.result.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }), outbox);
  if (init) await page.addInitScript(init);
  if (setup) await setup(page);
  errors.length = 0; // the 404 page used to reach the origin
  if (clock) await page.clock.install();
  await page.goto(`${base}${path}`, { waitUntil: 'load' });
  if (clock) await page.clock.runFor(300);
  if (path === '/' && !setup) await page.waitForSelector('#talk', { state: 'attached' });
  await page.waitForTimeout(300);
  return { page, context, errors, api };
}
const say = (page) => page.$$eval('#say .ln', (ls) => ls.map((l) => l.textContent));
/** Reads until the value is `want` (5 s at most), then asserts it: a step waits on what the page
 * shows or the mock saw, never on a guessed delay. */
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
const send = async (page, text) => { await page.fill('#q', text); await page.press('#q', 'Enter'); };

test('first run: the voice line welcomes; nothing else on the page', opts, async () => {
  for (const theme of ['light', 'dark']) {
    const { page, context, errors } = await open({ theme });
    await eventually(() => say(page), ["I'm here.", 'Ask me anything, any time.']);
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

test("the mind not waking: the honest line and the error edge; the voice line's row 3 only without the line", opts, async () => {
  for (const theme of ['light', 'dark']) {
    const messages = [owner('m1', 'Can you check the weather tomorrow'), { ...owner('m2', NOT_WAKING), seq: 2, author: 'system', origin: 'system', meta: { line: 'not_waking' }, created_at: Date.now() - 60_000 }];
    const { page, context, errors } = await open({ theme, chat: { messages, presence: { state: 'failed', note: null, since: Date.now() } } });
    await page.waitForSelector('#talk .sys');
    assert.equal(await page.textContent('#talk .sys'), NOT_WAKING);
    await eventually(() => say(page), ['Nothing needs you.'], 'said once, in the thread');
    assert.ok(await page.$eval('#edge', (e) => e.classList.contains('err')));
    assert.equal(await page.$('#talk .wait'), null, 'no waking line under the honest one');
    await page.waitForTimeout(900);
    await shot(page, 'not-waking', theme);
    assert.deepEqual(errors, []);
    await context.close();
  }
  const { page, context } = await open({ chat: { presence: { state: 'failed', note: null, since: Date.now() } } });
  await eventually(() => say(page), ["I can't wake just now.", "I'll answer when I'm back."]);
  await context.close();
});

test('offline: the message waits with its meta, then goes once when the phone is back', opts, async () => {
  const { page, context, errors, api } = await open();
  await context.setOffline(true);
  await page.evaluate(() => dispatchEvent(new Event('offline')));
  await send(page, 'Remind me about the call');
  await page.waitForSelector('#talk .meta');
  assert.equal(await page.textContent('#talk .meta'), "Sends when you're back online");
  assert.match(await page.$eval('#date', (d) => getComputedStyle(d, '::after').content), /Offline/);
  assert.equal(await page.$('#talk .slot'), null, 'a queued message waits for nothing');
  assert.deepEqual(await page.$eval('#edge', (e) => [e.dataset.state, e.classList.contains('breathe')]), ['offline', false]);
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
  const until = async (ok) => { for (let i = 0; i < 100 && !(await ok()); i++) await new Promise((r) => setTimeout(r, 50)); };
  // The retry's timer is set before the outbox copy is written, so a copy with n tries has it set.
  const kept = () => page.evaluate(() => new Promise((resolve) => {
    const req = indexedDB.open('th-data', 1);
    req.onsuccess = () => {
      const all = req.result.transaction('kv').objectStore('kv').getAll();
      all.onsuccess = () => { req.result.close(); resolve(Math.max(0, ...all.result.filter((v) => v?.body === 'Hello there').map((v) => v.tries))); };
    };
  }));
  await send(page, 'Hello there');
  // Each retry waits 2, 5, then 15 s; the page's clock moves only once the try before has failed.
  for (const [n, ms] of [[1, 2500], [2, 5500], [3, 15500]]) {
    await until(() => puts() >= n);
    await until(async () => (await kept()) >= n);
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
  await page.focus('#talk .stop');
  await page.waitForTimeout(1500); // the clock ticks; the slot isn't drawn again
  const onStop = () => page.evaluate(() => document.activeElement?.classList.contains('stop') ?? false);
  assert.ok(await onStop(), 'focus stays on Stop');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#talk .stopping');
  for (let i = 0; i < 60 && !api.calls.some((c) => c.call === 'POST /v1/mind/stop'); i++) await page.waitForTimeout(50);
  assert.ok(api.calls.some((c) => c.call === 'POST /v1/mind/stop'));
  await page.waitForTimeout(300);
  assert.ok(await onStop(), 'and on it while stopping');
  assert.equal(await page.textContent('#talk .stop'), 'Stopping…');
  assert.deepEqual(errors, []);
  await context.close();
});

test('a verb queued for this phone runs once and reports its undo; one it lacks is unsupported_verb', opts, async () => {
  const verb = (id, name, args) => ({ id, verb: name, schema: 1, ref: null, args, device_id: null, status: 'pending', proposal_id: null, created_at: Date.now(), expires_at: Date.now() + 86_400_000, result: null, error: null, ledger_id: null });
  const { page, context, errors, api } = await open({ chat: { verbs: [verb('v1', 'shell.appearance', { mode: 'night' }), verb('v2', 'music.queue_add', { ref: 'music:1' })] } });
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await eventually(() => api.state.chat.results.map((r) => r.id).sort(), ['v1', 'v2'], 'both reported');
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

const until = async (ok, ms = 5000) => { for (let t = 0; t < ms && !(await ok()); t += 50) await new Promise((r) => setTimeout(r, 50)); };

test('changes during a slow load, and a load that fails once, still reach the screen', opts, async () => {
  const { page, context, errors, api } = await open({ chat: { messages: [owner('m1', 'Are you there?')], presence: { state: 'working', note: null, since: Date.now() } } });
  const edge = () => page.$eval('#edge', (e) => e.dataset.state);
  const reply = (text) => page.waitForFunction((t) => [...document.querySelectorAll('#talk .reply')].some((r) => r.textContent === t), text);
  assert.equal(await edge(), 'think');
  // The mind's presence changes, and its reply lands while that is still loading.
  api.state.chat.slow['/v1/settings'] = 800;
  api.chat.presence('listening');
  await page.waitForTimeout(150);
  api.chat.reply('Yes, here.');
  await reply('Yes, here.');
  await until(async () => (await edge()) === 'calm');
  assert.equal(await edge(), 'calm');
  delete api.state.chat.slow['/v1/settings'];
  // A reply, then "listening" while today is still loading: the edge leaves thinking.
  api.chat.presence('working');
  await until(async () => (await edge()) === 'think');
  api.state.chat.slow['/v1/threads/today'] = 800;
  api.chat.reply('Done.');
  await page.waitForTimeout(150);
  api.chat.presence('listening');
  await reply('Done.');
  await until(async () => (await edge()) === 'calm');
  assert.equal(await edge(), 'calm');
  delete api.state.chat.slow['/v1/threads/today'];
  // Today fails once: the pass tries again on the back-off and the reply shows.
  api.state.chat.fail['/v1/threads/today'] = 1;
  api.chat.reply('Third.');
  await reply('Third.');
  assert.equal(api.state.chat.fail['/v1/threads/today'], 0);
  assert.deepEqual(errors.filter((e) => !/503/.test(e)), []);
  await context.close();
});

test("a message left failed in the outbox shows only \"Didn't send · Retry\"", opts, async () => {
  const at = Date.now() - 120_000;
  const { page, context, errors } = await open({ outbox: [{ id: '0192f0c4-0000-7000-8000-0000000000f1', body: 'Did this go?', created_at: at, state: 'failed', tries: 4, failed_at: at }] });
  await page.waitForSelector('#talk .meta.bad');
  assert.match(await page.textContent('#talk .meta'), /^Didn't send · Retry$/);
  await page.waitForTimeout(1500);
  assert.equal(await page.$('#talk .slot'), null, 'no reply slot under it');
  assert.equal(await page.$eval('#edge', (e) => e.dataset.state), 'calm', 'failed two minutes ago: the error edge has gone');
  assert.deepEqual(errors, []);
  await context.close();
});

test('with IndexedDB refusing writes, a message still shows, sends and gets its reply', opts, async () => {
  const init = () => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (typeof key === 'string' && key.startsWith('chat.')) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      return put.call(this, value, key);
    };
  };
  const { page, context, errors, api } = await open({ init, chat: { reply: { after: 300, text: 'Got it.' }, presence: { state: 'listening', note: null, since: Date.now() } } });
  await send(page, 'Note this down');
  await page.waitForSelector('#talk .you');
  assert.equal(await page.inputValue('#q'), '');
  await page.waitForFunction(() => document.querySelector('#talk .reply')?.textContent === 'Got it.');
  assert.equal(api.calls.filter((c) => c.call.startsWith('PUT /v1/messages/')).length, 1);
  assert.deepEqual(errors, []);
  await context.close();
});

test('the outbox keeps every message written at once', opts, async () => {
  const { page, context, errors } = await open();
  const ids = await page.evaluate(async () => {
    const { outbox } = await import('/th/chat/store.js');
    const m = (id) => ({ id, body: id, created_at: 0, state: 'queued', tries: 0 });
    await Promise.all([outbox.put(m('a1')), outbox.put(m('a2')), outbox.put(m('a3'))]);
    await Promise.all([outbox.remove('a2'), outbox.put(m('a4'))]);
    return (await outbox.list()).map((x) => x.id);
  });
  assert.deepEqual(ids, ['a1', 'a3', 'a4']);
  assert.deepEqual(errors, []);
  await context.close();
});

test('signing out with a message still unsent asks first', opts, async () => {
  const outbox = [{ id: '0192f0c4-0000-7000-8000-0000000000f2', body: 'Later', created_at: Date.now() - 120_000, state: 'failed', tries: 4, failed_at: Date.now() - 120_000 }];
  const { page, context, errors, api } = await open({ outbox, path: '/settings/password/' });
  const out = 'button:has-text("Sign out of this device")';
  await page.waitForSelector(out);
  await page.click(out);
  await page.waitForSelector('.csheet');
  assert.equal(await page.textContent('.csheet h2'), "1 message hasn't sent yet. Sign out anyway?");
  await page.click('.csheet button:has-text("Cancel")');
  await page.waitForTimeout(700);
  assert.equal(api.calls.filter((c) => c.call === 'POST /v1/auth/signout').length, 0, 'Cancel keeps this phone signed in');
  await page.click(out);
  await page.click('.csheet button:has-text("Sign out")');
  await page.waitForURL((u) => u.pathname === '/signin/');
  assert.equal(api.calls.filter((c) => c.call === 'POST /v1/auth/signout').length, 1);
  assert.deepEqual(errors, []);
  await context.close();
});

test('a message waiting on a retry holds the next one, so they arrive in order', opts, async () => {
  const { page, context, errors, api } = await open({ chat: { failSay: 1 } });
  await send(page, 'First, this');
  for (let i = 0; i < 40 && !api.calls.some((c) => c.call.startsWith('PUT /v1/messages/')); i++) await page.waitForTimeout(50);
  await send(page, 'Then this');
  await until(async () => api.state.chat.messages.length === 2);
  assert.deepEqual(api.state.chat.messages.map((m) => m.body), ['First, this', 'Then this']);
  assert.deepEqual(errors.filter((e) => !/503/.test(e)), []);
  await context.close();
});

test("if the chat can't load, the ask bar says so instead of doing nothing", opts, async () => {
  const setup = (page) => page.route('**/th/chat/index.js', (r) => r.fulfill({ status: 404, body: '' }));
  const { page, context } = await open({ setup });
  await page.waitForFunction(() => document.documentElement.dataset.chat === 'failed');
  await send(page, 'Hello?');
  await page.waitForFunction(() => document.querySelector('#toast')?.textContent === "Couldn't load the conversation. Reload to try again.");
  assert.equal(await page.inputValue('#q'), 'Hello?', 'the words stay in the bar');
  await context.close();
});

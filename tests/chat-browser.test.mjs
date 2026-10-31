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
/** The status chip at the top: null while all is well, else [kind, words] (no standing voice line). */
const status = (page) => page.$eval('#status', (s) => (s.hidden ? null : [s.dataset.kind, s.textContent]));
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

test('first run: nothing stands on the page saying all is well; the bar asks', opts, async () => {
  for (const theme of ['light', 'dark']) {
    const { page, context, errors } = await open({ theme });
    await page.waitForSelector('#talk', { state: 'attached' });
    assert.equal(await status(page), null, 'no status while all is well');
    assert.equal(await page.$('#say'), null, 'no voice line');
    assert.equal(await page.getAttribute('#q', 'placeholder'), 'Ask anything');
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
    assert.deepEqual(await page.$eval('#talk .reply', (r) => [getComputedStyle(r).fontStyle, getComputedStyle(r).fontFamily.split(',')[0]]), ['normal', 'Switzer']);
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

test('every block type draws under a reply, its tags as text; perspectives switch on a tap', opts, async () => {
  const blocks = [
    { type: 'prose', text: 'A front arrives from the west. <img src=x onerror="document.title=1">' },
    { type: 'stats', items: [{ label: 'Rain', value: '42 mm', change: '+30 mm', direction: 'up', tone: 'bad', asOf: 'today' }, { label: 'Days', value: '3' }] },
    { type: 'chart', text: 'Rain by day', kind: 'column', unit: 'mm', labels: ['Thu', 'Fri', 'Sat'], series: [{ name: 'Rain', values: [12, 20, 10] }] },
    { type: 'chart', text: 'Monthly change', kind: 'line', unit: '%', labels: ['Jul', 'Aug', 'Sep', 'Oct'], series: [{ name: 'Prices', values: [0.4, 0.2, 0.1, 0.1] }] },
    { type: 'timeline', text: 'The week', items: [{ label: 'Wednesday', text: 'Dry', state: 'past' }, { label: 'Thursday', text: 'Rain starts', state: 'next' }] },
    { type: 'quote', text: 'Bring an umbrella.', speaker: 'A forecaster', role: 'Example Weather' },
    { type: 'callout', kind: 'unknown', text: 'How long the front stalls.' },
    { type: 'comparison', text: 'Two readings', items: [{ label: 'Calm', text: 'It has settled.' }, { label: 'Cautious', text: 'One month is not a trend.' }] },
    { type: 'perspectives', text: 'What it means', tabs: [{ label: 'Shoppers', text: 'Bills stay the same.' }, { label: 'Savers', text: 'Rates may stay put.' }] },
    { type: 'explanation', text: 'How the figure is made', steps: ['Prices are collected.', 'They are weighted.', 'The change is published.'] },
    { type: 'agenda', text: 'Next', items: [{ at: '2026-11-12T09:00:00+00:00', label: 'Next figure' }] },
  ];
  const reply = { after: 300, text: 'Here is the week.', meta: { blocks } };
  const { page, context, errors } = await open({ chat: { reply, presence: { state: 'listening', note: null, since: Date.now() } } });
  await send(page, 'Show me everything.');
  await page.waitForSelector('#talk .reply .blocks .bb');
  // A reply shows at most four blocks; the rest wait for a page of their own.
  assert.deepEqual(await page.$$eval('#talk .reply .blocks .bb', (b) => b.map((x) => x.className.replace('bb b-', ''))), ['prose', 'stats', 'chart', 'chart']);
  assert.equal(await page.$$eval('#talk .reply .bchart svg rect', (r) => r.length), 3);
  assert.equal(await page.$$eval('#talk .reply .bchart svg polyline', (r) => r.length), 1);
  assert.equal(await page.$('#talk img'), null, 'a tag in a block is text');
  assert.notEqual(await page.title(), '1');
  await context.close();
  // The other seven, four and three at a time.
  for (const part of [blocks.slice(4, 8), blocks.slice(8)]) {
    const next = await open({ chat: { reply: { after: 300, text: 'More.', meta: { blocks: part } }, presence: { state: 'listening', note: null, since: Date.now() } } });
    await send(next.page, 'And the rest?');
    await next.page.waitForSelector('#talk .reply .blocks .bb');
    assert.deepEqual(await next.page.$$eval('#talk .reply .blocks .bb', (b) => b.map((x) => x.className.replace('bb b-', ''))), part.map((b) => b.type));
    if (part.some((b) => b.type === 'perspectives')) {
      await next.page.click('#talk .reply .btabs button:nth-child(2)');
      assert.equal(await next.page.textContent('#talk .reply .btabp'), 'Rates may stay put.');
    }
    assert.deepEqual(next.errors, []);
    await next.context.close();
  }
  assert.deepEqual(errors, []);
});

test('a rich reply: upright, with a heading, a list, bold and a quote, and blocks under it', opts, async () => {
  for (const theme of ['light', 'dark']) {
    const text = '### Your week\nYou practised on **four** days.\n- Monday, 30 minutes\n- Thursday, 45 minutes\n> Slow is smooth.';
    const blocks = [
      { type: 'stats', items: [{ label: 'Minutes', value: '135' }, { label: 'Days', value: '4' }] },
      { type: 'chart', kind: 'column', text: 'Minutes a day', labels: ['Mon', 'Tue', 'Wed', 'Thu'], series: [{ name: 'Minutes', values: [30, 20, 40, 45] }], unit: 'min' },
    ];
    const reply = { after: 300, text, meta: { blocks } };
    const { page, context, errors } = await open({ theme, chat: { reply, presence: { state: 'listening', note: null, since: Date.now() } } });
    await send(page, 'How was my practice this week?');
    await page.waitForSelector('#talk .reply .blocks .bchart svg rect');
    const r = '#talk .reply';
    assert.deepEqual(await page.$eval(r, (n) => [getComputedStyle(n).fontStyle, getComputedStyle(n).fontFamily.split(',')[0]]), ['normal', 'Switzer']);
    assert.equal(await page.textContent(`${r} h3`), 'Your week');
    assert.equal(await page.textContent(`${r} p b`), 'four');
    assert.deepEqual(await page.$$eval(`${r} ul li`, (l) => l.map((x) => x.textContent)), ['Monday, 30 minutes', 'Thursday, 45 minutes']);
    assert.equal(await page.$eval(`${r} blockquote`, (q) => getComputedStyle(q).fontStyle), 'italic');
    assert.equal(await page.$$eval(`${r} .blocks .bstat`, (s) => s.length), 2);
    assert.equal(await page.$$eval(`${r} .blocks .bchart rect`, (s) => s.length), 4);
    assert.ok(await page.$eval('#convo', (c) => c.scrollWidth <= c.clientWidth), 'nothing scrolls sideways');
    await page.waitForTimeout(1500);
    await shot(page, 'rich', theme);
    assert.deepEqual(errors, []);
    await context.close();
  }
});

test('a cited answer: numbered sources in the text, Where to study under it, each opening Study at that page', opts, async () => {
  const a = 'book:0190c8a2-7d1e-7abc-8def-0123456789ab#p12.b3';
  const b = 'book:0190c8a2-7d1e-7abc-8def-0123456789ab#p40.b1';
  const text = `The commentary ties the verse to patience [[${a}]]. It comes back to it later [[${b}]][[${a}]].`;
  const meta = { cite: { q: 'What do my books say about patience?', citations: [{ ref: a, label: 'A Commentary, p. 11' }, { ref: b, label: 'A Commentary, p. 39' }], dropped: 0 } };
  const { page, context, errors } = await open({ chat: { reply: { after: 200, text, meta }, presence: { state: 'listening', note: null, since: Date.now() } } });
  await send(page, 'What do my books say about patience?');
  await page.waitForSelector('#talk .reply a.cite');
  assert.deepEqual(await page.$$eval('#talk .reply a.cite', (l) => l.map((x) => [x.textContent, x.getAttribute('href'), x.target])), [
    ['1', '/study/?book=0190c8a2-7d1e-7abc-8def-0123456789ab&p=12&b=3', ''],
    ['2', '/study/?book=0190c8a2-7d1e-7abc-8def-0123456789ab&p=40&b=1', ''],
    ['1', '/study/?book=0190c8a2-7d1e-7abc-8def-0123456789ab&p=12&b=3', ''],
  ]);
  assert.doesNotMatch(await page.textContent('#talk .reply'), /\[\[book:/);
  assert.deepEqual(await page.$$eval('#talk .reply .study a', (l) => l.map((x) => [x.textContent, x.getAttribute('href')])), [
    ['A Commentary, p. 11', '/study/?book=0190c8a2-7d1e-7abc-8def-0123456789ab&p=12&b=3'],
    ['A Commentary, p. 39', '/study/?book=0190c8a2-7d1e-7abc-8def-0123456789ab&p=40&b=1'],
  ]);
  await page.waitForTimeout(500);
  await shot(page, 'cited-answer', 'light');
  await page.click('#talk .reply .study a >> nth=1');
  await page.waitForURL(`${base}/study/?book=0190c8a2-7d1e-7abc-8def-0123456789ab&p=40&b=1`);
  assert.deepEqual(errors, []);
  await context.close();
});

test('waking: thinking words after 1.2 s, then "Waking up…" at 8 s, with the edge thinking', opts, async () => {
  for (const theme of ['light', 'dark']) {
    const { page, context, errors } = await open({ theme, clock: true });
    await send(page, 'Are you there?');
    await page.waitForSelector('#talk .you');
    await page.clock.runFor(1500);
    await page.waitForSelector('#talk .wait.dots');
    assert.equal(await page.textContent('#talk .wait'), 'Thinking…');
    assert.ok(await page.$eval('#edge', (e) => e.classList.contains('think')));
    // The mock Worker stamps the message with real time, a little after this fake clock: margins.
    await page.clock.runFor(4000);
    assert.equal(await page.textContent('#talk .wait'), 'Working it out…');
    await page.clock.runFor(3500);
    await page.waitForSelector('#talk .wait.waking');
    assert.equal(await page.textContent('#talk .wait'), 'Waking up…');
    await shot(page, 'waking', theme);
    assert.deepEqual(errors, []);
    await context.close();
  }
});

test("the mind not waking: the honest line and the error edge; the status chip only without the line", opts, async () => {
  for (const theme of ['light', 'dark']) {
    const messages = [owner('m1', 'Can you check the weather tomorrow'), { ...owner('m2', NOT_WAKING), seq: 2, author: 'system', origin: 'system', meta: { line: 'not_waking' }, created_at: Date.now() - 60_000 }];
    const { page, context, errors } = await open({ theme, chat: { messages, presence: { state: 'failed', note: null, since: Date.now() } } });
    await page.waitForSelector('#talk .sys');
    assert.equal(await page.textContent('#talk .sys'), NOT_WAKING);
    await eventually(() => status(page), null, 'said once, in the thread');
    assert.ok(await page.$eval('#edge', (e) => e.classList.contains('err')));
    assert.equal(await page.$('#talk .wait'), null, 'no waking line under the honest one');
    await page.waitForTimeout(900);
    await shot(page, 'not-waking', theme);
    assert.deepEqual(errors, []);
    await context.close();
  }
  const { page, context } = await open({ chat: { presence: { state: 'failed', note: null, since: Date.now() } } });
  await eventually(() => status(page), ['wake', 'Can\u2019t wake just now']);
  await context.close();
});

test('offline: the message waits with its meta, then goes once when the phone is back', opts, async () => {
  const { page, context, errors, api } = await open();
  await context.setOffline(true);
  await page.evaluate(() => dispatchEvent(new Event('offline')));
  await send(page, 'Remind me about the call');
  await page.waitForSelector('#talk .meta');
  assert.equal(await page.textContent('#talk .meta'), "Sends when you're back online");
  await eventually(() => status(page), ['offline', 'Offline']);
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

test('"go quiet" with the network off: the quiet chip at once, nothing sent; the Worker gets it once back; "I\'m back" ends it (LAW-9)', opts, async () => {
  const { page, context, errors, api } = await open();
  await context.setOffline(true);
  await page.evaluate(() => dispatchEvent(new Event('offline')));
  await send(page, 'go quiet');
  // The owner's own order shows at once, offline too (it outranks "Offline" on the chip).
  const quietShown = async () => {
    const st = await status(page);
    return st ? [st[0], /^Quiet until \d\d:\d\d$/.test(st[1])] : null;
  };
  await eventually(quietShown, ['quiet', true]);
  assert.equal(await page.inputValue('#q'), '');
  assert.equal(await page.$('#talk .you'), null, 'the command is not a message');
  await context.setOffline(false);
  await page.evaluate(() => dispatchEvent(new Event('online')));
  await eventually(() => api.state.chat.quietUntil > Date.now(), true, 'the Worker has it once back online');
  // A reload keeps it, from this phone and from the Worker.
  await page.reload({ waitUntil: 'load' });
  await eventually(quietShown, ['quiet', true]);
  await send(page, "I'm back");
  await eventually(() => api.state.chat.quietUntil, 0);
  await eventually(() => status(page), null);
  // Not quiet, "I'm back" is only words for the mind.
  await send(page, "I'm back");
  await page.waitForSelector('#talk .you');
  assert.deepEqual(api.calls.filter((c) => c.call === 'PATCH /v1/settings').map((c) => typeof c.body['quiet.until']), ['number', 'number']);
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

test("home lines are cards in the chat (the night's as one Overnight card); a kind this phone can't draw shows its why", opts, async () => {
  const surface = (kind, slot, payload, why, at = Date.now(), seq = 1) => ({ app: 'home', slot, kind, schema: 1, payload, why, topic_key: 't', ref: null, expires_at: null, written_at: at, seq, ledger_id: null });
  // The mock's day is 2026-10-29: two lines from that night, one placed during the day just now.
  const night = new Date('2026-10-29T05:10').getTime();
  const surfaces = [surface('line', 'line.2', { text: 'Rain from 4, so practice before then.' }, 'the forecast', night + 60_000, 2), surface('line', 'line.1', { text: 'Your new book is ready in Study.' }, 'a book was read tonight', night, 3), surface('line', 'line.3', { text: 'Your new playlist is in Music.' }, 'a playlist was made', Date.now() - 120_000, 4), surface('banner', 'top', { x: 1 }, 'A newer kind of card, shown plainly.')];
  const { page, context, errors } = await open({ chat: { surfaces, messages: [owner('m1', 'hi', { answered_at: Date.now(), created_at: Date.now() - 60_000 })] } });
  await page.waitForSelector('#talk .note');
  const notes = await page.$$eval('#talk .note', (ns) => ns.map((n) => [n.querySelector('.nh')?.textContent ?? null, [...n.querySelectorAll('.nt')].map((t) => t.textContent)]));
  assert.deepEqual(notes, [['Overnight', ['Your new book is ready in Study.', 'Rain from 4, so practice before then.']], [null, ['Your new playlist is in Music.']]]);
  // In time order among the messages: the day's line came before the owner's "hi".
  assert.deepEqual(await page.$$eval('#talk .note, #talk .you', (ns) => ns.map((n) => n.className)), ['note', 'note', 'you']);
  assert.equal(await status(page), null);
  assert.equal(await page.textContent('.fallbacks .card .q'), 'A newer kind of card, shown plainly.');
  assert.deepEqual(errors, []);
  await context.close();
});

const until = async (ok, ms = 5000) => { for (let t = 0; t < ms && !(await ok()); t += 50) await new Promise((r) => setTimeout(r, 50)); };

test('changes during a slow load, and a load that fails once, still reach the screen', opts, async () => {
  const { page, context, errors, api } = await open({ chat: { messages: [owner('m1', 'Are you there?')], presence: { state: 'working', note: null, since: Date.now() } } });
  const edge = () => page.$eval('#edge', (e) => e.dataset.state);
  const reply = (text) => page.waitForFunction((t) => [...document.querySelectorAll('#talk .reply')].some((r) => r.textContent === t), text);
  // The first load sets the edge; on a busy machine it lands after open() returns.
  await until(async () => (await edge()) === 'think');
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

test('signing out with a Forget still waiting sends it first, and asks while it cannot go', opts, async () => {
  const CALM = '0192f0c4-0000-7000-8000-000000000001';
  const { page, context, errors, api } = await open({
    path: '/settings/password/',
    chat: { fail: { '/v1/memory/ops': 99 } },
    setup: (p) => p.evaluate((id) => localStorage.setItem('th.p.forget', JSON.stringify([id])), CALM),
  });
  const out = 'button:has-text("Sign out of this device")';
  await page.waitForSelector(out);
  await page.click(out);
  await page.waitForSelector('.csheet');
  assert.equal(await page.textContent('.csheet h2'), "1 Forget hasn't gone through yet. Sign out anyway?");
  assert.equal(await page.textContent('.csheet p'), "If you sign out now, I'll keep remembering that fact.");
  await page.click('.csheet button:has-text("Cancel")');
  await page.waitForTimeout(700);
  assert.equal(api.calls.filter((c) => c.call === 'POST /v1/auth/signout').length, 0, 'Cancel keeps this phone signed in');
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('th.p.forget'))), [CALM], 'and the Forget still waits');
  api.state.chat.fail['/v1/memory/ops'] = 0;
  await page.click(out);
  await page.waitForURL((u) => u.pathname === '/signin/');
  assert.ok(!api.state.memory.facts.some((f) => f.id === CALM), 'the Forget reached the Worker before the sign-out');
  assert.equal(api.calls.filter((c) => c.call === 'POST /v1/auth/signout').length, 1);
  assert.deepEqual(errors.filter((e) => !/503/.test(e)), []);
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

const MSG_THREAD = '0192f0c4-0000-7000-8000-0000000000aa';
/** A message already in today's thread, `ago` ms before now. */
const past = (n, author, body, ago, meta = null) => ({ seq: n, id: `0192f0c4-0000-7000-8000-${String(900 + n).padStart(12, '0')}`, thread_id: MSG_THREAD, author, origin: author === 'owner' ? 'owner_device' : 'mind', kind: 'text', body, meta, attachments: [], reply_to: null, created_at: Date.now() - ago, delivered_at: null, acked_at: null, answered_at: author === 'owner' ? Date.now() - ago + 60_000 : null });
const sent = (api) => api.calls.filter((c) => c.call.startsWith('PUT /v1/messages/')).map((c) => c.body);

test('follow-ups: two taps under the newest reply; one sends its words answering that reply; they hide once the talk moves on', opts, async () => {
  const reply = { after: 200, text: 'Your evening playlist is ready.', meta: { followups: ['Play it now', 'Make it longer', 'A third is never shown'] } };
  const { page, context, errors, api } = await open({ chat: { reply, presence: { state: 'listening', note: null, since: Date.now() } } });
  await send(page, 'Make me an evening playlist');
  await page.waitForSelector('#talk .follows.in');
  assert.deepEqual(await page.$$eval('#talk .follow', (b) => b.map((x) => x.textContent)), ['Play it now', 'Make it longer']);
  const replyId = await page.$eval('#talk .replybox', (b) => b.dataset.id);
  await page.click('#talk .follow');
  await eventually(() => sent(api).at(-1), { body: 'Play it now', reply_to: replyId }, 'the follow-up answers the reply');
  await page.waitForFunction(() => document.querySelectorAll('#talk .turn').length === 2);
  assert.equal(await page.$eval('#talk .follows', (f) => getComputedStyle(f).display), 'none', 'an older turn shows none');
  assert.deepEqual(errors, []);
  await context.close();
});

test('a tapped reply: Copy, Shorter, Say more and Ask about this', opts, async () => {
  const reply = { after: 200, text: 'Bars 9 to 12 at 84, then up to tempo.' };
  const { page, context, errors, api } = await open({ chat: { reply, presence: { state: 'listening', note: null, since: Date.now() } } });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await send(page, 'What should I practise?');
  await page.waitForSelector('#talk .reply');
  await page.waitForTimeout(700);
  const replyId = await page.$eval('#talk .reply', (r) => r.dataset.id);
  // The actions load on the first tap, so each row is waited for.
  const tap = async () => { await page.click(`#talk [data-id="${replyId}"]`); await page.waitForSelector('#talk .ractions'); };
  await tap();
  assert.deepEqual(await page.$$eval('#talk .ractions button', (b) => b.map((x) => x.textContent)), ['Copy', 'Shorter', 'Say more', 'Ask about this']);
  await page.click(`#talk [data-id="${replyId}"]`);
  await page.waitForSelector('#talk .ractions', { state: 'detached' });
  await tap();
  await page.click('#talk .ractions button:text("Copy")');
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'Bars 9 to 12 at 84, then up to tempo.');
  await tap();
  await page.click('#talk .ractions button:text("Shorter")');
  await eventually(() => sent(api).at(-1), { body: 'Shorter, please.', reply_to: replyId });
  await tap();
  await page.click('#talk .ractions button:text("Ask about this")');
  assert.equal(await page.textContent('#about span'), 'About: Bars 9 to 12 at 84, then up to tempo.');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'q');
  await page.keyboard.type('Why 84?');
  await page.keyboard.press('Enter');
  await eventually(() => sent(api).at(-1), { body: 'Why 84?', reply_to: replyId });
  assert.equal(await page.$('#about'), null, 'the quote goes with the message');
  assert.deepEqual(errors, []);
  await context.close();
});

test('an older long reply folds to 10 lines with Show all; the newest never folds; the time shows after an hour of quiet', opts, async () => {
  const long = Array.from({ length: 24 }, (_, i) => `Line ${i + 1} of a long answer about the week.`).join('\n');
  const messages = [past(1, 'owner', 'Plan my week', 3 * 3600_000), past(2, 'mind', long, 3 * 3600_000 - 60_000), past(3, 'owner', 'Thanks', 3600_000 + 120_000), past(4, 'mind', long, 3600_000 + 60_000), past(5, 'owner', 'One more thing', 20 * 60_000), past(6, 'mind', 'Sure.', 19 * 60_000)];
  const { page, context, errors } = await open({ chat: { messages } });
  await page.waitForSelector('#talk .reply.folded');
  assert.deepEqual(await page.$$eval('#talk .reply', (r) => r.map((x) => x.classList.contains('folded'))), [true, true, false]);
  assert.equal(await page.$$eval('#talk .more', (b) => b.length), 2);
  const h = await page.$eval('#talk .reply.folded', (r) => r.getBoundingClientRect().height);
  await page.click('#talk .more');
  assert.ok((await page.$eval(`#talk [data-id="${messages[1].id}"]`, (r) => r.getBoundingClientRect().height)) > h * 2, 'Show all unfolds it');
  // Turn 1 starts the day; turn 2 comes 1 h 57 min after it; turn 3 only 41 min after turn 2's end.
  assert.deepEqual(await page.$$eval('#talk .turn', (t) => t.map((x) => Boolean(x.dataset.time))), [true, true, false]);
  assert.match(await page.$eval('#talk .turn', (t) => t.dataset.time), /^\d\d:\d\d$/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('Find in today: every match marked, "3 of 3" newest first, Enter steps back, Escape closes', opts, async () => {
  const messages = [past(1, 'owner', 'Something calm for the evening', 40 * 60_000), past(2, 'mind', 'Calm piano, under Evening.', 39 * 60_000), past(3, 'owner', 'Calm again tomorrow', 10 * 60_000), past(4, 'mind', 'Noted.', 9 * 60_000)];
  const { page, context, errors } = await open({ chat: { messages } });
  await page.waitForSelector('#talk .reply');
  await page.evaluate(() => import('/th/reply/find.js').then((f) => f.openFind()));
  await page.waitForSelector('.findbar.in');
  await page.keyboard.type('calm');
  assert.equal(await page.textContent('.findbar .fcount'), '3 of 3');
  assert.equal(await page.evaluate(() => CSS.highlights.get('find').size), 3);
  await page.keyboard.press('Enter');
  assert.equal(await page.textContent('.findbar .fcount'), '2 of 3');
  await page.keyboard.type('zzz');
  assert.equal(await page.textContent('.findbar .fcount'), 'No match');
  await page.keyboard.press('Escape');
  assert.equal(await page.$('.findbar'), null);
  assert.equal(await page.evaluate(() => CSS.highlights.has('find')), false);
  assert.deepEqual(errors, []);
  await context.close();
});

test('what you were writing survives a reload, and goes once sent; a quiet order says what it will do first', opts, async () => {
  const { page, context, errors } = await open();
  await page.fill('#q', 'Half a thought about the');
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#talk', { state: 'attached' });
  assert.equal(await page.inputValue('#q'), 'Half a thought about the');
  assert.ok(await page.$eval('#ask', (a) => a.classList.contains('typing')), 'send shows, not the mic');
  await page.fill('#q', 'go quiet for 2 hours');
  assert.match(await page.textContent('#cmdhint'), /^Quiet until \d\d:\d\d\. No notifications until then\.$/);
  await page.fill('#q', 'Half a thought about the weekend');
  assert.equal(await page.textContent('#cmdhint'), '');
  // Sent and the draft gone in the same moment: the app may close right after.
  const kept = await page.evaluate(() => {
    /** @type {HTMLFormElement} */ (document.querySelector('#ask')).requestSubmit();
    return localStorage.getItem('th.p.draft');
  });
  assert.equal(kept, null, 'the draft goes with the send, not a tick later');
  await page.waitForSelector('#talk .you');
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#talk', { state: 'attached' });
  assert.equal(await page.inputValue('#q'), '', 'sent: no draft');
  assert.deepEqual(errors, []);
  await context.close();
});

test('an app opens growing from its chip; a chart reads out the column tapped', opts, async () => {
  const reply = { after: 200, text: 'Here is your week.', meta: { chip: { label: 'Open in Music', app: 'music', path: '/music/' }, blocks: [{ type: 'chart', kind: 'column', text: 'Minutes a day', labels: ['Mon', 'Tue', 'Wed'], series: [{ name: 'Minutes', values: [30, 20, 40] }], unit: 'min' }] } };
  const { page, context, errors } = await open({ chat: { reply, presence: { state: 'listening', note: null, since: Date.now() } } });
  await send(page, 'How was my week?');
  await page.waitForSelector('#talk .bchart rect');
  const box = await page.$eval('#talk .bchart svg', (s) => { const r = s.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  await page.mouse.click(box.x + box.w * 0.5, box.y + box.h * 0.8);
  assert.equal(await page.textContent('#talk .bread'), 'Tue: 20 min');
  assert.deepEqual(await page.$$eval('#talk .bchart rect', (r) => r.map((x) => x.classList.contains('on'))), [false, true, false]);
  await page.waitForSelector('#talk .chip.in');
  await page.click('#talk .chip');
  await page.waitForSelector('.launch');
  await page.waitForURL(`${base}/music/`);
  assert.deepEqual(errors, []);
  await context.close();
});

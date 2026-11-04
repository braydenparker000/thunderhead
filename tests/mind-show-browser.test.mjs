// Replies that show their work and the island line, in Chromium at 390×844 against the mocked
// Worker (tests/fixtures/mock-api.mjs): a reply with `meta.using` carries "How I got this", folded;
// a tap opens it to its chips, and a chip opens its place (a fact Memory at it, a day that day's
// conversation; a search only says). And `island.show`, run by home's verb loop, puts its line in
// the capsule while Music plays there; the next replaces it, its undo clears only its own, and
// opening the app takes it away. Set SHOTS=<dir> to keep the screenshots.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { API, mockApi, TOKEN } from './fixtures/mock-api.mjs';
import { until } from './fixtures/waits.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (mocked API)', timeout: 90_000 };
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

const FACT = '0192f0c4-0000-7000-8000-000000000001';
const DAY_THREAD = '0192f0c4-0000-7000-8000-000000000101'; // the mock's filed thread of 2026-10-28
const USING = [
  { kind: 'fact', id: FACT, label: 'Likes calm music in the evening' },
  { kind: 'song', id: '/music/', label: 'Evening' },
  { kind: 'day', id: '2026-10-28', label: 'Last Wednesday' },
  { kind: 'search', label: 'Songs for a slow evening' },
];
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/show-${name}.png` }); };

async function open(chat = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const api = await mockApi(page, { chat: { presence: { state: 'listening', note: null, since: Date.now() }, ...chat } });
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
  await page.waitForSelector('#ask .sendline', { state: 'attached' });
  return { page, context, errors, api };
}

test('a reply that drew on something carries "How I got this", folded; it opens to chips that open their places', opts, async () => {
  const { page, context, errors, api } = await open({ reply: { after: 200, text: 'Something slow from last week.', meta: { using: USING } } });
  await page.fill('#q', 'What should I play tonight');
  await page.press('#q', 'Enter');
  await page.waitForSelector('#talk .how.in');
  const fold = () => page.$eval('#talk .how', (h) => ({
    label: h.querySelector('.howt').textContent,
    expanded: h.querySelector('.howt').getAttribute('aria-expanded'),
    height: Math.round(h.querySelector('.howin').getBoundingClientRect().height),
    inert: h.querySelector('.howin').inert,
    chips: [...h.querySelectorAll('.wkchip')].map((c) => [c.tagName, c.textContent]),
  }));
  const folded = await fold();
  assert.deepEqual([folded.label, folded.expanded, folded.height, folded.inert], ['How I got this', 'false', 0, true]);
  await shot(page, 'fold-closed');
  await page.click('#talk .howt');
  await until(async () => (await fold()).height > 20, { message: 'the fold opens' });
  const opened = await fold();
  assert.equal(opened.expanded, 'true');
  assert.equal(opened.inert, false);
  // A search only says what was looked for: no tap.
  assert.deepEqual(opened.chips, [['BUTTON', 'Likes calm music in the evening'], ['BUTTON', 'Evening'], ['BUTTON', 'Last Wednesday'], ['SPAN', 'Songs for a slow evening']]);
  const box = await page.$eval('#talk .how', (h) => { const r = h.getBoundingClientRect(); return { left: r.left, right: r.right }; });
  assert.ok(box.left >= 16 && box.right <= 374, `inside the gutters: ${JSON.stringify(box)}`);
  await shot(page, 'fold-open');
  // A fact opens Settings › Memory at it.
  await page.evaluate(() => { window.opened = []; document.addEventListener('th:open', (e) => window.opened.push(e.detail)); });
  await page.click('#talk .how .wkchip >> nth=0');
  assert.deepEqual(await page.evaluate(() => window.opened), [{ name: 'memory', focus: FACT }]);
  await page.keyboard.press('Escape');
  // A day opens that day's conversation.
  await page.click('#talk .how .wkchip >> nth=2', { force: true });
  await until(() => api.calls.some((c) => c.call.startsWith(`GET /v1/threads/${DAY_THREAD}/messages`)), { message: "the day's conversation is read" });
  assert.deepEqual(errors, []);
  await context.close();
});

test('a reply that drew on nothing has no fold', opts, async () => {
  const { page, context, errors } = await open({ reply: { after: 200, text: 'Here it is.', meta: { using: [{ kind: 'tool', label: 'Bash' }] } } });
  await page.fill('#q', 'Anything new');
  await page.press('#q', 'Enter');
  await page.waitForSelector('#talk .reply');
  assert.equal(await page.$('#talk .how'), null, 'silence when there is no known chip');
  assert.deepEqual(errors, []);
  await context.close();
});

// A Music stand-in that reads as started and playing to the island (th/island/frames.js, island.js).
const MUSIC = `<!doctype html><title>Music</title><script>window.__cp={player:{audio:{paused:false,ended:false,duration:240,currentTime:30},track:{title:'An invented song',artist:'An invented band'},sleep:null}};</script>`;
const verb = (id, name, args) => ({ id, verb: name, schema: 1, ref: null, args, device_id: null, status: 'pending', proposal_id: null, created_at: Date.now(), expires_at: Date.now() + 86_400_000, result: null, error: null, ledger_id: null });

test('island.show: its line in the capsule while Music plays; replaced, undone only by its own clear, gone once Music opens', opts, async () => {
  const { page, context, errors, api } = await open();
  await page.route('**/music/**', (r) => r.fulfill({ contentType: 'text/html', body: MUSIC }));
  const island = (fn, ...a) => page.evaluate(([f, args]) => import('/th/island/island.js').then((m) => m[f](...args)), [fn, a]);
  const results = () => api.state.chat.results;
  const run = async (id, name, args) => {
    api.chat.verb(verb(id, name, args));
    return until(() => results().find((r) => r.id === id), { message: `${name} reported` });
  };
  const capsule = () => page.$eval('.th-island', (b) => ({ title: b.querySelector('.title').textContent, said: b.classList.contains('said'), say: b.querySelector('.say').textContent }));
  // Nothing plays in the island yet.
  assert.deepEqual(await run('v0', 'island.show', { text: 'A slow one for the evening.' }), { id: 'v0', ok: false, error: { code: 'not_playing', message: 'nothing plays in the island' } });
  assert.equal(await island('openApp', 'music'), true);
  await page.waitForFunction(() => document.querySelector('iframe.th-app[data-app=music]')?.dataset.ready === 'true');
  await page.goBack();
  await page.waitForSelector('.th-island:not([hidden])');
  await island('whenResting');
  const first = await run('v1', 'island.show', { text: 'A slower one next, for the drive home.' });
  assert.equal(first.ok, true);
  assert.equal(first.result.app, 'music');
  assert.deepEqual(first.undo, { verb: 'island.clear', schema: 1, args: { line: first.result.line } });
  await until(async () => (await capsule()).said, { message: 'the capsule says it' });
  assert.deepEqual(await capsule(), { title: 'A slower one next, for the drive home.', said: true, say: 'A slower one next, for the drive home.' });
  await shot(page, 'island-compact');
  await page.click('.th-island .compact');
  await island('whenResting');
  assert.equal(await page.locator('.th-island .say').isVisible(), true, 'expanded, the line sits in the top row');
  assert.equal(await page.textContent('.th-island .tt'), 'An invented song');
  await shot(page, 'island-expanded');
  await page.keyboard.press('Escape');
  await island('whenResting');
  // The next one replaces it; the first one's undo leaves the second standing.
  const second = await run('v2', 'island.show', { text: 'Then a brighter one.' });
  await until(async () => (await capsule()).title === 'Then a brighter one.', { message: 'replaced' });
  assert.deepEqual((await run('v3', 'island.clear', { line: first.result.line })).result, { cleared: false });
  assert.equal((await capsule()).title, 'Then a brighter one.');
  assert.deepEqual((await run('v4', 'island.clear', { line: second.result.line })).result, { cleared: true });
  await until(async () => (await capsule()).title === 'An invented song', { message: 'its undo clears it' });
  assert.equal((await capsule()).said, false);
  // Opening Music takes the line away: the capsule comes back with the song.
  await run('v5', 'island.show', { text: 'One more for the road.' });
  await until(async () => (await capsule()).said, { message: 'shown again' });
  assert.equal(await island('openApp', 'music'), true);
  await page.waitForSelector('.th-island', { state: 'hidden' });
  await page.goBack();
  await page.waitForSelector('.th-island:not([hidden])');
  await until(async () => (await capsule()).title === 'An invented song', { message: 'gone once Music opened' });
  assert.equal((await capsule()).said, false);
  assert.deepEqual(errors, []);
  await context.close();
});

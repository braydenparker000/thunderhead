// Settings › The mind's "How I talk" (shared/contract/voice.ts, frontend/apps/settings/mind-voice.js)
// in Chromium at 360 px wide against the mocked Worker: the voice page under the Name row, Save on
// only once it changes, too long said with its limit, saved with PUT /v1/mind/voice, the line of who
// changed it last, "Earlier versions" with their text and "Use this version" (a restore), and the
// Worker that can't answer said in words. Invented text only.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { API, mockApi, TOKEN } from './fixtures/mock-api.mjs';
import { VOICE_START } from './fixtures/mock-voice.mjs';
import { guardOpen, until } from './fixtures/waits.mjs';

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

/** Signed in at 360 px wide, on Settings › The mind once its settings are in. */
async function openMind(overrides = {}) {
  const context = await browser.newContext({ viewport: { width: 360, height: 780 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => { try { localStorage.setItem('th.p.sent', '1'); } catch {} });
  const mock = await mockApi(page, overrides);
  await page.goto(`${base}/no-such-page`);
  await page.evaluate((token) => new Promise((resolve) => { const req = indexedDB.open('th-auth', 1); req.onupgradeneeded = () => req.result.createObjectStore('kv'); req.onsuccess = () => { const tx = req.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put({ session_id: 's1', token, signed_in_at: Date.now(), username: 'example-owner' }, 'session'); tx.oncomplete = () => { req.result.close(); resolve(); }; }; }), TOKEN);
  await page.goto(`${base}/`, { waitUntil: 'load' });
  await page.waitForSelector('html[data-signed-in]');
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('th:open', { detail: { name: 'mind' } })));
  await page.waitForSelector('.spage.in .scatalog[data-group="mind"]:not([aria-busy])');
  await page.waitForFunction(() => { const p = document.querySelector('.spage'); return p && !p.classList.contains('moving') && !p.getAnimations().length; });
  await guardOpen(page);
  return { page, context, errors, mock };
}

const state = (page) => page.$eval('#voice-state', (n) => n.textContent);
const saveOff = (page) => page.$eval('[data-voice] button[type="submit"]', (b) => b.disabled);

test('the page under the Name row: edit, too long, save, and who changed it last', opts, async () => {
  const { page, context, errors, mock } = await openMind();
  await page.waitForFunction(() => !document.querySelector('#voice-page')?.disabled);
  const layout = await page.evaluate(() => {
    const section = document.querySelector('#mind-voice').closest('.group-section');
    const name = section.querySelector('[data-key="mind.name"]');
    return {
      title: section.querySelector('.group-title').textContent,
      nameFirst: Boolean(name && name.compareDocumentPosition(document.querySelector('#mind-voice')) & Node.DOCUMENT_POSITION_FOLLOWING),
      wide: [...section.querySelectorAll('*')].some((n) => n.getBoundingClientRect().right > innerWidth + 0.5),
      old: Boolean(document.querySelector('[data-key="mind.voice"], [data-key="mind.verbosity"]')),
    };
  });
  assert.deepEqual(layout, { title: 'How I talk', nameFirst: true, wide: false, old: false });
  assert.equal(await page.inputValue('#voice-page'), VOICE_START);
  assert.equal(await page.textContent('[data-last]'), 'Not changed yet. This is how I started.');
  assert.equal(await saveOff(page), true);
  await page.fill('#voice-page', 'x'.repeat(4001));
  assert.equal(await state(page), 'Too long: 4,001 of 4,000 characters.');
  assert.equal(await saveOff(page), true);
  await page.fill('#voice-page', 'Warm and plain.\nShort replies, a joke now and then.');
  assert.equal(await saveOff(page), false);
  await page.click('[data-voice] button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('#voice-state')?.textContent === 'Saved.');
  assert.deepEqual(mock.state.voice.puts, [{ text: 'Warm and plain.\nShort replies, a joke now and then.' }]);
  assert.match(await page.textContent('[data-last]'), /^Last changed by you, \d{1,2} \w{3}, \d\d:\d\d\.$/);
  assert.equal(await saveOff(page), true);
  assert.deepEqual(errors, []);
  await context.close();
});

test('earlier versions: open one, read it, use it again', opts, async () => {
  const versions = [
    { id: '0192f0c4-0000-7000-8000-000000000001', at: Date.parse('2026-11-18T08:00:00Z'), by: 'owner', why: null, text: 'Plain. Short.' },
    { id: '0192f0c4-0000-7000-8000-000000000002', at: Date.parse('2026-11-19T08:00:00Z'), by: 'mind', why: 'you asked for warmer replies', text: 'Warm. Short.' },
  ];
  const { page, context, errors, mock } = await openMind({ voice: { versions } });
  await page.waitForFunction(() => document.querySelector('#voice-page')?.value === 'Warm. Short.');
  assert.match(await page.textContent('[data-last]'), /^Last changed by me, 19 Nov, \d\d:\d\d: you asked for warmer replies$/);
  await page.click('[data-earlier] summary');
  const rows = await page.$$eval('[data-version] .row-copy', (r) => r.map((x) => x.textContent));
  assert.equal(rows.length, 2);
  assert.match(rows[0], /^19 Nov, \d\d:\d\d, by meyou asked for warmer replies$/);
  assert.match(rows[1], /^18 Nov, \d\d:\d\d, by youNo reason given\.$/);
  await page.click(`[data-version="${versions[0].id}"]`);
  await page.waitForSelector('[data-text]');
  assert.equal(await page.textContent('[data-text]'), 'Plain. Short.');
  await page.click('text=Use this version');
  await page.waitForFunction(() => document.querySelector('#voice-page')?.value === 'Plain. Short.');
  assert.equal(mock.state.voice.versions.length, 3);
  assert.match(await page.textContent('[data-last]'), /^Last changed by you, .*: an earlier version again$/);
  await until(async () => (await page.$$('[data-version]')).length === 3);
  assert.deepEqual(errors, []);
  await context.close();
});

test('when the Worker cannot answer, the page says so in words', opts, async () => {
  const { page, context } = await openMind({ voice: { fail: true } });
  await page.waitForFunction(() => document.querySelector('#voice-state')?.textContent !== 'Reading…');
  assert.notEqual(await state(page), '');
  assert.equal(await page.$eval('#voice-page', (a) => a.disabled), true);
  assert.equal(await saveOff(page), true);
  await context.close();
});

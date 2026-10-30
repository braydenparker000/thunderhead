// The night shift's tiles on the Briefing page in Chromium at 390×844 against the mocked Worker
// (BRIEFING.md §2, §4): after "Waiting on you", the study tile pairs with it as two halves, the
// built-overnight tile shows its big number, a note asked wide spans the row, and a tap opens a
// tile's place in its app. CSP violations are console errors, so the test also proves the page fits.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { API, mockApi, TOKEN } from './fixtures/mock-api.mjs';
import { briefingState } from './fixtures/mock-briefing.mjs';

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

const night = (slot, more) => ({ kind: 'night', slot, detail: null, big: null, wide: false, app: null, path: null, why: 'Because.', ...more });

test('night tiles: in order, halves paired, a big number, a wide note, a tap opens its place', opts, async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const state = briefingState();
  state.page.tiles.push(
    night('study', { label: 'Study', value: 'Book A, chapter 3', detail: 'p. 212 · 20 min', app: 'study', path: '/study/?book=b1&p=212' }),
    night('built', { label: 'Built overnight', value: 'A calm playlist', big: '31', detail: 'songs, ready in Music', app: 'music', path: '/music/#pl=calm123456' }),
    night('note.1', { label: 'Note', value: 'Bring the umbrella', wide: true }),
  );
  await mockApi(page, { briefing: state });
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
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('th:go', { detail: 'brief' })));
  await page.waitForSelector('#brief .tile.night');
  assert.deepEqual(await page.$$eval('#brief .grid > .tile', (ts) => ts.map((t) => [t.className, t.querySelector('.k').textContent, t.querySelector('.big')?.textContent ?? null, t.querySelector('.v')?.textContent])), [
    ['tile gold half', 'Waiting on you', null, 'Let Muse read your Board brief?'],
    ['tile half night', 'Study', null, 'Book A, chapter 3'],
    ['tile half night wide', 'Built overnight', '31', 'A calm playlist'],
    ['tile wide night', 'Note', null, 'Bring the umbrella'],
    ['tile wide board', 'The Board', null, 'Rain moves in, the market steadies'],
  ]);
  assert.equal(await page.locator('#brief .tile.night', { hasText: 'Note' }).evaluate((t) => t.tagName), 'DIV');
  await page.waitForTimeout(600);
  await page.locator('#brief .tile.night', { hasText: 'Study' }).click();
  await page.waitForURL(/\/study\/\?book=b1&p=212$/);
  assert.deepEqual(errors.filter((e) => !/study|pdf/i.test(e)), []);
  await context.close();
});

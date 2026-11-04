// The week's growth on the Briefing in Chromium at 390×844 against the mocked Worker (night step 13,
// BRIEFING.md "The growth note"): the practice and study tiles as the Worker writes them after
// "Waiting on you", each one sentence of counts under tomorrow's plan; a
// tap on Practice opens Guitar at the planned section and tempo, on Study the book at the next
// passage. CSP violations are console errors, so the test also proves the page fits.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { API, mockApi, TOKEN } from './fixtures/mock-api.mjs';
import { briefingState } from './fixtures/mock-briefing.mjs';
import { resting, until } from './fixtures/waits.mjs';

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

const night = (slot, more) => ({ kind: 'night', slot, detail: null, big: null, wide: false, why: 'The week in counts.', ledger_id: null, ...more });
const TILES = [
  night('practice', { label: 'Practice', value: 'Next: bars 9–12 at 92', detail: '3 sessions this week, 1 h, bars 9–12 up 8 bpm.', app: 'guitar', path: '/guitar/#play=s101&bars=8-11&bpm=92' }),
  night('study', { label: 'Study', value: 'Next: pp. 33–42', detail: '30 pages on 3 days, 30 min, 1 highlight.', app: 'study', path: '/study/?book=b1&p=41' }),
];

/** The Briefing open on a signed-in phone, with the two growth tiles. */
async function open() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const state = briefingState();
  state.page.tiles.push(...TILES);
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
  await page.waitForFunction(() => !document.querySelector('#brief').inert);
  await resting(page);
  return { context, page, errors };
}

test('the growth tiles: Practice and Study, one sentence each, inside the phone', opts, async () => {
  const { context, page, errors } = await open();
  assert.deepEqual(await page.$$eval('#brief .grid > .tile.night', (ts) => ts.map((t) => [t.className, t.querySelector('.k').textContent, t.querySelector('.v')?.textContent, t.querySelector('.s')?.textContent ?? null])), [
    ['tile half night', 'Practice', 'Next: bars 9–12 at 92', '3 sessions this week, 1 h, bars 9–12 up 8 bpm.'],
    ['tile half night wide', 'Study', 'Next: pp. 33–42', '30 pages on 3 days, 30 min, 1 highlight.'],
  ]);
  // Practice pairs with "Waiting on you"; Study, left without a partner, takes the row (§1's
  // packing). Each wholly inside the phone's width, neither clipping its sentence.
  const boxes = await page.$$eval('#brief .grid > .tile', (ts) => ts.map((t) => { const r = t.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, clip: t.scrollWidth > t.clientWidth + 1 }; }));
  assert.equal(boxes[0].y, boxes[1].y, 'Practice beside Waiting on you');
  for (const b of boxes) assert.ok(b.x >= 0 && b.right <= 390 && !b.clip, JSON.stringify(b));
  if (process.env.TH_SHOT) await page.screenshot({ path: process.env.TH_SHOT, fullPage: false });
  assert.deepEqual(errors, []);
  await context.close();
});

test('a tap on Practice opens Guitar at the planned section; on Study, the book at the next passage', opts, async () => {
  const one = await open();
  // Guitar rewrites its address once the reader opens, so the address the tap went to is kept.
  const went = [];
  one.page.on('framenavigated', (f) => { if (f === one.page.mainFrame()) went.push(f.url()); });
  await one.page.locator('#brief .tile.night', { hasText: 'Practice' }).click();
  await until(() => went.some((u) => new URL(u).pathname === '/guitar/'));
  assert.equal(went.find((u) => new URL(u).pathname === '/guitar/'), `${base}/guitar/#play=s101&bars=8-11&bpm=92`);
  await one.context.close();
  const two = await open();
  await two.page.locator('#brief .tile.night', { hasText: 'Study' }).click();
  await two.page.waitForURL(/\/study\/\?book=b1&p=41$/);
  await two.context.close();
});

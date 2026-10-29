// The Briefing page and the Board reader (BRIEFING.md §1–§5) in Chromium at 390×844 against the
// mocked Worker (tests/fixtures/mock-briefing.mjs): "Waiting on you" (gold, a tap goes home) and
// the Board tile last; the reader's cover, "In 30 seconds", every v2 block type drawn, numbered
// sources with https links only, a tag kept as text, "Ask about this" filling the ask bar, Back
// closing it; and the quiet page with nothing to show. Day and night, no errors, no sideways
// scroll. SHOTS=<dir> keeps screenshots.
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

async function open({ theme = 'light', briefing } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block', timezoneId: 'UTC' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript((t) => { try { localStorage.setItem('th-theme', t); } catch {} }, theme);
  const api = await mockApi(page, briefing === undefined ? {} : { briefing });
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
  await page.waitForTimeout(500);
  return { page, context, errors, api };
}
const shot = async (page, name, theme) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-${theme === 'light' ? 'day' : 'night'}.png` }); };

test('the Briefing shows what waits and the Board; the reader draws every block, sources as https links, tags as text', opts, async () => {
  for (const theme of ['light', 'dark']) {
    const { page, context, errors } = await open({ theme });
    await page.waitForSelector('#brief .tile.board');
    assert.equal(await page.textContent('#brief .btitle .ln'), "Here's your day.");
    assert.deepEqual(await page.$$eval('#brief .grid > .tile', (t) => t.map((x) => [x.className, x.querySelector('.v').textContent])), [
      ['tile gold half wide', 'Let Muse read your Board brief?'],
      ['tile wide board', 'Rain moves in, the market steadies'],
    ]);
    assert.equal(await page.textContent('#brief .bmuse'), 'Muse is connected to the new Worker.');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 0, 'no sideways scroll');
    await shot(page, 'briefing', theme);
    await page.click('#brief .tile.board');
    await page.waitForSelector('.boardr .bstory');
    assert.equal(await page.textContent('.boardr .bcover h1'), 'Rain moves in, the market steadies');
    assert.match(await page.textContent('.boardr .bfrom'), /from Muse$/);
    assert.deepEqual(await page.$$eval('.boardr .bquick li', (l) => l.map((x) => x.textContent)), ['Three wet days start tomorrow.', 'The monthly figure is flat.']);
    const kinds = await page.$$eval('.boardr .bb', (b) => b.map((x) => x.className.replace('bb b-', '')));
    assert.deepEqual(kinds, ['prose', 'stats', 'chart', 'timeline', 'quote', 'callout', 'chart', 'comparison', 'perspectives', 'explanation', 'agenda']);
    assert.equal(await page.$$eval('.boardr .bchart svg rect', (r) => r.length), 3);
    assert.equal(await page.$$eval('.boardr .bchart svg polyline', (r) => r.length), 1);
    assert.equal(await page.textContent('.boardr .b-prose .bcite'), '[1]');
    await page.click('.boardr .btabs button:nth-child(2)');
    assert.equal(await page.textContent('.boardr .btabp'), 'Rates may stay put.');
    assert.deepEqual(await page.$$eval('.boardr .bsrc a', (a) => a.map((x) => x.getAttribute('href'))), ['https://example.com/forecast', 'https://example.com/model', 'https://example.com/stats']);
    assert.equal(await page.$('#app img'), null, 'a tag in a source is text');
    assert.equal(await page.title(), 'Thunderhead');
    await page.evaluate(() => { document.querySelector('.boardr').scrollTop = 0; });
    await page.waitForTimeout(350);
    await shot(page, 'board', theme);
    await page.evaluate(() => document.querySelector('.boardr .bstory.c-data')?.scrollIntoView());
    await shot(page, 'board-data', theme);
    // Back closes the reader; "Ask about this" fills the ask bar on home.
    await page.goBack();
    await page.waitForFunction(() => !document.querySelector('.boardr'));
    await page.click('#brief .tile.board');
    await page.waitForSelector('.boardr .bask');
    await page.click('.boardr .bask');
    await page.waitForFunction(() => !document.querySelector('.boardr'));
    assert.equal(await page.inputValue('#q'), 'About the Board story “Rain moves in after a dry month”: ');
    assert.deepEqual(errors, []);
    await context.close();
  }
});

test('with nothing to show, the page is quiet and says what comes later', opts, async () => {
  const quiet = { page: { day: '2026-10-29', title: 'A quiet day.', tiles: [], board: null, muse: null } };
  const { page, context, errors } = await open({ briefing: quiet });
  await page.waitForFunction(() => document.querySelector('#brief .btitle .ln')?.textContent === 'A quiet day.');
  assert.equal(await page.$$eval('#brief .grid > *', (t) => t.length), 0);
  assert.equal(await page.textContent('#brief .bmuse'), 'Weather, practice, study and what I built overnight come with a later update.');
  assert.deepEqual(errors, []);
  await context.close();
});

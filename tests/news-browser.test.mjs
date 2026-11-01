// What's new (th/news/news.js): after an update, home shows one card by the ask bar with the release's
// few lines (/whats-new.json), once per release on this phone; "Got it" folds it for good, a line's
// button opens its app, and lines older than 14 days show nothing. In Chromium at phone size against
// the mock Worker; no network.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { due } from '../frontend/th/news/news.js';
import { API, mockApi, TOKEN } from './fixtures/mock-api.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (mocked API)' };
const NEWS = JSON.parse(await readFile(new URL('../frontend/whats-new.json', import.meta.url), 'utf8'));
let server, browser, base;
before(async () => {
  if (live) return;
  server = await serve(0, { api: API });
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => { await browser?.close(); server?.close(); });

test('the release notes file: an id, a date, at most four short lines, apps by their ids', () => {
  assert.match(NEWS.id, /^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/);
  assert.ok(Number.isFinite(Date.parse(NEWS.date)));
  assert.ok(NEWS.lines.length >= 1 && NEWS.lines.length <= 4);
  for (const l of NEWS.lines) {
    assert.ok(l.text.length <= 120, l.text);
    if (l.open) assert.match(l.open, /^[a-z]+$/);
  }
});

test('when a card is due: a new id, fresh lines', () => {
  const now = Date.parse('2026-11-02T12:00:00Z');
  const n = { id: 'a', date: '2026-11-01', lines: [{ text: 'x' }] };
  assert.equal(due(n, null, now), true);
  assert.equal(due(n, 'a', now), false, 'seen');
  assert.equal(due({ ...n, date: '2026-10-10' }, null, now), false, 'over 14 days old');
  assert.equal(due({ ...n, lines: [] }, null, now), false);
  assert.equal(due(null, null, now), false);
});

/** Home signed in at phone size, with `news` as /whats-new.json (date: today). */
async function home(context, news) {
  const page = await context.newPage();
  await mockApi(page, {});
  await page.route('**/whats-new.json', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(news) }));
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
  await page.goto(`${base}/`);
  await page.waitForFunction(() => document.querySelector('#ask'));
  return page;
}

test('once per release: the card shows its lines by the bar, Got it folds it for good', opts, async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const news = { ...NEWS, date: new Date().toISOString().slice(0, 10) };
  let page = await home(context, news);
  const card = page.locator('#turns .card.news');
  await card.waitFor({ timeout: 10_000 });
  assert.deepEqual(await card.locator('li').evaluateAll((li) => li.length), news.lines.length);
  assert.match(await card.locator('.why').textContent(), /New in this update/);
  // The whole card shows, Got it included (a card is otherwise cut at 280 px).
  const fits = await card.evaluate((c) => { const b = c.querySelector('button.yes').getBoundingClientRect(), r = c.getBoundingClientRect(); return b.bottom <= r.bottom && c.scrollHeight <= c.clientHeight + 1; });
  assert.ok(fits, 'Got it is inside the card');
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
  await card.locator('button.yes').click();
  await page.waitForFunction(() => !document.querySelector('#turns .card.news'));
  await page.close();
  // Opened again: nothing; a new release's lines: a card again.
  page = await home(context, news);
  await page.waitForTimeout(2500);
  assert.equal(await page.locator('#turns .card.news').count(), 0);
  await page.close();
  page = await home(context, { ...news, id: `${news.id}-2` });
  await page.locator('#turns .card.news').waitFor({ timeout: 10_000 });
  await context.close();
});

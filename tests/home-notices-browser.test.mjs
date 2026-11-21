// Home's security notices while it is open (SIGN-IN.md §10.1, §11.4), in Chromium at 390×844 against
// the mocked Worker: a `notice` change in the feed makes home read /v1/auth/me again, so a reset
// requested elsewhere shows its card within seconds, and a notice answered on another phone folds.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { API, mockApi, TOKEN } from './fixtures/mock-api.mjs';
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

const ME = { session_id: 's1', label: 'Android phone · Chrome', recovery_confirmed: true };
const PENDING = { id: 'n-reset', kind: 'reset_pending', created_at: Date.now(), expires_at: null, about_session_id: null, args: { ticket_id: '0192f0c4-0000-7000-8000-0000000000bb', usable_after: Date.now() + 86_400_000 } };

test('a notice change shows a new card on open home, and folds one answered elsewhere', opts, async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(() => { try { localStorage.setItem('th.p.sent', '1'); } catch {} });
  const api = await mockApi(page, { me: () => [200, { ...ME, notices: [] }] });
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
  api.chat.notice(); // the feed has a past (a change before home opened; seq 0 means "never loaded")
  await page.goto(`${base}/`, { waitUntil: 'load' });
  await guardOpen(page);
  const mes = () => api.calls.filter((c) => c.call === 'GET /v1/auth/me').length;
  await until(() => mes() === 1 && api.chat.state.sockets.length > 0, { message: 'home read /me once and joined the live channel' });
  assert.equal(await page.locator('#turns .card.notice').count(), 0);

  // A reset requested from the GitHub path: Auth writes one `notice` change.
  api.state.me = () => [200, { ...ME, notices: [PENDING] }];
  api.chat.notice();
  await until(async () => (await page.locator('#turns .card.notice:not(.gone)').count()) === 1, { message: 'the reset card showed' });
  assert.match(await page.locator('#turns .card.notice .q').innerText(), /Someone asked to reset your password/);
  assert.equal(await page.locator('#edge').evaluate((e) => e.classList.contains('gold')), true);

  // The same list again adds nothing; the reset cancelled on another phone folds the card.
  api.chat.notice();
  await until(() => mes() === 3, { message: 'home read /me again' });
  assert.equal(await page.locator('#turns .card.notice').count(), 1);
  api.state.me = () => [200, { ...ME, notices: [] }];
  api.chat.notice();
  await until(async () => (await page.locator('#turns .card.notice').count()) === 0, { message: 'the card folded' });
  assert.equal(await page.locator('#edge').evaluate((e) => e.classList.contains('gold')), false);
  assert.deepEqual(errors, []);
  await context.close();
});

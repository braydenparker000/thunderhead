// The owner's time zone (th/chat/zone.js): the Worker keeps days, quiet hours, the night and the
// backups in `owner.tz`, and until 2026-11-01 nothing set it (the deploy's default, UTC). Home sends
// this phone's zone when the Worker's differs, once per load, and nothing when they agree.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { API, mockApi, TOKEN } from './fixtures/mock-api.mjs';

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

/** Home on a phone in `zone`, signed in. */
async function open(zone) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', timezoneId: zone });
  const page = await context.newPage();
  const api = await mockApi(page, {});
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
  await page.waitForTimeout(1500);
  return { context, page, api };
}

const patches = (api) => api.calls.filter((c) => c.call === 'PATCH /v1/settings' && c.body && 'owner.tz' in c.body);

test("a phone in another zone than the Worker's sends its own, once", opts, async () => {
  const { context, page, api } = await open('Asia/Kolkata');
  // The phone's own name for it (Chromium may canonicalize to the older "Asia/Calcutta").
  const here = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  assert.deepEqual(patches(api).map((c) => c.body), [{ 'owner.tz': here }]);
  // Another pass over the settings (a reconnect) sends nothing more.
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForTimeout(800);
  assert.equal(patches(api).length, 1);
  await context.close();
});

test('a phone in the same zone sends nothing', opts, async () => {
  const { context, api } = await open('UTC');
  assert.equal(patches(api).length, 0);
  await context.close();
});

test('an alias of the same zone is the same zone', opts, async () => {
  const { context, page } = await open('Asia/Kolkata');
  assert.deepEqual(await page.evaluate(() => import('/th/chat/zone.js').then((m) => [
    m.sameZone(Intl.DateTimeFormat().resolvedOptions().timeZone, 'Asia/Kolkata'),
    m.sameZone('UTC', 'Asia/Kolkata'),
    m.sameZone('UTC', 'Not/AZone'),
  ])), [true, false, false]);
  await context.close();
});

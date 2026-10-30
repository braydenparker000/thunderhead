// The share sheet in Chromium against the mocked Worker (manifest `share_target`, IDEAS.md HM3): a
// link shared from another app opens /share/, which puts "Shared: …" in the ask bar (the title, the
// text without its link, then the link) and leaves the address at "/"; nothing is sent until the
// owner sends it. Android often puts the link inside `text`; it is found there too.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

test('the manifest offers the share target as GET /share/ with title, text and url', () => {
  const m = JSON.parse(readFileSync(new URL('../frontend/manifest.webmanifest', import.meta.url), 'utf8'));
  assert.deepEqual(m.share_target, { action: '/share/', method: 'GET', params: { title: 'title', text: 'text', url: 'url' } });
});

test('a shared link waits in the ask bar for the owner’s words', opts, async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const api = await mockApi(page);
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
  const share = new URLSearchParams({ title: 'A talk on rivers', text: 'Worth an evening https://video.example/watch?v=abc123' });
  await page.goto(`${base}/share/?${share}`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelector('#q')?.value.startsWith('Shared:'));
  assert.equal(await page.inputValue('#q'), 'Shared: A talk on rivers · Worth an evening https://video.example/watch?v=abc123 ');
  assert.equal(new URL(page.url()).pathname + new URL(page.url()).search, '/');
  await page.waitForTimeout(400);
  assert.deepEqual(api.calls.filter((c) => /^(PUT|POST) \/v1\/messages/.test(c.call)), [], 'nothing sent by itself');
  assert.ok(api.calls.some((c) => c.call === 'GET /v1/auth/me'), 'the mock saw the page start');
  assert.deepEqual(errors, []);
  await context.close();
});

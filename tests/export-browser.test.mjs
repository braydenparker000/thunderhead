// Settings → Export (MENU-AND-SETTINGS.md §4.9) in Chromium at 390×844 against the mocked Worker
// (tests/fixtures/mock-export.mjs): the row in the menu, the password asked again (a wrong one
// says so), the bar while everything is gathered, the ZIP saved to the phone with one tap, the
// last automatic backup line, and coming back to an export still building. Day and night, no
// errors (CSP violations are console errors), no sideways scroll. SHOTS=<dir> keeps screenshots.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { API, mockApi, TOKEN } from './fixtures/mock-api.mjs';
import { EXPORT_ID } from './fixtures/mock-export.mjs';

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

async function open({ theme = 'light', exportState } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block', timezoneId: 'UTC', acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 401/.test(m.text())) errors.push(m.text()); });
  await page.addInitScript((t) => { try { localStorage.setItem('th-theme', t); } catch {} }, theme);
  const api = await mockApi(page, exportState ? { export: exportState } : {});
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
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('th:go', { detail: 'side' })));
  await page.waitForTimeout(450);
  return { page, context, errors, api };
}
const shot = async (page, name, theme) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-${theme === 'light' ? 'day' : 'night'}.png` }); };

test('Export: the password again, the bar, then one tap saves the ZIP; the last backup is shown', opts, async () => {
  for (const theme of ['light', 'dark']) {
    const { page, context, errors, api } = await open({ theme });
    assert.equal(await page.textContent('[data-open="export"] .t'), 'Export');
    await page.click('[data-open="export"]');
    await page.waitForSelector('.spage[aria-label="Export"] .xport .btn');
    assert.equal(await page.textContent('.xport .btn'), 'Download everything');
    await page.waitForFunction(() => /^Last automatic backup: Sunday 03:20/.test(document.querySelector('.spage .sbody > .shelp:last-child')?.textContent ?? ''));
    await shot(page, 'export', theme);
    // The password again: a wrong one says so and asks again.
    await page.click('.xport .btn');
    await page.waitForSelector('.xport #current-password');
    await page.fill('#current-password', 'not it');
    await page.click('.xport button[type="submit"]');
    await page.waitForFunction(() => document.querySelector('.xport .line')?.textContent?.length > 0 && document.querySelector('.xport .line')?.className === 'line');
    assert.ok(api.calls.some((c) => c.call === 'POST /v1/export' && c.body.password === 'not it'));
    await page.fill('#current-password', 'right password here');
    await page.click('.xport button[type="submit"]');
    await page.waitForSelector('.xport .xbar');
    assert.match(await page.textContent('.xport .xstat'), /^Gathering everything… \d+%$/);
    await shot(page, 'export-building', theme);
    await page.waitForSelector('.xport .btn:not([type="submit"])', { timeout: 10_000 });
    await page.waitForFunction(() => document.querySelector('.xport .btn')?.textContent === 'Download (2.3 MB)');
    assert.equal(await page.textContent('.xport .shelp'), 'The link works for an hour, on this phone only.');
    await shot(page, 'export-ready', theme);
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('.xport .btn')]);
    assert.equal(download.suggestedFilename(), 'thunderhead-export-2026-10-29.zip');
    await page.waitForFunction(() => document.querySelector('.xport .xstat')?.textContent === 'Saved to this phone.');
    const zip = api.calls.find((c) => c.call === `GET /v1/export/${EXPORT_ID}/zip`);
    assert.equal(zip.auth, `Bearer ${TOKEN}`, 'the download carries this device sign-in');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 0, 'no sideways scroll');
    assert.deepEqual(errors, []);
    await context.close();
  }
});

test('Export: leaving and coming back finds the export still building; a failed one offers it again', opts, async () => {
  const state = { started: false, polls: 0, readyAfter: 1_000, failed: false, backups: [] };
  const { page, context, errors } = await open({ exportState: state });
  await page.click('[data-open="export"]');
  await page.waitForSelector('.xport .btn');
  assert.match(await page.textContent('.spage .sbody > .shelp:last-child'), /^Automatic backups run every Sunday at 02:30/);
  await page.click('.xport .btn');
  await page.fill('#current-password', 'right password here');
  await page.click('.xport button[type="submit"]');
  await page.waitForSelector('.xport .xbar');
  // Back to the menu and in again: still building, without asking for the password.
  await page.click('.spage .sback');
  await page.waitForTimeout(400);
  await page.click('[data-open="export"]');
  await page.waitForSelector('.spage[aria-label="Export"] .xport .xbar');
  state.failed = true;
  await page.waitForFunction(() => document.querySelector('.xport .line')?.textContent === "Couldn't gather everything. Try again.", null, { timeout: 10_000 });
  assert.equal(await page.textContent('.xport .btn'), 'Download everything');
  assert.deepEqual(errors, []);
  await context.close();
});

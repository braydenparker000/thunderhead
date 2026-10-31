// The Briefing's weather tile in Chromium at 390×844 against the mocked Worker (BRIEFING.md §2, §7):
// with no place it reads "Set a place for the weather"; its sheet takes a town's name (an unknown
// one says so), and once kept the tile shows the place, the temperature big and the sentence, and
// its sheet the next 12 hours and tomorrow's high and low. CSP violations are console errors, so the
// test also proves the page fits its CSP. Set SHOTS=<dir> to keep screenshots of the tile and sheet.
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

test('the weather tile asks for a place, keeps one, and shows the next hours', opts, async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 422/.test(m.text())) errors.push(m.text()); });
  const noPlace = { place: null, temp: null, detail: 'Set a place for the weather', as_of: null, hours: [], tomorrow: null };
  await mockApi(page, { briefing: { page: { day: '2026-10-30', title: 'A quiet day.', weather: noPlace, tiles: [], muse: null } } });
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
  const tile = page.locator('#brief .tile.weather');
  await tile.waitFor();
  assert.deepEqual(await tile.evaluate((t) => [t.querySelector('.k').textContent, t.querySelector('.big'), t.querySelector('.s').textContent]), ['Weather', null, 'Set a place for the weather']);
  await page.waitForTimeout(600);
  await tile.click();
  const sheet = page.locator('.wsheet');
  await sheet.waitFor();
  assert.equal(await sheet.locator('h2').textContent(), 'Set a place for the weather');
  await sheet.locator('#wplace').fill('Nowhere');
  await sheet.locator('button', { hasText: 'Save' }).click();
  await page.waitForFunction(() => document.querySelector('.wsheet .line')?.textContent === 'No place by that name.');
  await sheet.locator('#wplace').fill('Testville');
  await sheet.locator('button', { hasText: 'Save' }).click();
  await sheet.waitFor({ state: 'detached' });
  await page.waitForFunction(() => document.querySelector('#brief .tile.weather .big')?.textContent === '19°');
  assert.deepEqual(await tile.evaluate((t) => [t.querySelector('.k').textContent, t.querySelector('.s').textContent, t.className]), ['Testville', 'Rain from 15:00 to 18:00.', 'tile wide weather']);
  await page.waitForTimeout(600);
  await tile.click();
  await sheet.waitFor();
  assert.equal(await sheet.locator('h2').textContent(), 'Testville');
  assert.equal(await sheet.locator('.whours li').count(), 12);
  assert.match(await sheet.locator('.whours li').nth(6).textContent(), /^\d\d:\d\d1[5-8]°80%$/);
  assert.equal(await sheet.locator('p.shelp').textContent(), 'Tomorrow: high 21°, low 10°');
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/weather-sheet.png` });
  await page.keyboard.press('Escape');
  await sheet.waitFor({ state: 'detached' });
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/weather-tile.png` });
  assert.deepEqual(errors, []);
  await context.close();
});

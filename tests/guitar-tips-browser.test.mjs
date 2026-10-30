// Guitar tips per section (frontend/th/guitar/teacher.js; GUITAR.md §6) in the real reader: the
// synthetic practice score opens, each section label says it has tips, and tapping one opens that
// section's tips (a hint, whose approach, "Show me" for the concrete step) without moving the tab.
// The tab file comes from a stubbed old Worker; no network.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (stubbed tab source)' };
const OLD = 'https://jarvis-hub-api.braydenparker999.workers.dev';
const GP = readFileSync(new URL('./fixtures/guitar/practice.gp', import.meta.url));
let site, browser, base;

before(async () => {
  if (live) return;
  site = await serve(0, {});
  base = `http://127.0.0.1:${site.address().port}`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => {
  await browser?.close();
  site?.close();
});

test('a section label opens its tips: a hint, its approach, and the step behind "Show me"', opts, async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route(`${OLD}/**`, (route) =>
    route.request().url().includes('gprotab/file')
      ? route.fulfill({ status: 200, contentType: 'application/octet-stream', body: GP })
      : route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"none"}' }),
  );
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/guitar/#play=${encodeURIComponent('g:jarvis-test/practice-song')}`);
  const intro = page.locator('.rd-section', { hasText: 'Intro' }).first();
  await intro.waitFor({ timeout: 30_000 });
  assert.equal(await intro.getAttribute('aria-label'), 'Tips for Intro');
  assert.match(await intro.textContent(), /Intro · tips/);
  const verse = page.locator('.rd-section', { hasText: 'Verse' }).first();
  await verse.click();
  await page.locator('.sheet .th-tip').first().waitFor();
  assert.equal(await page.locator('.sheet-head h2').textContent(), 'Verse: tips');
  const hints = await page.locator('.sheet .th-tip p').allTextContents();
  assert.ok(hints.length >= 1 && hints.length <= 3, JSON.stringify(hints));
  assert.ok(hints.some((h) => /barre/i.test(h)), JSON.stringify(hints));
  for (const a of await page.locator('.sheet .th-tip small').allTextContents()) assert.ok(a.length > 5);
  await page.locator('.sheet .th-tip button', { hasText: 'Show me' }).first().click();
  assert.equal(await page.locator('.sheet .th-tip p').count(), hints.length + 1);
  assert.deepEqual(errors, []);
  await context.close();
});

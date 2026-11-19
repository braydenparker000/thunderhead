// What the main Settings took from Astra's (MENU-AND-SETTINGS.md §6, 2026-11-19), in Chromium at 390×844
// against the mocked Worker: a search field that finds a setting by a word of the line under it, usable
// in place; Motion's new Off, which stops even what keeps its own clock; Haptics Off silent; and
// Reset this page, which puts back that page's settings and no other's.
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

async function open(init = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((extra) => {
    try {
      if (!sessionStorage.getItem('seeded')) {
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem('th.p.sent', '1');
        localStorage.setItem('th-theme', 'light');
        for (const [k, v] of Object.entries(extra)) localStorage.setItem(k, v);
      }
    } catch {}
  }, init);
  await mockApi(page, {});
  await page.goto(`${base}/no-such-page`);
  await page.evaluate((token) => new Promise((resolve) => { const req = indexedDB.open('th-auth', 1); req.onupgradeneeded = () => req.result.createObjectStore('kv'); req.onsuccess = () => { const tx = req.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put({ session_id: 's1', token, signed_in_at: Date.now(), username: 'example-owner' }, 'session'); tx.oncomplete = () => { req.result.close(); resolve(); }; }; }), TOKEN);
  await page.goto(`${base}/`, { waitUntil: 'load' });
  await page.waitForSelector('html[data-signed-in]');
  return { page, context, errors };
}

async function show(page, name) {
  await page.evaluate((n) => document.dispatchEvent(new CustomEvent('th:open', { detail: { name: n } })), name);
  await page.waitForSelector(`.spage.in .scatalog[data-group="${name}"]:not([aria-busy])`);
  await page.waitForFunction(() => { const p = document.querySelector('.spage'); return p && !p.classList.contains('moving') && !p.getAnimations().length; });
}

const stored = (page, key) => page.evaluate((k) => localStorage.getItem(`th.s.${k}`), key);

test('the search finds a setting by a word of its line and it works where it is found', opts, async () => {
  const { page, context, errors } = await open();
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('th:open', { detail: { name: 'settings' } })));
  await page.waitForSelector('.spage.in .ssearch input');
  await page.fill('.ssearch input', 'battery');
  await page.waitForSelector('.sresults [data-key="appearance.glass"]');
  assert.equal(await page.$eval('.spage.in .slink', (r) => r.closest('[hidden]') !== null), true, "Settings' own rows step aside");
  await page.click('.sresults [data-key="appearance.glass"] [data-v="flat"]');
  assert.equal(await stored(page, 'appearance.glass'), 'flat');
  assert.equal(await page.getAttribute('html', 'data-glass'), 'flat');
  await page.fill('.ssearch input', '');
  assert.equal(await page.$eval('.spage.in .slink', (r) => r.closest('[hidden]') === null), true);
  assert.deepEqual(errors, []);
  await context.close();
});

test("Motion Off stops even the field's drift, which Reduced leaves running; Haptics Off is silent", opts, async () => {
  const running = async (motion) => {
    const { page, context, errors } = await open({ 'th.s.appearance.motion': motion, 'th.s.appearance.haptics': 'off' });
    await page.waitForTimeout(1000);
    const got = await page.evaluate(async () => {
      const m = await import('/th/motion.js');
      let buzzed = 0;
      m.configureMotion({ vibrate: () => { buzzed++; } });
      m.haptic('commit');
      return { level: document.documentElement.dataset.motionLevel, drift: document.getAnimations().filter((a) => a.playState === 'running' && a.animationName === 'drift').length, buzzed, page: getComputedStyle(document.documentElement).getPropertyValue('--d-page').trim() };
    });
    assert.deepEqual(errors, []);
    await context.close();
    return got;
  };
  assert.deepEqual(await running('off'), { level: 'off', drift: 0, buzzed: 0, page: '0ms' });
  const reduced = await running('always');
  assert.equal(reduced.level, 'reduced');
  assert.ok(reduced.drift > 0, "Reduced keeps the drift (only the phone's own setting stills it)");
});

test("Reset this page puts back that page's settings and no other's", opts, async () => {
  const { page, context, errors } = await open({ 'th.s.appearance.glass': 'flat', 'th.s.appearance.corners': 'round', 'th.s.chat.density': 'compact' });
  await show(page, 'appearance');
  await page.click('.spage.in [data-action="reset"]');
  await page.click('.sheet button:has-text("Reset")');
  await page.waitForFunction(() => localStorage.getItem('th.s.appearance.glass') === null);
  assert.deepEqual([await stored(page, 'appearance.glass'), await stored(page, 'appearance.corners'), await stored(page, 'chat.density')], [null, null, 'compact']);
  assert.equal(await page.getAttribute('html', 'data-glass'), null);
  assert.deepEqual(errors, []);
  await context.close();
});

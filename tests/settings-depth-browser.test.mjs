// Settings that the shell honours (MENU-AND-SETTINGS.md §6, 2026-11-04), in Chromium at 390×844
// against the mocked Worker: an Appearance choice changes the tokens at once and is there again
// before the first paint after a reload (ui/theme.js holds the catalogue's list of attributes);
// Reduced motion and Haptics reach th/motion.js; compact turns, Dictation off, the island as a bar or
// off; and the ring in the owner's order, Photos kept last, built again when the order changes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { SETTINGS } from '../shared/contract/settings.ts';
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
const tokens = (page) => page.evaluate(() => { const c = getComputedStyle(document.documentElement); return { r: c.getPropertyValue('--r-l').trim(), fill: c.getPropertyValue('--accent-fill').trim() }; });

test('ui/theme.js applies every catalogue attribute before the first paint', () => {
  const theme = readFileSync(new URL('../frontend/ui/theme.js', import.meta.url), 'utf8');
  const listed = [...theme.matchAll(/\['([a-z_.]+)', '(data-[a-z-]+)'\]/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(listed, SETTINGS.filter((s) => s.scope === 'phone' && s.attr).map((s) => [s.key, s.attr]));
});

test('an Appearance choice applies at once and survives a reload; motion and haptics follow', opts, async () => {
  const { page, context, errors } = await open();
  const before = await tokens(page);
  await show(page, 'appearance');
  await page.click('[data-key="appearance.corners"] [data-v="round"]');
  await page.click('[data-key="appearance.accent"] [data-v="vivid"]');
  await page.click('[data-key="appearance.glass"] [data-v="flat"]');
  await page.click('[data-key="appearance.motion"] [data-v="always"]');
  await page.click('[data-key="appearance.haptics"] [data-v="off"]');
  const after1 = await tokens(page);
  assert.deepEqual([before.r, after1.r, after1.fill], ['22px', '26px', '#1a5cf0'], 'the radius and accent tokens move at once');
  await page.screenshot({ path: new URL('../.deploy/settings-depth-appearance.png', import.meta.url).pathname });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('html[data-signed-in]');
  assert.deepEqual(await tokens(page), after1, 'the same after a reload');
  const got = await page.evaluate(async () => {
    const m = await import('/th/motion.js');
    let buzzed = 0;
    m.configureMotion({ vibrate: () => { buzzed++; } });
    m.haptic('open');
    return { reduced: m.motionReduced(), buzzed, blur: getComputedStyle(document.querySelector('#ask')).backdropFilter, dur: getComputedStyle(document.documentElement).getPropertyValue('--d-base').trim() };
  });
  assert.deepEqual(got, { reduced: true, buzzed: 0, blur: 'none', dur: '0ms' }, 'reduced motion on, no taps back, no blur');
  assert.deepEqual(errors, []);
  await context.close();
});

test('compact turns, Dictation off and the island as a bar or off', opts, async () => {
  const { page, context, errors } = await open({ 'th.s.chat.density': 'compact', 'th.s.chat.mic': 'false', 'th.s.island.mode': 'bar' });
  const got = await page.evaluate(() => {
    const t = Object.assign(document.createElement('div'), { className: 'turn' });
    document.querySelector('#turns').append(t, t.cloneNode());
    const island = Object.assign(document.createElement('div'), { className: 'th-island' });
    document.body.append(island);
    const shown = (s) => getComputedStyle(document.querySelector(s)).display !== 'none' && getComputedStyle(document.querySelector(s)).opacity === '1';
    return { gap: getComputedStyle(document.querySelectorAll('#turns .turn')[1]).marginTop, mic: shown('#mic'), send: shown('.ask .send'), bar: Math.round(island.getBoundingClientRect().width) };
  });
  assert.deepEqual(got, { gap: '12px', mic: false, send: true, bar: 366 });
  await page.evaluate(() => document.documentElement.setAttribute('data-island', 'off'));
  assert.equal(await page.evaluate(async () => (await import('/th/island/island.js')).openApp('music')), false, 'off: Music opens as its own page');
  assert.deepEqual(errors, []);
  await context.close();
});

test('the ring goes in the owner’s order with Photos last, and follows a change at once', opts, async () => {
  const { page, context, errors } = await open({ 'th.s.gestures.ring_apps': JSON.stringify(['study', 'music']), 'th.s.appearance.glyphs': 'outline' });
  const ring = () => page.$$eval('#ring .pet', (p) => p.map((x) => [x.title, x.querySelector('use').getAttribute('href').split('#')[1]]));
  assert.deepEqual(await ring(), [['Study', 'book-bookmark'], ['Music', 'music-notes-simple'], ['Photos', 'aperture']]);
  await page.evaluate(() => /** @type {HTMLElement} */ (document.querySelector('.skips [data-skip="apps"]')).click());
  await page.waitForSelector('#ring.show', { state: 'attached' });
  await page.waitForFunction(() => [...document.querySelectorAll('#ring .pet')].every((p) => !p.getAnimations().length));
  await page.screenshot({ path: new URL('../.deploy/settings-depth-ring.png', import.meta.url).pathname });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#ring.show'));
  await show(page, 'gestures');
  await page.click('[data-key="gestures.ring_apps"] [data-item="study"] [data-act="arrow-down"]');
  await page.click('[data-key="gestures.ring_apps"] [data-item="guitar"] [data-act="plus"]');
  assert.deepEqual((await ring()).map(([n]) => n), ['Music', 'Study', 'Guitar', 'Photos']);
  assert.deepEqual(errors, []);
  await context.close();
});

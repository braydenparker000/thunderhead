// Music in home's frame with the keyboard up (th/island/island.js keyboardOverApp, music/src/ui/viewport-top.js;
// MUSIC.md §5.10), in Chromium against a mock new Worker, the frame showing the demo songs. Headless
// Chromium has no keyboard, so the test plays the phone's: what Chrome does with home's viewport ask at
// the moment the field takes focus. With `resizes-content` the whole page shrinks (the window resized,
// as the phone did: 731 → 424); with `resizes-visual` only the visual viewport shrinks. Checked:
// - while Music is in front home asks for `resizes-visual`, and its own ask comes back when Music leaves;
// - no resize reaches Music's window when search takes the keyboard;
// - the results list ends above the keyboard (its last row reachable there) and the player opens at full height;
// - the phone's bar: home's window goes 731 → 759 → 731 around the keyboard (its bar hides while the keyboard
//   is up) and the app's frame keeps the settled window's height in px, so Music's window gets no resize
//   (th/island/hold-height.js); a height that lasts 300 ms with no keyboard is a real change and moves it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { until } from './fixtures/waits.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (mocked API)', timeout: 120_000 };
const OLD = 'https://jarvis-hub-api.braydenparker999.workers.dev';
const TOKEN = `th1_${'K'.repeat(43)}abcdef`;
const H = 844, KEYBOARD_TOP = 460;
let site, mock, browser, base;

before(async () => {
  if (live) return;
  mock = createServer((req, res) => {
    const cors = { 'Access-Control-Allow-Origin': req.headers.origin ?? '*', Vary: 'Origin' };
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...cors, 'Access-Control-Allow-Methods': 'GET, POST, PUT', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-None-Match, TH-Client' });
      return res.end();
    }
    const url = new URL(req.url, 'http://x');
    const answers = {
      '/v1/music/catalog': { version: 1, kind: 'r2-library', complete: true, count: 0, generatedAt: '2026-11-01T00:00:00.000Z', tracks: [] },
      '/v1/auth/me': { session_id: 's1', notices: [], recovery_confirmed: true },
      '/v1/threads/today': { thread: null, messages: [], seq: 1, day: new Date().toISOString().slice(0, 10) },
      '/v1/settings': { 'owner.tz': 'UTC', 'mind.status': { state: 'asleep', note: null, since: null } },
      '/v1/surfaces': { items: [], seq: 1 }, '/v1/verbs/pending': { items: [] },
      '/v1/proposals': { items: [] }, '/v1/changes': { items: [], next_after: 1, more: false },
    };
    res.writeHead(url.pathname in answers ? 200 : 404, { ...cors, 'Content-Type': 'application/json' });
    res.end(JSON.stringify(answers[url.pathname] ?? { error: { code: 'not_found', message: 'no', request_id: 't' } }));
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  site = await serve(0, { api: `http://127.0.0.1:${mock.address().port}` });
  base = `http://127.0.0.1:${site.address().port}`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => { await browser?.close(); site?.close(); mock?.close(); });

test('the keyboard over Music in home: no resize reaches its window, the list ends above it, the player at full height', opts, async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: H }, serviceWorkers: 'allow' });
  await context.route(`${OLD}/**`, (route) => route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
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
  const ask = () => page.evaluate(() => /interactive-widget=([a-z-]+)/.exec(document.querySelector('meta[name=viewport]').content)?.[1]);
  assert.equal(await ask(), 'resizes-content', 'home alone: its chat rides the keyboard');
  assert.equal(await page.evaluate(() => import('/th/island/island.js').then((m) => m.openApp('music'))), true);
  assert.equal(await ask(), 'resizes-visual', 'Music in front: the keyboard does not resize the frame');
  await page.waitForFunction(() => document.querySelector('iframe.th-app[data-app=music]')?.dataset.ready === 'true', null, { timeout: 30_000 });
  // The demo songs in the same frame (no library here).
  await page.evaluate(() => { const w = document.querySelector('iframe.th-app').contentWindow; w.__leaving = true; w.location.href = '/music/?demo'; });
  await page.waitForFunction(() => { const w = document.querySelector('iframe.th-app').contentWindow; return !w.__leaving && w.__cp?.player?.queue?.length === 4 && w.__cp.ctx.listWidget; }, null, { timeout: 30_000 });

  // Each resize of Music's window, counted in the frame; search takes the field.
  await page.evaluate(() => {
    const w = document.querySelector('iframe.th-app').contentWindow;
    w.__resizes = 0;
    w.addEventListener('resize', () => w.__resizes++);
    w.__cp.ctx.bus.post('bus_gui', 'cmd_nav_to_search');
  });
  const inFrame = (fn, arg) => page.evaluate(([f, a]) => new Function('w', 'a', `return (${f})(w, a)`)(document.querySelector('iframe.th-app').contentWindow, a), [fn.toString(), arg]);
  await until(() => inFrame((w) => w.document.activeElement?.classList.contains('cp-search-input') && !w.__cp.ctx.topNav.scenes.running), { message: 'search never took the field' });
  // Results to scroll: every demo song and its album and artist rows hold an "a".
  await inFrame((w) => w.__cp.ctx.bus.post('list', 'cmd_list_search_text', null, { string: 'a' }));
  await until(() => inFrame((w) => [...w.__cp.ctx.listWidget.libList.active.keys()].some((i) => i >= 0)), { message: 'no results' });

  // The phone's keyboard, as Chrome applies home's ask now.
  if ((await ask()) === 'resizes-content') await page.setViewportSize({ width: 390, height: KEYBOARD_TOP });
  else await page.evaluate((top) => {
    const vv = window.visualViewport;
    Object.defineProperty(vv, 'height', { configurable: true, get: () => top });
    vv.dispatchEvent(new Event('resize'));
  }, KEYBOARD_TOP);
  await until(() => inFrame((w, top) => w.__cp.ctx.viewportHeight <= top, KEYBOARD_TOP), { message: 'the list never took the space above the keyboard' });
  const up = await inFrame((w) => {
    const l = w.__cp.ctx.listWidget.libList;
    l.scrollTo(l.maxScroll());
    const rows = [...l.active.entries()].filter(([i]) => i >= 0).sort((a, b) => a[0] - b[0]);
    const last = rows.at(-1)?.[1].el.getBoundingClientRect();
    return { resizes: w.__resizes, innerH: w.innerHeight, listBottom: Math.round(l.el.getBoundingClientRect().bottom), lastBottom: last ? Math.round(last.bottom) : null };
  });
  assert.equal(up.resizes, 0, 'no resize reached Music');
  assert.equal(up.innerH, H, 'Music\'s window keeps its height');
  assert.ok(up.listBottom <= KEYBOARD_TOP, `the list ends above the keyboard (${up.listBottom})`);
  assert.ok(up.lastBottom !== null && up.lastBottom <= KEYBOARD_TOP, `its last row is above the keyboard (${up.lastBottom})`);

  // To the player with the keyboard up: full height at once.
  const player = await inFrame((w) => {
    w.__cp.ctx.bus.post('bus_gui', 'cmd_nav_to_main');
    return { layoutH: w.__cp.ctx.viewportHeight, playerH: Math.round(w.__cp.ctx.topNav.el.getBoundingClientRect().height) };
  });
  assert.deepEqual({ layoutH: player.layoutH, full: player.playerH >= H }, { layoutH: H, full: true });

  // Music leaves the front: home's own ask comes back.
  await page.evaluate(() => { delete window.visualViewport.height; return import('/th/island/island.js').then((m) => m.close()); });
  assert.equal(await ask(), 'resizes-content', 'home\'s chat rides the keyboard again');
  assert.deepEqual(errors, []);
  await context.close();
});

test("the phone's bar around the keyboard: the frame keeps the settled height, Music's window gets no resize", opts, async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 731 }, serviceWorkers: 'allow' });
  await context.route(`${OLD}/**`, (route) => route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
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
  assert.equal(await page.evaluate(() => import('/th/island/island.js').then((m) => m.openApp('music'))), true);
  await page.waitForFunction(() => document.querySelector('iframe.th-app[data-app=music]')?.dataset.ready === 'true', null, { timeout: 30_000 });
  const frameH = () => page.evaluate(() => document.querySelector('iframe.th-app').contentWindow.innerHeight);
  assert.equal(await frameH(), 731);
  await page.evaluate(() => {
    const w = document.querySelector('iframe.th-app').contentWindow;
    w.__resizes = 0;
    w.addEventListener('resize', () => w.__resizes++);
  });
  // The settle checks home has run (each 300 ms after the window last changed), to wait on one.
  const checks = () => page.evaluate(() => Number(document.querySelector('.th-app-shell')?.dataset.heightChecks ?? 0));

  // The keyboard comes up (home's visual viewport 424) and the bar hides: home's window 759.
  let seen = await checks();
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport, 'height', { configurable: true, get: () => 424 });
    window.visualViewport.dispatchEvent(new Event('resize'));
  });
  await page.setViewportSize({ width: 390, height: 759 });
  await until(async () => (await checks()) > seen, { message: 'home never checked the height after the keyboard came up' });
  // The keyboard goes and the bar comes back: 731.
  seen = await checks();
  await page.evaluate(() => { delete window.visualViewport.height; window.visualViewport.dispatchEvent(new Event('resize')); });
  await page.setViewportSize({ width: 390, height: 731 });
  await until(async () => (await checks()) > seen, { message: 'home never checked the height after the keyboard went' });
  assert.deepEqual({ resizes: await page.evaluate(() => document.querySelector('iframe.th-app').contentWindow.__resizes), innerH: await frameH() }, { resizes: 0, innerH: 731 });

  // A real change (a height that lasts with no keyboard): the frame follows it.
  seen = await checks();
  await page.setViewportSize({ width: 390, height: 759 });
  await until(async () => (await checks()) > seen && (await frameH()) === 759, { message: 'the frame never took a lasting height' });
  assert.deepEqual(errors, []);
  await context.close();
});

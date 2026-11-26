// Music's start and its screens built ahead (view/prebuild.js, list/list-widget.js prepareLibrary,
// ui/startup.js; MUSIC.md §5.11), the demo songs in Chromium: before any tap the library's start rows
// are bound and laid out hidden and the navbar's lines scene is built; the first trip to the library
// shows those same rows (none bound again in its frames); the lyrics page is not built at start; the
// recorder names the start-up's steps. Local only; no network.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { until } from './fixtures/waits.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (the demo songs)', timeout: 120_000 };
let site, browser, base;

before(async () => {
  if (live) return;
  site = await serve(0, {});
  base = `http://127.0.0.1:${site.address().port}`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => { await browser?.close(); site?.close(); });

test('the library\'s start rows and the navbar\'s lines are built before the first tap, and the library shows those rows', opts, async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // The classic layout (?home1): its category home is the start built ahead whose rows are compared.
  await page.goto(`${base}/music/?demo&home1`);
  await page.waitForFunction(() => window.__cp?.ctx?.prebuilt?.done, null, { timeout: 60_000 });
  const ahead = await page.evaluate(() => {
    const { ctx } = window.__cp, lw = ctx.listWidget, ll = lw.libList, bar = ctx.navbar.container();
    window.__rows = new Map([...ll.active].filter(([i]) => i >= 0));
    return { prepared: !!lw.preparedLib && ll.source === lw.preparedLib, hidden: ll.visibility, rows: window.__rows.size, bound: [...window.__rows.values()].every((v) => v.el.isConnected && v.width > 0),
      lyrics: lw._lyricsPage, navbar: bar.built?.has('scene_navbar_3lines') ?? false };
  });
  assert.deepEqual({ ...ahead, rows: ahead.rows > 0 }, { prepared: true, hidden: 8, rows: true, bound: true, lyrics: null, navbar: true });

  // The first trip to the library: the rows on screen are the ones built ahead.
  await page.evaluate(() => {
    const { ctx } = window.__cp;
    window.__binds = 0;
    for (const v of window.__rows.values()) { const b = v.bind.bind(v); v.bind = (...a) => { if (a[0] !== v.track) window.__binds++; return b(...a); }; }
    ctx.bus.post('bus_gui', 'cmd_list_to_start');
    ctx.bus.post('bus_gui', 'cmd_nav_to_lib');
  });
  await until(() => page.evaluate(() => { const lw = window.__cp.ctx.listWidget; return lw.mode === 'list' && !lw.trans && !window.__cp.ctx.topNav.scenes.running; }), { message: 'the library never settled' });
  const shown = await page.evaluate(() => {
    const ll = window.__cp.ctx.listWidget.libList, now = [...ll.active].filter(([i]) => i >= 0);
    return { same: now.every(([i, v]) => window.__rows.get(i) === v), binds: window.__binds, lyrics: window.__cp.ctx.listWidget._lyricsPage };
  });
  assert.deepEqual(shown, { same: true, binds: 0, lyrics: null });

  // The recorder: the start-up's steps, in order, and its long tasks named by step.
  const s = await page.evaluate(() => window.__cp.ctx.feelLog.report().startup);
  assert.deepEqual(s.steps.map((x) => x.name).slice(0, 9), ['modules', 'worker', 'boot', 'model', 'theme', 'inflate', 'library', 'restore', 'ready']);
  assert.ok(s.longTasks.every((t) => typeof t.during === 'string'));
  assert.deepEqual(errors, []);
  await context.close();
});

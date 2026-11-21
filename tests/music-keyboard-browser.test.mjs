// Music in Chromium at phone size (frontend/music/, the demo songs: no audio, no network), with the
// keyboard emulated as home's frame passes it on (the window resized while the search field has focus):
// - the search list takes each new height in the frame of the resize, once per keyboard change: a step
//   above the full height (844 → 872 → 460, like the phone's 731 → 759 → 424) is one relayout;
// - leaving search for the player with the keyboard up blurs the field and the player lays out at
//   the full height at once; the keyboard closing after costs no relayout (ui/layout-height.js);
// - play and pause asked before a frame leave one button showing at full size, and the recorder notes
//   no missing button (view/scene.js, ui/feel-log.js).
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
after(async () => {
  await browser?.close();
  site?.close();
});

test('the keyboard: one relayout per change, the player at full height, play and pause always shown', opts, async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/music/?demo`);
  await page.waitForFunction(() => window.__cp?.player?.queue?.length === 4 && !!window.__cp.ctx.feelLog, null, { timeout: 30_000 });

  // In the page: each layout the app makes now, and each resize as the app has laid it out (a listener
  // added after the app's runs after it, in the same event).
  await page.evaluate(() => {
    const { ctx } = window.__cp, px = (v) => Math.round(v.el.getBoundingClientRect().height);
    window.__seen = { layouts: 0, resizes: [], navs: [] };
    const now = ctx.layoutNow.bind(ctx);
    ctx.layoutNow = () => { window.__seen.layouts++; now(); };
    addEventListener('resize', () => window.__seen.resizes.push({ innerH: innerHeight, layoutH: ctx.viewportHeight, listH: px(ctx.listWidget.libList) }));
    ctx.bus.subscribe('bus_gui', (m, s, d) => {
      if (m === 'msg_nav_changed') window.__seen.navs.push({ nav: d.nav, field: document.activeElement?.tagName === 'INPUT', layoutH: ctx.viewportHeight, playerH: px(ctx.topNav) });
    });
    ctx.bus.post('bus_gui', 'cmd_nav_to_search');
  });
  await until(() => page.evaluate(() => document.activeElement?.classList.contains('cp-search-input') && !window.__cp.ctx.topNav.scenes.running), { message: 'search never took the keyboard' });

  // The keyboard opens in two steps, the first above the full height.
  await page.setViewportSize({ width: 390, height: 872 });
  await until(() => page.evaluate(() => window.__seen.resizes.length === 1));
  await page.setViewportSize({ width: 390, height: 460 });
  await until(() => page.evaluate(() => window.__seen.resizes.length === 2));
  const open = await page.evaluate(() => window.__seen);
  assert.deepEqual(open.resizes.map((r) => r.layoutH), [844, 460], 'the step above the full height is not taken');
  assert.equal(open.layouts, 1, 'one relayout for the keyboard');
  assert.equal(open.resizes[1].listH <= 460 && open.resizes[1].listH > 0, true, `the list fits the new height in the resize's frame (${open.resizes[1].listH})`);

  // To the player with the keyboard up: the field lets go, the player is laid out at the full height.
  await page.evaluate(() => window.__cp.ctx.bus.post('bus_gui', 'cmd_nav_to_main'));
  const nav = await page.evaluate(() => window.__seen.navs.at(-1));
  assert.deepEqual({ ...nav, playerH: nav.playerH >= 844 }, { nav: 'nav_main', field: false, layoutH: 844, playerH: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await until(() => page.evaluate(() => window.__seen.resizes.length === 3));
  assert.equal(await page.evaluate(() => window.__seen.layouts), 2, 'the keyboard closing costs no relayout');
  await until(() => page.evaluate(() => !window.__cp.ctx.topNav.scenes.running), { message: 'the player never settled' });

  // Play and pause before a frame, then play: one button at full size, nothing missing.
  await page.evaluate(() => { const p = window.__cp.player; p.play(); p.pause(); });
  assert.equal(await page.evaluate(() => window.__cp.ctx.topNav.scenes.running), null, 'turned back before it moved: settled at once');
  await page.evaluate(() => window.__cp.player.play());
  await until(() => page.evaluate(() => window.__cp.ctx.feelLog.buttons.some((b) => b.playing && b.buttons)), { message: 'no button check after play' });
  const report = await page.evaluate(() => window.__cp.ctx.feelLog.report());
  const last = report.playPauseButton.at(-1);
  assert.ok(last.buttons.some((b) => b.visible && Math.max(b.w, b.h) >= 52), `a button shows at full size: ${JSON.stringify(last.buttons)}`);
  assert.deepEqual(report.playPauseMissing, []);
  assert.deepEqual(errors, []);
  await context.close();
});

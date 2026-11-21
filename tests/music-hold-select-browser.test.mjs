// Music in Chromium at phone size (frontend/music/, the demo songs: no audio, no network):
// - a hold on a song row (450 ms) does what the Select button does: selection mode with that row
//   selected and one haptic tick; it neither plays the song nor opens a menu; a hold that moves is a
//   scroll and selects nothing (MUSIC.md §2.6);
// - the movement and layout recorder (ui/feel-log.js, MUSIC.md §5.10) records transitions, player
//   opens, the play/pause button after play/pause and the search viewport, and "Copy report" carries
//   it under `movement` with no song's words in it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { outlast, until } from './fixtures/waits.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (the demo songs)', timeout: 120_000 };
/** The demo queue's words (frontend/music/src/dev/demo.js): none may be in the report. */
const WORDS = ['Northern Lights', 'Glass Harbor', 'Low Tide', 'Paper Satellites', 'The Quiet Hours', 'Orbit Songs'];
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

test('a hold on a song selects it like Select; the recorder reports numbers only', opts, async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    window.__buzz = 0;
    navigator.vibrate = () => { window.__buzz++; return true; };
  });
  await page.goto(`${base}/music/?demo`);
  await page.waitForFunction(() => window.__cp?.player?.queue?.length === 4 && !!window.__cp.ctx.feelLog, null, { timeout: 30_000 });

  // The Queue list (four songs) on screen.
  await page.evaluate(async () => {
    const { ctx, player } = window.__cp;
    const { categorySource } = await import('/music/src/list/sources.js');
    player.enqueue([player.queue[1], player.queue[2], player.queue[3]]);
    ctx.bus.post('bus_gui', 'cmd_nav_to_lib');
    const lw = ctx.listWidget;
    lw.openHome();
    lw.open(categorySource(ctx, lw.libList, lw.nav, { id: 10, title: 'queue', icon: '?queue', kind: 'queue' }));
  });
  await page.waitForFunction(() => { const lw = window.__cp.ctx.listWidget; return lw.mode === 'list' && !lw.trans && lw.libList.active.has(2); }, null, { timeout: 15_000 });
  const center = (i) => page.evaluate((k) => {
    const v = window.__cp.ctx.listWidget.libList.active.get(k), r = v.el.getBoundingClientRect();
    return { x: r.left + r.width * 0.4, y: r.top + r.height / 2, hold: v.longPressMs };
  }, i);
  const state = () => page.evaluate(() => {
    const { ctx, player } = window.__cp, l = ctx.listWidget.libList;
    return { selecting: !!l.selection, selected: [...(l.selection ?? [])], index: player.index, playing: player.state, menu: !!ctx.listWidget.menuItem, buzz: window.__buzz };
  });
  const start = await state();

  // Hold row 1: selection mode with row 1 selected, one tick; the release plays nothing.
  const row = await center(1);
  assert.equal(row.hold, 450, 'a row is held for 450 ms');
  await page.mouse.move(row.x, row.y);
  await page.mouse.down();
  await until(async () => (await state()).selecting, { message: 'the hold never selected' });
  await page.mouse.up();
  await outlast(page, 100);
  assert.deepEqual(await state(), { ...start, selecting: true, selected: [1], buzz: 1 });
  await page.waitForFunction(() => window.__cp.ctx.listState?.state_list_selection_count === 1);

  // Out of selection; a hold that moves 30 px is a scroll: nothing selected, no tick.
  await page.evaluate(() => window.__cp.ctx.listWidget.libList.setSelectionMode(false));
  const two = await center(2);
  await page.mouse.move(two.x, two.y);
  await page.mouse.down();
  await page.mouse.move(two.x, two.y - 30, { steps: 6 });
  await outlast(page, 600);
  await page.mouse.up();
  await outlast(page, 100);
  assert.deepEqual(await state(), { ...start, buzz: 1 });

  // The recorder: back to the player, play, search, back.
  await page.evaluate(() => window.__cp.ctx.bus.post('bus_gui', 'cmd_nav_to_main'));
  await until(() => page.evaluate(() => window.__cp.ctx.feelLog.opens.length > 0), { message: 'no player open recorded' });
  await page.evaluate(() => window.__cp.player.play());
  await until(() => page.evaluate(() => window.__cp.ctx.feelLog.buttons.some((b) => b.playing && b.buttons)), { message: 'no button check after play' });
  await page.evaluate(() => window.__cp.ctx.bus.post('bus_gui', 'cmd_nav_to_search'));
  await until(() => page.evaluate(() => window.__cp.ctx.feelLog.search?.listH != null), { message: 'search not followed' });
  await page.evaluate(() => window.__cp.ctx.bus.post('bus_gui', 'cmd_nav_to_main'));
  await until(() => page.evaluate(() => window.__cp.ctx.feelLog.searches.length === 1), { message: 'search not recorded' });
  await until(() => page.evaluate(() => window.__cp.ctx.feelLog.runs.length > 0 && !window.__cp.ctx.feelLog.running.size), { message: 'no transition recorded' });

  const text = await page.evaluate(async () => {
    let copied = '';
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => { copied = t; } }, configurable: true });
    await window.__cp.ctx.playbackLog.copy(null);
    return copied;
  });
  const m = JSON.parse(text).movement;
  assert.equal(m.version, 1);
  const open = m.playerOpens.at(-1);
  assert.equal(open.innerH, 844);
  assert.equal(typeof open.inputFocus, 'boolean');
  assert.ok(open.playerH > 0, 'the player has a box');
  const pause = m.playPauseButton.find((b) => b.playing && b.buttons).buttons.find((b) => b.id === 'pause');
  assert.deepEqual([pause.inDom, pause.visible, pause.w > 0, pause.h > 0], [true, true, true, true], 'the pause button shows while playing');
  assert.equal(m.search[0].before.innerH, 844);
  assert.ok(m.search[0].listH > 0, 'the results list has a height');
  assert.ok(m.transitions.every((t) => /^[a-z0-9:._>-]+$/.test(t.name) && t.runs >= 1 && Number.isFinite(t.worstGap)), 'transitions are names and numbers: ' + JSON.stringify(m.transitions));
  for (const w of WORDS) assert.ok(!JSON.stringify(m).includes(w), `the report holds no song words (${w})`);
  assert.deepEqual(errors, []);
  await context.close();
});

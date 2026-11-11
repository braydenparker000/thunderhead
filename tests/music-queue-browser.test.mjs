// The Queue list in the real player, in Chromium at phone size (frontend/music/): its selection
// menu is the reference's own for the Queue (Delete works, Clear Queue is there), Delete takes the
// selected entries out, a tap on an entry plays the Queue from it, and Clear Queue empties it.
// The demo songs (?demo) play on a virtual clock: no audio, no network.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

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

test('the Queue list: Delete removes the selected entries, a tap plays from an entry, Clear Queue empties it', opts, async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/music/?demo`);
  await page.waitForFunction(() => window.__cp?.player?.queue?.length === 4, null, { timeout: 30_000 });
  const queued = () => page.evaluate(() => window.__cp.player.entries.map((e) => e.track.title));
  const shown = () => page.evaluate(() => { const l = window.__cp.ctx.listWidget.libList; return { rows: l.source.count, kind: l.source.kind, selecting: !!l.selection }; });

  // Four entries (one song twice), and the Queue list open.
  await page.evaluate(async () => {
    const { ctx, player } = window.__cp;
    const { categorySource } = await import('/music/src/list/sources.js');
    player.enqueue([player.queue[1], player.queue[2], player.queue[3], player.queue[1]]);
    ctx.bus.post('bus_gui', 'cmd_nav_to_lib');
    const lw = ctx.listWidget;
    lw.openHome();
    lw.open(categorySource(ctx, lw.libList, lw.nav, { id: 10, title: 'queue', icon: '?queue', kind: 'queue' }));
  });
  // The library has slid in (the list is the screen's own once its transition ends).
  await page.waitForFunction(() => { const lw = window.__cp.ctx.listWidget; return lw.mode === 'list' && !lw.trans; }, null, { timeout: 15_000 });
  assert.deepEqual(await shown(), { rows: 4, kind: 'queue', selecting: false });

  // Selection mode on the second entry: Delete is offered, and the menu is the Queue's own.
  await page.evaluate(() => { const l = window.__cp.ctx.listWidget.libList; l.setSelectionMode(true); l.toggleSelected(1); });
  await page.waitForFunction(() => document.body.innerText.includes('Clear Queue'), null, { timeout: 10_000 });
  assert.equal(await page.evaluate(() => window.__cp.ctx.listState.state_list_can_delete), true);
  await page.evaluate(() => window.__cp.ctx.bus.post('list', 'cmd_list_delete_dialog'));
  await page.waitForFunction(() => window.__cp.player.entries.length === 3);
  assert.deepEqual(await queued(), ['Paper Satellites', 'A Very Long Song Title That Does Not Fit On One Line', 'Paper Satellites']);
  await page.waitForFunction(() => window.__cp.ctx.listWidget.libList.source.count === 3);
  assert.deepEqual(await shown(), { rows: 3, kind: 'queue', selecting: false }, 'the list follows and selection mode ends');

  // A tap on the second entry: the Queue plays from it, and Next goes on to the third.
  await page.evaluate(() => window.__cp.ctx.listWidget.libList.source.onItemClick(1));
  const playing = await page.evaluate(() => { const p = window.__cp.player; const at = [p.queueMode, p.index, p.track.title]; p.step(1); return [...at, p.index, p.track.title]; });
  assert.deepEqual(playing, [true, 1, 'A Very Long Song Title That Does Not Fit On One Line', 2, 'Paper Satellites']);

  // Clear Queue from the selection menu: only the playing entry stays.
  await page.evaluate(() => { const { ctx } = window.__cp; ctx.bus.post('bus_gui', 'cmd_nav_to_lib'); const l = ctx.listWidget.libList; l.setSelectionMode(true); ctx.bus.post('list', 'cmd_list_clear_q'); });
  await page.waitForFunction(() => window.__cp.player.entries.length === 1);
  assert.deepEqual(await queued(), ['Paper Satellites']);
  assert.equal((await shown()).selecting, false);
  assert.deepEqual(errors, []);
  await context.close();
});

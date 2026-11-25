// Up next and History in the real player, in Chromium at phone size (frontend/music/, owner
// 2026-11-25): the playing song's menu (its three dots) opens Up next over the player with its three
// sections; a swipe left takes a Next up row out and Undo puts it back in its place; Clear empties
// Next up and Undo brings it back; a drag on a row's handle reorders; Back closes the window. A
// song that sounds 10 s is in History, and a tap there plays it. The demo songs (?demo, invented)
// play on a virtual clock: no audio, no network.
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

test('Up next: three sections, swipe out and Undo, Clear and Undo, reorder, Back; History plays a song heard', opts, async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/music/?demo`);
  await page.waitForFunction(() => window.__cp?.player?.queue?.length === 4 && window.__cp.ctx.listWidget?.items?.get(0), null, { timeout: 30_000 });
  await page.waitForTimeout(500);
  const queued = () => page.evaluate(() => window.__cp.player.nextUp().map((e) => e.track.title));
  /** Taps a view: the cover's three dots ('cover-menu'), the window's Clear ('clear'), else a view by id. */
  const tap = async (what) => {
    const c = await page.evaluate((what) => {
      const { ctx } = window.__cp;
      let v = null;
      if (what === 'cover-menu') v = ctx.listWidget.items.get(0)?.findViewById('menu');
      else if (what === 'clear') {
        for (const row of ctx.dialogs.at(-1).list.active.values()) { const b = row.findViewById('line2'); if (b && b.visibility === 0 && b.text === 'Clear') v = b; }
      } else v = ctx.root.findViewById(what);
      if (!v) return null;
      const a = v.getLocationIn(null);
      return { x: a.x + v.width / 2, y: a.y + v.height / 2 };
    }, what);
    assert.ok(c, `nothing to tap: ${what}`);
    await page.mouse.click(c.x, c.y);
  };
  /** The window's rows: index, title, and where each is. */
  const rows = () => page.evaluate(() => {
    const list = window.__cp.ctx.dialogs?.at(-1)?.list;
    if (!list) return [];
    return [...list.active].filter(([i]) => i >= 0).sort((a, b) => a[0] - b[0]).map(([i, v]) => {
      const a = v.getLocationIn(null), h = v.findViewById('drag_handler');
      const ha = h && h.visibility === 0 ? h.getLocationIn(null) : null;
      return { i, title: v.findViewById('title')?.text ?? v.findViewById('item_empty_list_text')?.text, x: a.x + v.width / 2, y: a.y + v.height / 2, w: v.width, handle: ha && { x: ha.x + h.width / 2, y: ha.y + h.height / 2 } };
    });
  });
  const settle = () => page.waitForTimeout(600);

  // Three songs queued by hand, the menu opened by the cover's three dots.
  await page.evaluate(() => { const p = window.__cp.player; p.enqueue([p.queue[1], p.queue[2], p.queue[3]]); });
  await tap('cover-menu');
  await page.waitForFunction(() => { const v = window.__cp.ctx.root.findViewById('queue_up_next'); return v && v.visibility === 0 && v.width > 0; }, null, { timeout: 10_000 });
  await settle();
  await tap('queue_up_next');
  await page.waitForFunction(() => window.__cp.ctx.dialogs?.length === 1 && window.__cp.ctx.dialogs[0].list?.active.size > 4, null, { timeout: 10_000 });
  await settle();

  // Now playing, Next up and Then.
  let r = await rows();
  const titles = r.map((x) => x.title);
  assert.deepEqual(titles.slice(0, 6), ['Now playing', 'Northern Lights', 'Next up', 'Paper Satellites', 'Saltwater Static', 'A Very Long Song Title That Does Not Fit On One Line']);
  assert.ok(titles[6]?.startsWith('Then'), `then section: ${titles[6]}`);
  assert.ok(r.slice(3, 6).every((x) => x.handle), 'Next up rows have their drag handle');

  // A swipe left takes Saltwater Static out; Undo puts it back where it was.
  const row = r.find((x) => x.title === 'Saltwater Static');
  await page.mouse.move(row.x + 100, row.y);
  await page.mouse.down();
  for (let k = 1; k <= 12; k++) { await page.mouse.move(row.x + 100 - k * 25, row.y + 1); await page.waitForTimeout(16); }
  await page.mouse.up();
  await page.waitForFunction(() => window.__cp.player.nextUp().length === 2);
  assert.deepEqual(await queued(), ['Paper Satellites', 'A Very Long Song Title That Does Not Fit On One Line']);
  await settle();
  await tap('undo_action');
  await page.waitForFunction(() => window.__cp.player.nextUp().length === 3);
  assert.deepEqual(await queued(), ['Paper Satellites', 'Saltwater Static', 'A Very Long Song Title That Does Not Fit On One Line']);
  await settle();

  // Clear empties Next up in one tap (its quiet line shows); Undo brings the three back.
  await tap('clear');
  await page.waitForFunction(() => window.__cp.player.nextUp().length === 0);
  await settle();
  assert.ok((await rows()).some((x) => x.title === 'Nothing queued. Hold a song and choose Play next.'));
  await tap('undo_action');
  await page.waitForFunction(() => window.__cp.player.nextUp().length === 3);
  await settle();

  // A drag on the first row's handle, two rows down: it goes after the other two.
  r = await rows();
  const first = r.find((x) => x.title === 'Paper Satellites');
  const step = r.find((x) => x.title === 'Saltwater Static').y - first.y;
  await page.mouse.move(first.handle.x, first.handle.y);
  await page.mouse.down();
  for (let k = 1; k <= 20; k++) { await page.mouse.move(first.handle.x, first.handle.y + (k * step * 2.2) / 20); await page.waitForTimeout(20); }
  await page.mouse.up();
  await page.waitForFunction(() => window.__cp.player.nextUp()[2]?.track.title === 'Paper Satellites', null, { timeout: 5000 });
  assert.deepEqual(await queued(), ['Saltwater Static', 'A Very Long Song Title That Does Not Fit On One Line', 'Paper Satellites']);
  await settle();

  // Back closes the window; the player stays.
  await page.goBack();
  await page.waitForFunction(() => !window.__cp.ctx.dialogs?.length);
  assert.equal(await page.evaluate(() => window.__cp.ctx.topNav?.nav), 'nav_main');
  await settle();

  // The playing song sounds 10 s: History has it; a tap there plays it.
  await page.evaluate(() => window.__cp.player.play());
  await page.waitForFunction(() => window.__cp.player.history.items.length === 1, null, { timeout: 20_000 });
  await page.evaluate(() => window.__cp.player.step(1));
  await tap('cover-menu');
  await page.waitForFunction(() => { const v = window.__cp.ctx.root.findViewById('queue_history'); return v && v.visibility === 0 && v.width > 0; }, null, { timeout: 10_000 });
  await settle();
  await tap('queue_history');
  await page.waitForFunction(() => window.__cp.ctx.dialogs?.length === 1 && window.__cp.ctx.dialogs[0].list?.active.size > 0, null, { timeout: 10_000 });
  await settle();
  r = await rows();
  assert.equal(r[0].title, 'Northern Lights');
  assert.notEqual(await page.evaluate(() => window.__cp.player.track.title), 'Northern Lights');
  await page.mouse.click(r[0].x, r[0].y);
  await page.waitForFunction(() => window.__cp.player.track.title === 'Northern Lights');
  await page.goBack();
  await page.waitForFunction(() => !window.__cp.ctx.dialogs?.length);
  assert.deepEqual(errors, []);
  await context.close();
});

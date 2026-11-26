// Up Next and History in the real player, in Chromium at phone size (frontend/music/, owner
// 2026-11-25): the playing song's menu (its three dots) opens Up Next over the player with its three
// sections; a swipe left takes a Queued row out and Undo puts it back in its place; Clear empties
// Queued and Undo brings it back; a drag on a row's handle reorders; Back closes the window. A
// song that sounds 10 s is in History, and a tap there plays it. The demo songs (?demo, invented)
// play on a virtual clock: no audio, no network. At phone size (2026-11-26): a queued row's text ends
// before its handle; a tap just after Back closed the window reaches what is under it; the Undo bar
// follows a change of screen clear of the mini player, and sits at an open window's edge with room
// below its last row; in landscape the playing song's menu scrolls to its last item. The Undo bar never
// covers an open menu (2026-11-26): a line that only says something and has been up a second goes when the
// menu opens; a line just shown, and a line with Undo, move clear of it (the one just shown is still up once
// the menu closes); a tap on the menu's last entry reaches that entry.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { outlast, until } from './fixtures/waits.mjs';

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

test('Up Next: three sections, swipe out and Undo, Clear and Undo, reorder, Back; History plays a song heard', opts, async () => {
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

  // Now playing, Queued and Then.
  let r = await rows();
  const titles = r.map((x) => x.title);
  assert.deepEqual(titles.slice(0, 6), ['Now playing', 'Northern Lights', 'Queued', 'Paper Satellites', 'Saltwater Static', 'A Very Long Song Title That Does Not Fit On One Line']);
  assert.ok(titles[6]?.startsWith('Then'), `then section: ${titles[6]}`);
  assert.ok(r.slice(3, 6).every((x) => x.handle), 'Queued rows have their drag handle');

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

  // Clear empties Queued in one tap (its quiet line shows); Undo brings the three back.
  await tap('clear');
  await page.waitForFunction(() => window.__cp.player.nextUp().length === 0);
  await settle();
  assert.ok((await rows()).some((x) => x.title === 'Nothing queued. Select songs and choose Play Next.'));
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

/** In the page (an init script): window.__drawn(v), whether v and every view above it are written where they are laid
 * out (view.js sync writes a change on the next frame). A list's rows lie in its scrolled content layer
 * (power-list.js contentEl) and are written at their place in that content (top + translationY + the list's
 * contentY, view.js syncSelf), the layer at the list's contentY. */
function installDrawn() {
  window.__drawn = (v) => {
    for (let p = v; p; p = p.parent) {
      const inContent = !!p.parent?.contentEl && p.el.parentNode === p.parent.contentEl;
      const y = inContent ? Math.round((p.top + p.translationY + p.parent.contentY) * 1000) / 1000 : p.top + p.translationY;
      if (p._dirty || p._dom?.x !== p.left + p.translationX || p._dom?.y !== y) return false;
      if (p.contentEl && p._contentDomY !== p.contentY) return false;
    }
    return true;
  };
}

test('Up Next at phone size: text before the handle, a tap just after Back, the Undo bar with the screen and at the window, the menu in landscape', opts, async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await context.addInitScript(installDrawn);
  // The classic layout (?home1): the Undo bar's place over the library is measured against its library screen.
  await page.goto(`${base}/music/?demo&home1`);
  await page.waitForFunction(() => window.__cp?.player?.queue?.length === 4 && window.__cp.ctx.listWidget?.items?.get(0), null, { timeout: 30_000 });

  /** A view's box in CSS pixels: the cover's three dots ('cover-menu'), the open menu ('menu'), the Undo bar ('bar'), the
   * window's frame ('window'), else a view by id; null until the page shows it where it is laid out (it and every view
   * above it written: window.__drawn). */
  const box = (what) => page.evaluate((what) => {
    const { ctx } = window.__cp;
    const v = what === 'cover-menu' ? ctx.listWidget.items.get(0)?.findViewById('menu') : what === 'menu' ? ctx.listWidget.menuItem?.v
      : what === 'bar' ? ctx.root.findViewById('undo_bar') : what === 'window' ? ctx.dialogs?.at(-1)?.find('dialog_frame') : ctx.root.findViewById(what);
    if (!v || v.visibility !== 0 || !v.width || !window.__drawn(v)) return null;
    const r = v.el.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  }, what);
  /** The box once it is drawn. */
  const drawn = (what) => until(() => box(what), { message: `${what} was never drawn where it is laid out` });
  const tap = async (what) => {
    const b = await until(() => box(what), { message: `nothing to tap: ${what}` });
    await page.mouse.click((b.left + b.right) / 2, (b.top + b.bottom) / 2);
  };
  /** The playing song's menu is open and still. */
  const menuOpen = () => until(() => page.evaluate(() => {
    const { ctx } = window.__cp, ph = ctx.root.findViewById('menu_placeholder'), v = ctx.root.findViewById('queue_up_next');
    const m = ctx.listWidget.menuItem;
    return !!m && !m.closing && !ph.scenes.running && !m.v.scenes?.running && v?.visibility === 0 && v.width > 0;
  }), { message: 'the menu never opened' });
  /** The window is open and still, with its rows. */
  const windowOpen = () => until(() => page.evaluate(() => { const d = window.__cp.ctx.dialogs ?? []; return d.length === 1 && !d[0].host.scenes.running && d[0].list?.active.size > 4; }), { message: 'the window never opened' });
  /** The Undo bar shows, still (in place, not sliding, not following a change). */
  const barStill = () => until(() => page.evaluate(() => { const u = window.__cp.ctx.undoBar, f = u.frame; return !!u.current && f.visibility === 0 && f.alpha === 1 && !u.anim && !u.stopFollow; }), { message: 'the Undo bar never came to rest' });

  // A queued row's title and meta end before its drag handle.
  await page.evaluate(() => { const p = window.__cp.player; p.enqueue([p.queue[1], p.queue[2], p.queue[3]]); });
  await tap('cover-menu');
  await menuOpen();
  await tap('queue_up_next');
  await windowOpen();
  // (Read once each queued row's title, meta and handle are written where they are laid out.)
  const queued = await until(() => page.evaluate(() => {
    const r = (v) => v.el.getBoundingClientRect();
    const out = [...window.__cp.ctx.dialogs[0].list.active.values()].flatMap((row) => {
      const h = row.findViewById?.('drag_handler');
      if (!h || h.visibility !== 0) return [];
      const title = row.findViewById('title'), meta = row.findViewById('meta');
      if (![title, meta, h].every(window.__drawn)) return [null];
      return [{ title: r(title).right, meta: r(meta).right, handle: r(h).left, metaText: meta.text }];
    });
    return out.every(Boolean) && out;
  }), { message: 'the queued rows were never drawn where they are laid out' });
  assert.equal(queued.length, 3, 'three queued rows with their handle');
  for (const q of queued) {
    assert.ok(q.metaText, 'the row has its meta');
    assert.ok(q.meta <= q.handle + 0.5, `the meta ends at ${q.meta}, left of the handle at ${q.handle}`);
    assert.ok(q.title <= q.handle + 0.5, `the title ends at ${q.title}, left of the handle at ${q.handle}`);
  }

  // Clear: the Undo bar sits at the window's inner bottom edge, and the window's last row, scrolled to, ends above it.
  await page.evaluate(() => {
    for (const row of window.__cp.ctx.dialogs[0].list.active.values()) { const b = row.findViewById('line2'); if (b?.visibility === 0 && b.text === 'Clear') b.onClick(); }
  });
  await until(() => page.evaluate(() => window.__cp.player.nextUp().length === 0), { message: 'Clear emptied nothing' });
  await barStill();
  const atWindow = { bar: await drawn('bar'), window: await drawn('window') };
  assert.ok(atWindow.bar.bottom <= atWindow.window.bottom + 0.5 && atWindow.bar.bottom >= atWindow.window.bottom - 24, `the bar at the window's edge: ${JSON.stringify(atWindow)}`);
  // The list places its rows at once and writes them to the page on its next frame (view.js invalidate): the
  // last row is read once it is placed at the end and written there, its scrolled content layer too (more rows
  // may join as the end shows). (Rows are written in content coordinates: a check of the row's own place alone
  // never held once the list scrolled, and the read waited until the bar left with its room.)
  const lastRow = await until(() => page.evaluate(() => {
    const l = window.__cp.ctx.dialogs[0].list;
    if (l.scrollY < l.maxScroll()) l.scrollTo(l.maxScroll());
    const last = l.active.get(l.source.count - 1);
    if (!last || !window.__drawn(last)) return null;
    return { bottom: last.el.getBoundingClientRect().bottom };
  }), { message: 'the last row was never placed at the end' });
  assert.ok(lastRow.bottom <= atWindow.bar.top, `the last row (${lastRow.bottom}) ends above the bar (${atWindow.bar.top})`);
  await tap('undo_action');
  await until(() => page.evaluate(() => window.__cp.player.nextUp().length === 3), { message: 'Undo did not bring them back' });

  // Back closes the window; a tap 100 ms later reaches the cover's three dots under it (the closing window takes none).
  await page.goBack();
  await until(() => page.evaluate(() => !window.__cp.ctx.dialogs?.length), { message: 'Back did not close the window' });
  await outlast(page, 100);
  await tap('cover-menu');
  await menuOpen();

  // Play Next shows the Undo bar on the player (above its tabs); a change of screen to the library moves it above the
  // mini player, not over it.
  await tap('queue_play_next');
  await barStill();
  await page.evaluate(() => window.__cp.ctx.bus.post('bus_gui', 'cmd_nav_to_lib'));
  const mini = await until(() => page.evaluate(() => window.__cp.miniBox()), { message: 'the mini player never showed' });
  await barStill();
  const bar = await drawn('bar');
  assert.ok(bar.bottom <= mini.top + 0.5 || bar.top >= mini.bottom - 0.5, `the bar ${JSON.stringify(bar)} clear of the mini player ${JSON.stringify(mini)}`);

  // Landscape: the menu fits the screen, and its last item (Genre) scrolls into it.
  await page.evaluate(() => window.__cp.ctx.undoBar.hide());
  await page.evaluate(() => window.__cp.ctx.bus.post('bus_gui', 'cmd_nav_to_main'));
  await page.setViewportSize({ width: 844, height: 390 });
  await until(() => page.evaluate(() => { const { ctx } = window.__cp; return ctx.topNav?.nav === 'nav_main' && !ctx.topNav.scenes.running && ctx.root.width === Math.round(844 * ctx.dpr); }), { message: 'the player never came back in landscape' });
  await tap('cover-menu');
  await menuOpen();
  const card = await drawn('menu');
  assert.ok(card.top >= 0 && card.bottom <= 390, `the menu inside the screen: ${JSON.stringify(card)}`);
  assert.ok((await drawn('genre')).bottom > card.bottom, 'Genre starts below the menu (it does not all fit)');
  const from = await drawn('download_song');
  const x = (from.left + from.right) / 2;
  await page.mouse.move(x, from.top + 10);
  await page.mouse.down();
  for (let k = 1; k <= 12; k++) await page.mouse.move(x, from.top + 10 - k * 20);
  await page.mouse.up();
  const genre = await until(async () => { const g = await box('genre'); return g && g.bottom <= card.bottom + 0.5 && g; }, { message: 'Genre never scrolled into the menu' });
  assert.ok(genre.top >= card.top, `Genre inside the menu: ${JSON.stringify(genre)} in ${JSON.stringify(card)}`);

  assert.deepEqual(errors, []);
  await context.close();
});

test('the Undo bar keeps clear of an open menu: a plain line read goes, one just shown or with Undo moves, the last entry takes its tap', opts, async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/music/?demo`);
  await page.waitForFunction(() => window.__cp?.player?.queue?.length === 4 && window.__cp.ctx.listWidget?.items?.get(0), null, { timeout: 30_000 });

  /** A view's box in CSS pixels (the cover's three dots, the open menu, the bar, else by id); null until it is drawn
   * where it is laid out (it and every view above it written). */
  const box = (what) => page.evaluate((what) => {
    const { ctx } = window.__cp;
    const v = what === 'cover-menu' ? ctx.listWidget.items.get(0)?.findViewById('menu') : what === 'menu' ? ctx.listWidget.menuItem?.v
      : what === 'bar' ? ctx.root.findViewById('undo_bar') : ctx.root.findViewById(what);
    if (!v || v.visibility !== 0 || !v.width) return null;
    for (let p = v; p; p = p.parent) if (p._dirty || p._dom?.x !== p.left + p.translationX || p._dom?.y !== p.top + p.translationY) return null;
    const r = v.el.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  }, what);
  const tap = async (what) => {
    const b = await until(() => box(what), { message: `nothing to tap: ${what}` });
    await page.mouse.click((b.left + b.right) / 2, (b.top + b.bottom) / 2);
  };
  const menuOpen = () => until(() => page.evaluate(() => {
    const { ctx } = window.__cp, ph = ctx.root.findViewById('menu_placeholder'), m = ctx.listWidget.menuItem;
    return !!m && !m.closing && !ph.scenes.running && !m.v.scenes?.running;
  }), { message: 'the menu never opened' });
  const menuClosed = () => until(() => page.evaluate(() => !window.__cp.ctx.listWidget.menuItem), { message: 'the menu never closed' });
  const show = (undo) => page.evaluate((undo) => { window.__cp.ctx.undoBar.show(undo ? 'Example undo' : 'Example note', undo ? () => {} : null, { ms: 60_000 }); }, undo);
  const barShown = () => until(() => page.evaluate(() => { const u = window.__cp.ctx.undoBar; return !!u.current && u.frame.visibility === 0 && u.frame.alpha === 1 && !u.anim; }), { message: 'the bar never came to rest' });
  /** Once the bar's place holds and both are drawn: the bar's box apart from the open menu's. */
  const clearOfMenu = async (what) => {
    const { bar, menu } = await until(async () => {
      const held = await page.evaluate(() => { const u = window.__cp.ctx.undoBar; return !!u.current && !u.anim && u.frame.lp.bottomMargin === u.place(); });
      if (!held) return null;
      const bar = await box('bar'), menu = await box('menu');
      return bar && menu && { bar, menu };
    }, { message: `${what}: the bar and the menu were never both drawn` });
    const apart = bar.bottom <= menu.top || bar.top >= menu.bottom || bar.right <= menu.left || bar.left >= menu.right;
    assert.ok(apart, `${what}: the bar ${JSON.stringify(bar)} clear of the menu ${JSON.stringify(menu)}`);
  };

  // A line that only says something and has been up READ_MS (read, on the page's clock) goes at once when the menu
  // opens.
  await show(false);
  await barShown();
  await until(() => page.evaluate(async () => {
    const { READ_MS } = await import('/music/src/widgets/undo-bar.js');
    const c = window.__cp.ctx.undoBar.current;
    return !!c && performance.now() - c.shownAt >= READ_MS;
  }), { message: 'the plain line was never up a second' });
  await tap('cover-menu');
  await until(() => page.evaluate(() => { const u = window.__cp.ctx.undoBar; return !u.current && u.frame.visibility !== 0; }), { message: 'the plain line stayed over the menu' });
  await menuOpen();
  await page.evaluate(() => window.__cp.ctx.listWidget.closeItemMenu());
  await menuClosed();

  // A line just shown as the menu opens (a result such as "Saved to Downloads" arriving as the owner opens a menu,
  // here in the same moment): it stays, placed clear of the menu, and is still up once the menu has closed.
  await page.evaluate(() => {
    const { ctx } = window.__cp;
    ctx.undoBar.show('Example result', null, { ms: 60_000 });
    ctx.listWidget.openItemMenu(ctx.listWidget.items.get(0));
  });
  await menuOpen();
  await clearOfMenu('a line just shown');
  await page.evaluate(() => window.__cp.ctx.listWidget.closeItemMenu());
  await menuClosed();
  await until(() => page.evaluate(() => { const u = window.__cp.ctx.undoBar; return u.current?.message === 'Example result' && u.frame.visibility === 0; }), { message: 'the line just shown was lost to the menu' });

  // A line with Undo, then the menu: the bar stays, placed clear of the menu.
  await show(true);
  await barShown();
  await tap('cover-menu');
  await menuOpen();
  await clearOfMenu('a line with Undo');

  // The menu's last entry (the lowest one shown inside the menu) takes a tap there while the bar is up.
  const last = await page.evaluate(async () => {
    const { ctx } = window.__cp, m = ctx.listWidget.menuItem.v, items = m.findViewById('menu_items');
    const { hitTest } = await import('/music/src/input.js');
    const shown = (x) => { for (let p = x; p; p = p.parent) if (p.visibility !== 0) return false; return x.width > 0; };
    const mb = m.getLocationIn(null);
    let low = null;
    items.walk((c) => {
      if (c === items || !c.clickable || !shown(c)) return;
      const a = c.getLocationIn(null);
      if (a.y + c.height > mb.y + m.height + 0.5) return;
      if (!low || a.y > low.y) low = { v: c, x: a.x + c.width / 2, y: a.y + c.height / 2 };
    });
    if (!low) return null;
    const hit = hitTest(ctx.root, low.x, low.y);
    let reached = false;
    for (let h = hit; h; h = h.parent) if (h === low.v) reached = true;
    window.__lastTapped = false;
    low.v.onClick = () => { window.__lastTapped = true; };
    return { id: low.v.id, x: low.x, y: low.y, reached };
  });
  assert.ok(last, 'the menu has an entry shown');
  assert.ok(last.reached, `a tap on the last entry (${last.id}) reaches it, not the bar`);
  assert.ok(await page.evaluate(() => !!window.__cp.ctx.undoBar.current), 'the line with Undo is still up');
  await page.mouse.click(last.x, last.y);
  await until(() => page.evaluate(() => window.__lastTapped), { message: `the tap on ${last.id} never reached it` });
  assert.ok(await page.evaluate(() => !!window.__cp.ctx.undoBar.current), 'the bar was up when the entry took the tap');

  assert.deepEqual(errors, []);
  await context.close();
});

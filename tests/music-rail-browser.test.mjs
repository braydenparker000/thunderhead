// Music's fast-scroll rail matches the sort (list/sections.js, owner 2026-11-25) and a catalogue refresh
// keeps the list where it is (list/relocate.js), in Chromium at phone size over an invented library
// (tests/fixtures/music-shelves-library.mjs; no audio, no network):
// - All Songs sorted by album shows the letter column, painted, its letters the albums' first letters;
// - Albums sorted by year shows the years in the column, painted, and a press on one shows that year in
//   the bubble;
// - a library change (songs added) leaves the list on the same level with the same song on top, where
//   before it went back to the library's home.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { until } from './fixtures/waits.mjs';
import { inventedLibrary } from './fixtures/music-shelves-library.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (an invented library)', timeout: 120_000 };
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

/** Opens a home category (by id) with a sort saved for its list key, and waits for the rail to rest. */
const open = async (page, home, key, sort) => {
  await page.evaluate(async ([home, key, sort]) => {
    const { ctx } = window.__cp, lw = ctx.listWidget;
    (await import('/music/src/list/list-opts.js')).saveListOpts(key, { sort });
    const m = await import('/music/src/list/sources.js');
    lw.openHome();
    lw.open(m.categorySource(ctx, lw.libList, lw.nav, m.homeCategory(home)));
  }, [home, key, sort]);
  await until(() => page.evaluate(() => {
    const { ctx } = window.__cp, lw = ctx.listWidget, sc = ctx.listScroller;
    return lw.mode === 'list' && !lw.trans && lw.libList.source === lw.stack[lw.stack.length - 1] && sc.mode === 2 && sc.textAlpha === 1;
  }), { message: 'the list or its rail never came to rest' });
};

/** The rail's labels, and whether it is painted: its pixels change when its marks are hidden. */
async function rail(page) {
  const { labels, clip } = await page.evaluate(() => {
    const sc = window.__cp.ctx.listScroller, r = sc.el.getBoundingClientRect();
    return { labels: [...sc.labels], clip: { x: r.left, y: r.top, width: Math.min(r.right, innerWidth) - r.left, height: r.height } };
  });
  assert.ok(clip.width > 0 && clip.height > 0, 'the rail has a box on screen');
  const shown = await page.screenshot({ clip });
  const hide = (on) => page.evaluate((on) => {
    for (const m of window.__cp.ctx.listScroller.el.querySelectorAll('.ops')) m.style.visibility = on ? 'hidden' : '';
  }, on);
  await hide(true);
  const hidden = await page.screenshot({ clip });
  await hide(false);
  return { labels, painted: !shown.equals(hidden) };
}

test('the rail matches the sort; a library change leaves the list where it was', opts, async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/music/?demo`);
  await page.waitForFunction(() => window.__cp?.player?.queue?.length === 4 && !!window.__cp.ctx.listWidget, null, { timeout: 60_000 });
  await page.evaluate(async (lib) => {
    const { ctx } = window.__cp;
    await ctx.library.r2Ready?.catch(() => {});
    ctx.library.withUserData(lib);
    ctx.library.setTracks(lib);
    ctx.bus.post('bus_gui', 'cmd_nav_to_lib');
  }, inventedLibrary());
  await until(() => page.evaluate(() => window.__cp.ctx.listWidget.mode === 'list'), { message: 'the library never opened' });

  // All Songs by album (sort 9): the letter column, each song's bubble its album's first letter.
  await open(page, 0, 'tracks:all', 9);
  let r = await rail(page);
  assert.ok(r.painted, 'the album-sorted songs list paints its rail');
  assert.equal(r.labels.join(''), '0ABCDEFGHIJKLMNOPQRSTUVWXYZ#');
  const albumLetters = await page.evaluate(() => {
    const l = window.__cp.ctx.listWidget.libList, idx = l.sectionIndex(), s = l.source;
    return s.tracks.map((t, i) => [t.album, idx.bubble(i)]);
  });
  for (const [album, letter] of albumLetters) assert.equal(letter, album ? album[0].toUpperCase() : '#', `"${album}" under ${letter}`);

  // A library change: three songs come in ahead; the same song stays on top of the same list.
  const before = await page.evaluate(() => {
    const lw = window.__cp.ctx.listWidget, l = lw.libList;
    l.scrollToIndex(8);
    const g = l.geometry(), i = l.indexAtY(g, l.scrollY - g.headerH);
    return { depth: lw.stack.length, source: (window.__keep = l.source, l.source.count), top: l.source.tracks[i].id };
  });
  await page.evaluate((lib) => {
    const { ctx } = window.__cp;
    const more = ['Aster', 'Bramble', 'Clove'].map((title, k) => ({ ...lib[0], id: 'new' + k, title, album: `A ${title} Album`, albumArtist: '', year: 2024, added: lib[0].added + 9e6 + k }));
    const all = [...lib, ...more];
    ctx.library.withUserData(all);
    ctx.library.setTracks(all);
  }, inventedLibrary());
  await until(() => page.evaluate(() => window.__cp.ctx.listWidget.libList.source !== window.__keep), { message: 'the list was never made again' });
  const after = await page.evaluate(() => {
    const lw = window.__cp.ctx.listWidget, l = lw.libList;
    const g = l.geometry(), i = l.indexAtY(g, l.scrollY - g.headerH);
    return { depth: lw.stack.length, count: l.source.count, top: l.source.tracks[i]?.id, home: !!l.source.home, mode: lw.mode };
  });
  assert.equal(after.mode, 'list');
  assert.equal(after.home, false, 'not thrown back to the home');
  assert.equal(after.depth, before.depth, 'on the same level');
  assert.equal(after.count, before.source + 3, 'with the new songs');
  assert.equal(after.top, before.top, 'the same song on top');

  // Albums by year (sort 1): the years in the column, unknown last; a press on a year shows it.
  await open(page, 3, 'cat:albums', 1);
  r = await rail(page);
  assert.ok(r.painted, 'the year-sorted albums list paints its rail');
  assert.deepEqual(r.labels, ['2017', '2019', '2020', '2022', '#']);
  const at = await page.evaluate(() => {
    const { ctx } = window.__cp, sc = ctx.listScroller, el = sc.el.getBoundingClientRect(), k = sc.labels.indexOf('2020');
    const y = sc.azTop + (k + (sc.scrollUp ? 1 : 0) + 0.5) * sc.cell;
    return { x: el.left + el.width / 2, y: el.top + ctx.px(y) };
  });
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await until(() => page.evaluate(() => window.__cp.ctx.root.findViewById('list_indexer')?.text === '2020'), { message: 'the bubble never showed 2020' });
  await page.mouse.up();

  assert.deepEqual(errors, []);
  await context.close();
});

// Music's list levels keep how they were opened, and every route opens the library's own page (owner
// audit 2026-11-26), in Chromium at phone size over an invented library (tests/fixtures/
// music-shelves-library.mjs, with more invented songs so the results scroll; no audio, no network):
// - a level opened from the search results, re-sorted (List Options) and zoomed (pinch), still goes
//   Back to the same results at the same scroll, and its sort and zoom are that album's alone;
// - the playing song's artist and album from its menu open the artist's page and the album's page the
//   library opens (not a flat list), at the song's row;
// - search lists albums as the shelves count them: a one-song release is found as a song.
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

const library = () => {
  const lib = inventedLibrary();
  // Forty more invented songs by Harbor Lights with no album, so "harbor" fills more than a screen.
  const more = Array.from({ length: 40 }, (_, k) => ({ ...lib[11], id: 'extra' + k, title: `Harbor Sketch ${k + 1}`, fileName: `extra${k}.flac`, added: lib[11].added + (k + 1) * 1000 }));
  return [...lib, ...more];
};

/** The list at rest on the shown level (no transition running). */
const settled = (page) => until(() => page.evaluate(() => {
  const lw = window.__cp.ctx.listWidget;
  return lw.mode === 'list' && !lw.trans && !lw.ctx.topNav?.scenes?.running;
}), { message: 'the list never came to rest' });

test('a level opened from search keeps its way back through a re-sort and a zoom; every route opens the library page', opts, async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/music/?demo`);
  await page.waitForFunction(() => window.__cp?.player?.queue?.length === 4 && !!window.__cp.ctx.listWidget, null, { timeout: 60_000 });
  await page.evaluate(async (lib) => {
    const { ctx } = window.__cp;
    await ctx.library.r2Ready?.catch(() => {});
    localStorage.removeItem('cp-list-opts');
    ctx.library.withUserData(lib);
    ctx.library.setTracks(lib);
    ctx.bus.post('bus_gui', 'cmd_nav_to_lib');
  }, library());
  await settled(page);

  // Search "harbor": the results, scrolled down.
  await page.evaluate(() => window.__cp.ctx.bus.post('bus_gui', 'cmd_nav_to_search'));
  await until(() => page.evaluate(() => window.__cp.ctx.listWidget.searchShown), { message: 'search never showed' });
  await page.evaluate(() => window.__cp.ctx.bus.post('list', 'cmd_list_search_text', null, { string: 'harbor' }));
  await until(() => page.evaluate(() => window.__cp.ctx.listWidget.searchSrc?.rows?.some((r) => r.group?.title === 'Tidewater')), { message: 'no results for "harbor"' });
  await settled(page);
  const results = await page.evaluate(() => {
    const lw = window.__cp.ctx.listWidget, l = lw.libList;
    l.scrollTo(240);
    const at = lw.searchSrc.rows.findIndex((r) => r.group?.title === 'Tidewater');
    return { y: l.scrollY, src: (window.__results = lw.searchSrc, true), at };
  });
  assert.ok(results.y > 0, 'the results scroll');
  // Open the album from the results.
  await page.evaluate((at) => window.__cp.ctx.listWidget.searchSrc.onItemClick(at), results.at);
  await until(() => page.evaluate(() => window.__cp.ctx.listWidget.stack.at(-1)?.group?.title === 'Tidewater'), { message: 'the album never opened' });
  await settled(page);

  // List Options: by title (what its dialog's change does), then a pinch zoom one level in.
  const changed = await page.evaluate(async () => {
    const lw = window.__cp.ctx.listWidget, { saveListOpts, listOpts } = await import('/music/src/list/list-opts.js');
    const before = lw.stack.at(-1);
    saveListOpts(before.optsKey, { sort: 1 });
    lw.replaceTop(before.rebuild());
    const sorted = lw.stack.at(-1);
    const zoom = lw.startZoomTransition(true);
    zoom?.complete();
    const top = lw.stack.at(-1);
    const m = await import('/music/src/list/sources.js'), lantern = window.__cp.ctx.library.albums().find((a) => a.title === 'Lantern Season');
    const other = m.groupTracksSource(window.__cp.ctx, lw.libList, lw.nav, lantern, '?albums');
    return {
      rebuilt: sorted !== before && top !== sorted, zoomed: !!zoom, key: top.optsKey, own: listOpts(top.optsKey),
      carried: [top.fromSearch, top.searchParent, top.openedFrom === before.openedFrom],
      order: top.tracks.map((t) => t.title), otherSort: other.sortValue, otherZoom: other.zoomLevel, zoomLevel: top.zoomLevel,
    };
  });
  assert.ok(changed.rebuilt && changed.zoomed, 'the level was made again twice');
  assert.match(changed.key, /^tracks:album@tidewater\|harbor lights$/);
  assert.equal(changed.own.sort, 1);
  assert.deepEqual(changed.carried, [true, true, true], 'it still knows it came from the results');
  assert.deepEqual(changed.order, [...changed.order].sort((a, b) => a.localeCompare(b)), 'by title');
  assert.notEqual(changed.otherSort, 1, "another album keeps the kind's sort");
  assert.notEqual(changed.otherZoom, changed.zoomLevel, "another album keeps the kind's zoom");
  await settled(page);

  // Back: the same results, at the same scroll.
  await page.evaluate(() => history.back());
  await until(() => page.evaluate(() => {
    const lw = window.__cp.ctx.listWidget;
    return lw.searchShown && lw.libList.source === lw.searchSrc && !lw.trans;
  }), { message: 'Back never returned to the results' });
  const back = await page.evaluate(() => ({ same: window.__cp.ctx.listWidget.searchSrc === window.__results, y: window.__cp.ctx.listWidget.libList.scrollY }));
  assert.equal(back.same, true, 'the same results');
  assert.equal(back.y, results.y, 'at the same scroll');

  // Search counts albums as the shelves do: "paper" finds the one-song release as a song, not an album.
  await page.evaluate(() => window.__cp.ctx.bus.post('list', 'cmd_list_search_text', null, { string: 'paper' }));
  await until(() => page.evaluate(() => window.__cp.ctx.listWidget.searchSrc?.rows?.some((r) => r.track?.title === 'Paper Moon')), { message: '"Paper Moon" never found' });
  assert.equal(await page.evaluate(() => window.__cp.ctx.listWidget.searchSrc.rows.some((r) => r.group?.kind === 'album')), false);

  // The playing song's artist and album open the library's pages, at its row.
  const routes = await page.evaluate(async () => {
    const { ctx } = window.__cp, lw = ctx.listWidget, by = (id) => ctx.library.byId.get(id);
    const out = {};
    lw.openCurrent('artist', by('inv23'));
    lw.trans?.complete();
    let top = lw.stack.at(-1);
    const row = top.pageRows?.findIndex((r) => r.track?.id === 'inv23');
    out.artist = { title: top.title, page: !!top.secondLevel && !!top.pageRows, singles: top.pageRows?.some((r) => r.sep != null), row, depth: lw.stack.length };
    const g = lw.libList.geometry(), y = g.headerH + lw.libList.itemTop(g, row);
    out.artist.inView = y >= lw.libList.scrollY && y < lw.libList.scrollY + lw.libList.height;
    lw.openCurrent('album', by('inv9'));
    lw.trans?.complete();
    top = lw.stack.at(-1);
    out.album = { title: top.title, kind: top.group?.kind, discs: top.pageRows?.filter((r) => r.sep != null).length, depth: lw.stack.length };
    return out;
  });
  assert.deepEqual(routes.artist, { title: 'Juno Park', page: true, singles: true, row: routes.artist.row, depth: 2, inView: true });
  assert.ok(routes.artist.row > 0, "the song's row on the artist's page");
  assert.deepEqual(routes.album, { title: 'Lantern Season', kind: 'album', discs: 2, depth: 2 }, "the album's page, with its discs");

  assert.deepEqual(errors, []);
  await context.close();
});

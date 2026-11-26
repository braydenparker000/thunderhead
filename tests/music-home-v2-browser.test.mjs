// Music's v2 layout in the real player (frontend/music/src/home/, owner 2026-11-26; ?demo&home2), in
// Chromium at phone size with touch, over an invented library made in the page (no audio, no network):
// the four tabs (Home, Search, Library, More); Home's chips showing their kind; a tile and a shelf's
// cover opening the right page and Back coming back where Home was scrolled; the Library's sort stepping
// Name, Added, Recent and its list or grid toggle; pinch zoom stepping the level of Albums and of All
// music through the lists' own levels and keeping it; More held and drawn up bringing the Equaliser up
// as a sheet, and Back taking it down; and Forgotten favourites' See all listing exactly those songs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { outlast, until } from './fixtures/waits.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (an invented library)', timeout: 180_000 };
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

/** In the page: 240 invented songs over 30 albums and 15 artists, with plays, last plays, likes and added
 * dates relative to now, and three playlists. */
function inventLibrary() {
  const DAY = 86_400_000, now = Date.now();
  const w1 = ['Amber', 'Velvet', 'Hollow', 'Paper', 'Silver', 'Quiet', 'Neon', 'Copper', 'Lunar', 'Wild', 'Static', 'Golden', 'Salt', 'Glass', 'Cedar'];
  const w2 = ['Rivers', 'Engines', 'Gardens', 'Signals', 'Harbors', 'Pilots', 'Lanterns', 'Foxes', 'Echoes', 'Orchards'];
  const tracks = [];
  for (let a = 0; a < 30; a++) {
    const artist = `${w1[a % 15]} ${w2[a % 10]}`, album = `Album ${String.fromCharCode(65 + (a % 26))}${a}`;
    for (let k = 1; k <= 8; k++) {
      const i = a * 8 + k;
      const plays = (i * 7) % 11, last = plays ? now - ((i * 13) % 200) * DAY - 3_600_000 : 0;
      tracks.push({
        id: 'hv' + i, title: `Song ${i}`, artist, album, albumArtist: artist, track: k, year: 1970 + (a % 50), genre: ['Indie', 'Jazz', 'Folk'][a % 3],
        durationMs: 180_000 + (i % 60) * 1000, format: 'FLAC', bitrate: 900, sampleRate: 44100, bits: 16, fileName: `hv${i}.flac`,
        added: now - ((a * 37) % 300) * DAY - k * 60_000, plays, lastPlayed: last, rating: i % 9 === 0 ? 5 : 0, ratedAt: i % 9 === 0 ? now - i * 3_600_000 : 0,
      });
    }
  }
  return tracks;
}

/** The helpers the tests share, for a page with touch: the screen's state, the list at rest, taps, touches and reads. */
async function helpers(context, page) {
  const cdp = await context.newCDPSession(page);
  const state = () => page.evaluate(() => {
    const { ctx } = window.__cp, lw = ctx.listWidget, top = lw.stack[lw.stack.length - 1];
    return { nav: ctx.topNav.nav, scene: ctx.topNav.scenes.scene, depth: lw.stack.length, root: lw.stack[0]?.isLibraryV2 ? 'library' : lw.stack[0]?.isHomeV2 ? 'home' : '',
      title: top?.title, chip: top?.chip ?? top?.libraryChip ?? null, zoom: top?.zoomLevel ?? null, key: top?.optsKey ?? null, scroll: lw.libList.scrollY, v2List: top?.v2List ?? null };
  });
  /** The list shown at rest: no transition, the stack's top on screen, its rows laid out. */
  const atRest = () => until(() => page.evaluate(() => {
    const { ctx } = window.__cp, lw = ctx.listWidget;
    return ctx.topNav.nav === 'nav_lib' && !ctx.topNav.scenes.running && lw.mode === 'list' && !lw.trans && !lw.pinch && lw.libList.source === lw.stack[lw.stack.length - 1] && lw.libList.active.size > 0;
  }), { message: 'the list never came to rest' });
  const { where, tap } = tapper(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i + 1 })) });
  /** Two fingers about (x, y) from d0 apart to d1 apart. */
  const pinch = async (x, y, d0, d1) => {
    const at = (d) => [{ x, y: y - d / 2 }, { x, y: y + d / 2 }];
    await touch('touchStart', at(d0));
    for (let i = 1; i <= 12; i++) await touch('touchMove', at(d0 + ((d1 - d0) * i) / 12));
    await touch('touchEnd', []);
  };
  const saved = (key) => page.evaluate((key) => JSON.parse(localStorage.getItem('cp-list-opts') || '{}')[key] ?? {}, key);
  const levels = (kind) => page.evaluate(async (kind) => (await import('/music/src/list/list-opts.js')).ZOOMS[kind].map((z) => z.value), kind);
  const rowsOf = () => page.evaluate(() => (window.__cp.ctx.listWidget.libList.source.rows ?? []).map((r) => ({ type: r.type, title: r.title ?? null, items: r.items?.map((it) => it.record.title) ?? null })));
  return { cdp, state, atRest, where, tap, touch, pinch, saved, levels, rowsOf };
}

/** Taps for a page: where(q) is a view's centre where a tap reaches it, or null; tap(q) taps it once it is shown, reachable and still. */
function tapper(page) {
  /** A view's centre where a tap reaches it (input.js hitTest: it or the view above it that takes taps), or null. */
  const where = (q) => page.evaluate(async (q) => {
    const { ctx } = window.__cp;
    const { hitTest } = await import('/music/src/input.js');
    const shown = (x) => { for (let p = x; p; p = p.parent) if (p.visibility !== 0) return false; return x.width > 0; };
    let v = null;
    if (q.nav != null) v = ctx.navbar.buttons.children[q.nav];
    else if (q.cover) { const shelf = [...ctx.listWidget.libList.active.values()].find((r) => r.listItemType === 'homeShelf' && r.row?.key === q.cover); v = shelf?.shown.get(0) ?? null; }
    else if (q.bar) { const bar = [...ctx.listWidget.libList.active.values()].find((r) => r.listItemType === 'libraryBar'); v = bar?.[q.bar] ?? null; }
    else if (q.seeAll) { const h = [...ctx.listWidget.libList.active.values()].find((r) => r.listItemType === 'homeHead' && r.row?.title === q.seeAll); v = h?.button ?? null; }
    else ctx.root.walk((x) => { if (!v && x.text === q.text && shown(x)) v = x; });
    if (!v || !shown(v)) return null;
    const a = v.getLocationIn(null), k = ctx.dpr, at = { x: a.x + v.width / 2, y: a.y + v.height / 2 };
    if (at.y < 0 || at.y > ctx.root.height) return null;
    const hit = hitTest(ctx.root, at.x, at.y);
    let reach = false;
    for (let h = hit; h; h = h.parent) if (h === v) reach = true;
    let own = v;
    while (own && !(own.clickable || own.longClickable || typeof own.onPointerDown === 'function')) own = own.parent;
    if (!reach && !(hit && hit === own)) return null;
    return { x: at.x / k, y: at.y / k };
  }, q);
  /** Taps a view once it is shown, reachable and still (two reads alike). */
  const tap = async (q) => {
    let last = null;
    const c = await until(async () => {
      const now = await where(q);
      const still = now && last && now.x === last.x && now.y === last.y;
      last = now;
      return still && now;
    }, { message: `nothing to tap: ${JSON.stringify(q)}` });
    await page.mouse.click(c.x, c.y);
  };
  return { where, tap };
}

test('v2 layout: tabs, chips, tiles and shelves, Library sort and view, pinch zoom, the Equaliser sheet, Forgotten favourites', opts, async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/music/?demo&home2`);
  await page.waitForFunction(() => window.__cp?.player?.queue?.length === 4 && !!window.__cp.ctx.listWidget && !!window.__cp.ctx.homeTabs, null, { timeout: 60_000 });
  await page.evaluate(async (src) => {
    const { ctx } = window.__cp;
    await ctx.library.r2Ready?.catch(() => {});
    const tracks = eval(`(${src})`)();
    ctx.library.withUserData(tracks);
    ctx.library.setTracks(tracks);
    const now = Date.now(), DAY = 86_400_000;
    ctx.playlists.items = [['Late drive', 2, 3], ['Sunday', 9, 17], ['Focus', 40, 29]].map(([name, ago, step], i) => ({
      id: 'hvp' + i, name, ids: Array.from({ length: 10 }, (_, k) => tracks[(k * step + i) % tracks.length].id), created: now - (ago + 30) * DAY, modified: now - ago * DAY,
    }));
    ctx.playlists.changed();
    ctx.bus.post('bus_gui', 'cmd_nav_to_lib');
  }, inventLibrary.toString());
  const { state, atRest, where, tap, touch, pinch, saved, levels, rowsOf } = await helpers(context, page);

  // Home: its data in (the shelves come in idle time), on the Home tab.
  await atRest();
  await until(async () => (await rowsOf()).some((r) => r.type === 'homeShelf'), { message: "Home's shelves never came" });
  let s = await state();
  assert.equal(s.root, 'home');
  assert.equal(s.chip, 'all');
  assert.equal(await page.evaluate(() => window.__cp.ctx.navbar.buttons.children[0].state.activated), true, 'Home shows chosen');

  // The four tabs: Search, Library, More (its menu sheet, with the Equaliser line), Home.
  await tap({ nav: 1 });
  await until(async () => (await state()).nav === 'nav_search', { message: 'Search never opened' });
  await tap({ nav: 2 });
  await atRest();
  s = await state();
  assert.equal(s.root, 'library');
  assert.equal(s.chip, 'playlists');
  await tap({ nav: 3 });
  await until(() => page.evaluate(() => !!window.__cp.ctx.navbar.sheet), { message: "More's menu never opened" });
  assert.ok(await where({ text: 'Equ/Effects' }) || (await page.evaluate(() => !!window.__cp.ctx.navbar.ext.findViewById('navbar_ext_eq'))), 'the menu has the Equaliser line');
  await page.evaluate(() => window.__cp.ctx.bus.post('bus_gui', 'cmd_navbar_sheet_close'));
  await until(() => page.evaluate(() => !window.__cp.ctx.navbar.sheet && !window.__cp.ctx.navbar.container?.()?.scenes?.running), { message: 'the menu never closed' });
  await tap({ nav: 0 });
  await atRest();
  assert.equal((await state()).root, 'home');

  // Chips: Albums shows albums only (its tiles albums, no tonight card, its own shelves); Playlists starts with Liked songs.
  const data = await page.evaluate(() => { const d = window.__cp.ctx.homeDataKept.value; return { recentAlbum: d.recentAlbums[0].title, albumTiles: d.tiles.filter((t) => t.kind === 'album').slice(0, 6).map((t) => t.g.title) }; });
  await tap({ text: 'Albums' });
  await until(async () => (await state()).chip === 'albums', { message: 'the Albums chip never showed' });
  let rows = await rowsOf();
  assert.deepEqual(rows.filter((r) => r.type === 'homeTiles').flatMap((r) => r.items), data.albumTiles);
  assert.ok(rows.some((r) => r.type === 'homeHead' && r.title === 'Your albums'));
  assert.ok(!rows.some((r) => r.type === 'track'), 'no song rows under Albums');
  await tap({ text: 'Playlists' });
  await until(async () => (await state()).chip === 'playlists', { message: 'the Playlists chip never showed' });
  rows = await rowsOf();
  assert.equal(rows.find((r) => r.type === 'homeTiles').items[0], 'Liked songs');
  assert.ok(rows.filter((r) => r.type === 'homeTiles').flatMap((r) => r.items).slice(1).every((t) => ['Late drive', 'Sunday', 'Focus'].includes(t)));
  await tap({ text: 'All' });
  await until(async () => (await state()).chip === 'all', { message: 'the All chip never showed' });

  // A tile opens its page (Liked songs: the songs rated like), and Back comes back to Home.
  await tap({ text: 'Liked songs' });
  await atRest();
  s = await state();
  assert.equal(s.v2List, 'liked');
  assert.equal(s.depth, 2);
  const liked = await page.evaluate(() => window.__cp.ctx.listWidget.stack.at(-1).tracks.every((t) => t.rating === 5) && window.__cp.ctx.listWidget.stack.at(-1).tracks.length);
  assert.ok(liked > 0, 'Liked songs lists only songs rated like');
  await page.evaluate(() => history.back());
  await atRest();
  assert.equal((await state()).depth, 1);

  // A shelf's cover, Home scrolled to it: its album opens, and Back returns with Home where it was.
  const y = await page.evaluate(() => { const l = window.__cp.ctx.listWidget.libList, src = l.source, g = l.geometry(); const i = src.rows.findIndex((r) => r.type === 'homeShelf'); const y = g.headerH + l.itemTop(g, i) - 120; l.scrollTo(y); return l.scrollY; });
  await tap({ cover: 'all:added' });
  await atRest();
  s = await state();
  assert.equal(s.depth, 2);
  assert.equal(s.title, data.recentAlbum);
  await page.evaluate(() => history.back());
  await atRest();
  assert.equal((await state()).scroll, y, 'Home is where it was scrolled');

  // Library: Albums' sort steps Name, Added, Recent and back; the toggle switches list and grid (the same saved level).
  await tap({ nav: 2 });
  await atRest();
  await page.evaluate(() => window.__cp.ctx.listWidget.libList.scrollTo(0));
  await tap({ text: 'Albums' });
  await until(async () => (await state()).chip === 'albums', { message: 'Library never showed Albums' });
  const sortWord = () => page.evaluate(() => [...window.__cp.ctx.listWidget.libList.active.values()].find((r) => r.listItemType === 'libraryBar')?.sort.text);
  assert.equal(await sortWord(), 'Name');
  for (const next of ['Added', 'Recent', 'Name']) {
    await tap({ bar: 'sort' });
    await until(async () => (await sortWord()) === next, { message: `the sort never stepped to ${next}` });
  }
  const gridLevel = (await state()).zoom;
  assert.equal(gridLevel, 5, 'Albums open as the grid');
  await tap({ bar: 'toggle' });
  await until(async () => (await state()).zoom === 0, { message: 'the toggle never showed the list' });
  assert.equal((await saved('cat:albums')).zoom, 0);
  await tap({ bar: 'toggle' });
  await until(async () => (await state()).zoom === 5, { message: 'the toggle never showed the grid again' });

  // Pinch zoom on Albums: fingers together take the level before it in the lists' table, kept as List Options keep it.
  const groupLevels = await levels('groups');
  await atRest();
  await pinch(195, 520, 320, 110);
  const smaller = groupLevels[groupLevels.indexOf(5) - 1];
  await until(async () => (await state()).zoom === smaller, { message: 'pinching Albums never changed its level' });
  await atRest();
  assert.equal((await saved('cat:albums')).zoom, smaller);
  await page.evaluate(() => window.__cp.ctx.listWidget.libList.scrollTo(0));
  await tap({ text: 'Artists' });
  await until(async () => (await state()).chip === 'artists', { message: 'Artists never showed' });
  await tap({ text: 'Albums' });
  await until(async () => (await state()).chip === 'albums', { message: 'Albums never showed again' });
  assert.equal((await state()).zoom, smaller, 'Albums opens at the level pinched');

  // All music: All Songs at its level; a pinch apart takes the next level; Back returns to the Library.
  await page.evaluate(() => window.__cp.ctx.listWidget.libList.scrollTo(0));
  await tap({ text: 'Playlists' });
  await until(async () => (await state()).chip === 'playlists', { message: 'Playlists never showed' });
  await tap({ text: 'All music' });
  await atRest();
  s = await state();
  assert.equal(s.key, 'tracks:all');
  const trackLevels = await levels('tracks');
  await pinch(195, 520, 110, 320);
  const larger = trackLevels[trackLevels.indexOf(s.zoom) + 1];
  await until(async () => (await state()).zoom === larger, { message: 'pinching All music never changed its level' });
  await atRest();
  assert.equal((await saved('tracks:all')).zoom, larger);
  await page.evaluate(() => history.back());
  await atRest();
  s = await state();
  assert.equal(s.root, 'library');
  assert.equal(s.depth, 1);

  // More held and drawn up: the Equaliser comes up as a sheet with the finger and stays open; Back takes it down.
  const more = await where({ nav: 3 });
  await touch('touchStart', [more]);
  await outlast(page, 500);
  for (let i = 1; i <= 24; i++) await touch('touchMove', [{ x: more.x, y: more.y - i * 24 }]);
  // (The finger still down: the moves reach the app with the page's frames, so the sheet is there once they have.)
  await until(() => page.evaluate(() => window.__cp.ctx.eqSheet.shown), { message: 'the sheet never followed the finger' });
  await touch('touchEnd', []);
  await until(async () => { const t = await state(); return t.nav === 'nav_eq' && t.scene === 'scene_eq'; }, { message: 'the Equaliser never opened' });
  await until(() => page.evaluate(() => !window.__cp.ctx.eqSheet.shown), { message: 'the sheet never settled' });
  await page.evaluate(() => history.back());
  await until(async () => { const t = await state(); return t.nav === 'nav_lib' && t.scene === 'scene_lib'; }, { message: 'Back never took the Equaliser down' });
  await until(() => page.evaluate(() => !window.__cp.ctx.eqSheet.shown), { message: 'the sheet never went' });
  await atRest();
  assert.equal((await state()).root, 'library', 'the Library is under it as it was');

  // Forgotten favourites' See all: exactly the liked or often played songs not played for 90 days, newest forgotten first.
  await tap({ nav: 0 });
  await atRest();
  await page.evaluate(() => { const l = window.__cp.ctx.listWidget.libList, src = l.source, g = l.geometry(); const i = src.rows.findIndex((r) => r.type === 'homeHead' && r.title === 'Forgotten favourites'); l.scrollTo(g.headerH + l.itemTop(g, i) - 200); });
  await tap({ seeAll: 'Forgotten favourites' });
  await atRest();
  s = await state();
  assert.equal(s.v2List, 'forgotten');
  assert.equal(s.key, 'tracks:forgotten');
  const listed = await page.evaluate(() => window.__cp.ctx.listWidget.stack.at(-1).tracks.map((t) => ({ id: t.id, liked: t.rating === 5, plays: t.plays, last: t.lastPlayed })));
  const want = await page.evaluate(() => {
    const now = Date.now(), cut = now - 90 * 86_400_000;
    return window.__cp.ctx.library.tracks.filter((t) => t.lastPlayed && t.lastPlayed <= cut && (t.rating === 5 || t.plays >= 5)).sort((a, b) => b.lastPlayed - a.lastPlayed).map((t) => t.id);
  });
  assert.ok(want.length > 3, 'the invented library has forgotten favourites');
  assert.deepEqual(listed.map((t) => t.id), want);

  assert.deepEqual(errors, []);
  await context.close();
});

test('the default layout: no query opens the v2 layout; Classic library layout in Settings turns it in place, kept for the next start, and back', opts, async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const ready = () => page.waitForFunction(() => window.__cp?.player?.queue?.length === 4 && !!window.__cp.ctx.listWidget, null, { timeout: 60_000 });
  await page.goto(`${base}/music/?demo`);
  await ready();
  const { state, atRest, tap } = await helpers(context, page);
  /** The navbar's buttons (id and words, in order), the menu's Equaliser line, the library's first screen, what the player holds. */
  const layout = () => page.evaluate(() => {
    const { ctx, player } = window.__cp, lw = ctx.listWidget;
    return {
      v2: ctx.homeV2, bar: ctx.navbar.buttons.children.map((b) => `${b.id}:${b.contentDescription}`), eqLine: ctx.navbar.ext.findViewById('navbar_ext_eq')?.visibility ?? null,
      root: lw.stack[0]?.isHomeV2 ? 'home' : lw.stack[0]?.isLibraryV2 ? 'library' : lw.stack[0]?.home ? 'classic' : null, shown: lw.libList.source === lw.stack[0],
      player: { queue: player.queue.map((t) => t.id).join(), index: player.index, state: player.state }, same: window.__samePage === true,
    };
  });
  const V2 = ['cmd_nav_to_lib:Home', 'cmd_nav_to_search:Search', 'cmd_nav_to_eq:Library', 'cmd_nav_more:Main Menu'];
  /** Settings › Lists, its Classic library layout row tapped (once Settings takes taps: settings.js openedAt), Settings closed. */
  const flip = async () => {
    await page.evaluate(() => window.__cp.ctx.settingsUi.open('library_lists'));
    await until(() => page.evaluate(() => performance.now() - window.__cp.ctx.settingsUi.openedAt > 450), { message: 'Settings never took taps' });
    const was = await page.evaluate(() => window.__cp.ctx.homeV2);
    const row = page.locator('.cps-row', { hasText: 'Classic library layout' });
    await row.click();
    await until(() => page.evaluate((was) => window.__cp.ctx.homeV2 === !was, was), { message: 'the layout never changed' });
    assert.equal(await row.locator('.cps-switch.on').count(), was ? 1 : 0, 'the switch shows the classic layout on or off');
    await page.locator('.cps-bar-btn[aria-label="Close"]').click();
    // Closed once its history entries are gone too (closeAll's popstate, settings.js consumeClose): a tap before then
    // would race that Back.
    await until(() => page.evaluate(() => !window.__cp.ctx.settingsUi.isOpen && !window.__cp.ctx.settingsUi.closing), { message: 'Settings never closed' });
    await atRest();
  };

  // With no query and nothing saved: the v2 layout.
  await page.evaluate(() => { window.__samePage = true; window.__cp.ctx.bus.post('bus_gui', 'cmd_nav_to_lib'); });
  await atRest();
  let l = await layout();
  const player = l.player;
  assert.deepEqual({ v2: l.v2, bar: l.bar, eqLine: l.eqLine, root: l.root, shown: l.shown }, { v2: true, bar: V2, eqLine: 0, root: 'home', shown: true });

  // On: the classic navbar and category home, in place: the same page (no reload), the player as it was.
  await flip();
  l = await layout();
  assert.deepEqual(l, { v2: false, bar: ['cmd_nav_to_lib:Library', 'cmd_nav_to_eq:Equ/Effects', 'cmd_nav_to_search:Search', 'cmd_nav_more:Main Menu'], eqLine: 8, root: 'classic', shown: true, player, same: true });
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('cp-settings')).cp_classic_library), true, 'the option is kept');
  // Its Equaliser button opens the Equaliser screen (not the sheet), and its Library button the category home.
  await tap({ nav: 1 });
  await until(async () => { const t = await state(); return t.nav === 'nav_eq' && t.scene === 'scene_eq'; }, { message: 'the Equaliser never opened' });
  assert.equal(await page.evaluate(() => window.__cp.ctx.eqSheet.shown), false, 'no sheet in the classic layout');
  await tap({ nav: 0 });
  await atRest();
  assert.equal((await layout()).root, 'classic');

  // The next start keeps it.
  await page.reload();
  await ready();
  await page.evaluate(() => { window.__samePage = true; window.__cp.ctx.bus.post('bus_gui', 'cmd_nav_to_lib'); });
  await atRest();
  l = await layout();
  assert.deepEqual({ v2: l.v2, root: l.root, bar: l.bar[0] }, { v2: false, root: 'classic', bar: 'cmd_nav_to_lib:Library' });

  // Off again: the v2 layout in place, its Library tab working.
  const now = l.player;
  await flip();
  l = await layout();
  assert.deepEqual(l, { v2: true, bar: V2, eqLine: 0, root: 'home', shown: true, player: now, same: true });
  await tap({ nav: 2 });
  await atRest();
  assert.equal((await state()).root, 'library');

  assert.deepEqual(errors, []);
  await context.close();
});

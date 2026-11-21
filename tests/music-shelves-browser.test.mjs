// Music's shelves in Chromium at phone size (frontend/music/, MUSIC.md §2.3), over an invented library
// (tests/fixtures/music-shelves-library.mjs; no audio, no network): Albums lists albums, Singles the
// shorter releases and loose songs, Artists those with a body of work and then "All artists (N)", an
// album's page shows numbered rows with no second line unless another artist sings (and "Disc N"
// subheads on a two-disc album), an artist's page its albums as covers and then its singles, and
// Possible duplicates its groups under subheads. No row repeats its page's header.
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

/** Opens a list (a home category by id, or a row of the shown list by its title) and waits for it to rest. */
const open = async (page, how) => {
  await page.evaluate(async (how) => {
    const { ctx } = window.__cp, lw = ctx.listWidget;
    const m = await import('/music/src/list/sources.js');
    if (how.home != null) { lw.openHome(); lw.open(m.categorySource(ctx, lw.libList, lw.nav, m.homeCategory(how.home))); return; }
    const s = lw.stack[lw.stack.length - 1];
    for (let i = 0; i < s.count; i++) {
      const g = s.pageRows ? s.pageRows[i]?.group : s.groups?.[i];
      if ((g?.title ?? (i === s.groups.length ? 'All artists' : '')).startsWith(how.row)) { s.onItemClick(i); return; }
    }
    throw new Error('no row ' + how.row);
  }, how);
  await until(() => page.evaluate(() => { const lw = window.__cp.ctx.listWidget; return lw.mode === 'list' && !lw.trans && lw.libList.source === lw.stack[lw.stack.length - 1]; }), { message: 'the list never came to rest' });
};

/** The shown list: its header's texts and every row's texts (scrolled through), subheads as "— text". */
const shown = (page) => page.evaluate(async () => {
  const l = window.__cp.ctx.listWidget.libList, s = l.source, rows = new Map();
  const text = (v, id) => { const t = v.findViewById(id); return t && t.visibility !== 8 ? t.text ?? '' : ''; };
  const head = l.active.get(-1);
  const header = head ? [text(head, 'title'), text(head, 'line2'), text(head, 'meta')] : [];
  for (let y = 0; ; y += l.height / 2) {
    l.scrollTo(y);
    l.placeItems();
    for (const [i, v] of l.active) {
      if (i < 0) continue;
      rows.set(i, s.isSeparator?.(i) ? '— ' + text(v, 'title') : [text(v, 'title'), text(v, 'line2'), text(v, 'meta')].join(' | '));
    }
    if (y >= l.maxScroll()) break;
  }
  l.scrollTo(0);
  return { header, rows: [...rows.keys()].sort((a, b) => a - b).map((i) => rows.get(i)), count: s.count };
});

test('Albums, Singles, Artists, album and artist pages and Possible duplicates', opts, async () => {
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

  // The home: Singles beside Albums, Possible duplicates last (there are some).
  const home = await page.evaluate(() => { const lw = window.__cp.ctx.listWidget; lw.openHome(); return lw.stack[0].items.map((c) => c.title); });
  assert.equal(home[home.indexOf('albums') + 1], 'singles');
  assert.equal(home.at(-1), 'possible_duplicates');

  await open(page, { home: 3 });
  let s = await shown(page);
  assert.deepEqual(s.rows.map((r) => r.split(' | ')[0]), ['Coastal Roads Vol. 1', 'Lantern Season', 'Small Rooms', 'Tidewater', 'Untitled Tapes']);

  await open(page, { home: 20 });
  s = await shown(page);
  assert.equal(s.header[0], 'Singles');
  assert.equal(s.header[1], '9', 'the header counts the singles');
  assert.deepEqual(s.rows.map((r) => r.split(' | ')[0]), ['Night Ferry', 'Paper Moon', 'Attic (Demo)', 'Front Room (Demo)', 'glass  coast', 'Salt', 'Undertow', 'Undertow (Live)', 'Undertow']);

  await open(page, { home: 4 });
  s = await shown(page);
  assert.deepEqual(s.rows.map((r) => r.split(' | ')[0]), ['Harbor Lights', 'Juno Park', 'Mira Vale', 'All artists (6)']);
  // Each artist row's second line: "N albums · N songs" (albums as the shelves count them, a compilation
  // included, as on the artist's page), "N songs" alone with none.
  assert.deepEqual(s.rows.slice(0, 3).map((r) => r.split(' | ')[1]), ['3 albums · 12 songs', '3 albums · 9 songs', '1 album · 5 songs']);
  await open(page, { row: 'All artists' });
  s = await shown(page);
  assert.equal(s.header[0], 'All artists');
  assert.deepEqual(s.rows.map((r) => r.split(' | ')[0]), ['Harbor Lights', 'Harbor Lights feat. Mira Vale', 'Juno Park', 'Mira Vale', 'Mira Vale feat. Juno Park', 'Odd Copper']);
  assert.deepEqual(s.rows.map((r) => r.split(' | ')[1]), ['3 albums · 12 songs', '1 album · 1 song', '3 albums · 9 songs', '1 album · 5 songs', '1 song', '1 album · 1 song']);

  // An album's page: name, artist, "year · N songs · length"; numbered rows, a second line only for a guest.
  await open(page, { home: 3 });
  await open(page, { row: 'Tidewater' });
  s = await shown(page);
  assert.deepEqual(s.header, ['Tidewater', 'Harbor Lights', '2019 · 5 songs · 17:59']);
  assert.deepEqual(s.rows, ['1. First Light |  | 3:01', '2. Night ferry! |  | 3:24', '3. Rope and Anchor |  | 3:53', '4. Shoals |  | 3:19', '5. Low Water | Harbor Lights feat. Mira Vale | 4:22']);
  // Rows without a second line take the one-line scene at the same height.
  const scenes = await page.evaluate(() => { const l = window.__cp.ctx.listWidget.libList; return [...l.active].filter(([i]) => i >= 0).map(([i, v]) => [i, v.itemScene, v.height]); });
  assert.ok(scenes.every(([i, sc]) => (i < 4 ? sc === 'scene_1' : sc === 'defaultScene')), JSON.stringify(scenes));
  assert.equal(new Set(scenes.map((x) => x[2])).size, 1, 'every row is as tall');

  // A two-disc album: "Disc N" subheads, disc then track order.
  await open(page, { home: 3 });
  await open(page, { row: 'Lantern Season' });
  s = await shown(page);
  assert.deepEqual(s.header, ['Lantern Season', 'Harbor Lights', '2022 · 5 songs · 16:40']);
  assert.deepEqual(s.rows, ['— Disc 1', '1. Kindling |  | 3:20', '2. Ember Road |  | 3:20', '3. Wick |  | 3:20', '— Disc 2', '1. Second Wind |  | 3:20', '2. Last Lantern |  | 3:20']);

  // An artist's page: albums as covers (newest first, "year · N songs"), then Singles with each release's name.
  await open(page, { home: 4 });
  await open(page, { row: 'Harbor Lights' });
  s = await shown(page);
  assert.deepEqual(s.header.filter(Boolean), ['Harbor Lights', '3 albums · 12 songs']);
  assert.deepEqual(s.rows, ['Lantern Season | 2022 · 5 songs | ', 'Coastal Roads Vol. 1 | 2020 · 4 songs | ', 'Tidewater | 2019 · 5 songs | ', '— Singles', 'Night Ferry |  | MP3 44.1kHz 320kbps', 'Paper Moon | Paper Moon | FLAC 44.1kHz 900kbps']);
  const cells = await page.evaluate(() => { const l = window.__cp.ctx.listWidget.libList; return [0, 1, 2, 4].map((i) => l.itemRect(i)).map((r) => [Math.round(r.left), Math.round(r.width)]); });
  assert.equal(cells[0][1], cells[1][1], 'the albums are a grid');
  assert.ok(cells[1][0] > cells[0][0] && cells[2][0] === cells[0][0], 'two covers a row');
  assert.ok(cells[3][1] > cells[0][1] * 1.5, 'the singles are full-width rows');
  const allSongs = await page.evaluate(() => { const l = window.__cp.ctx.listWidget.libList; const v = l.active.get(-103); return v?.findViewById('title')?.text; });
  assert.equal(allSongs, 'All Artist Songs', 'All Artist Songs stays the first row');

  await open(page, { home: 21 });
  s = await shown(page);
  assert.equal(s.header[0], 'Possible duplicates');
  assert.deepEqual(s.rows, [
    '— Glass Coast · Mira Vale · 2', 'Glass Coast | Coastal Roads Vol. 1 · MP3 · 256kbps · 3:20 | ', 'glass  coast | Glass Coast · FLAC · 1010kbps · 4:01 | ',
    '— Night Ferry · Harbor Lights · 2', 'Night Ferry | MP3 · 320kbps · 3:25 | ', 'Night ferry! | Tidewater · FLAC · 900kbps · 3:24 | ',
  ]);
  // A duplicate row is an ordinary song row: a tap plays it.
  await page.evaluate(() => { const s = window.__cp.ctx.listWidget.libList.source; s.onItemClick(2); });
  await until(() => page.evaluate(() => window.__cp.player.track?.title === 'glass  coast'), { message: 'the row did not play' });
  await page.evaluate(() => window.__cp.ctx.bus.post('bus_gui', 'cmd_nav_to_lib'));
  await until(() => page.evaluate(() => { const lw = window.__cp.ctx.listWidget; return lw.mode === 'list' && !lw.trans; }), { message: 'the library never came back' });

  // No row repeats its page's header (the album's name, the artist's name).
  for (const [row, words] of [[{ home: 3 }, null], [{ row: 'Tidewater' }, ['Tidewater']], [{ home: 4 }, null], [{ row: 'Juno Park' }, ['Juno Park']]]) {
    await open(page, row);
    if (!words) continue;
    s = await shown(page);
    for (const r of s.rows) for (const w of words) assert.ok(!r.split(' | ').slice(1).some((x) => x.includes(w)), `"${r}" repeats "${w}"`);
  }
  assert.deepEqual(errors, []);
  await context.close();
});

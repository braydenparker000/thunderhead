// Music's lists while they scroll (frontend/music/src/list/power-list.js, ui/scroll-log.js; MUSIC.md §5.10
// "Scrolling"), in the real player at phone size with touch, over an invented library made in the page (no
// audio, no network). The rows lie in one layer the compositor moves (the list's content element) and a scroll
// writes only the views that changed; what must not change with that: after drags and a fling of the Library's
// Songs, of the Albums grid and of Home, each row shown is the one at its place, bound to its own song or album,
// and its box on screen is where the list's own geometry puts it, the same as when the list is placed afresh at
// that scroll. The scroll recorder: one entry a gesture, with the screen, the layout and frames, and the
// session's summary in the playback log's state; nothing but counts and the screens' own names.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { until } from './fixtures/waits.mjs';

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

/** In the page: 2,400 invented songs over 200 albums of 12, with plays and likes. */
function inventLibrary() {
  const DAY = 86_400_000, now = Date.now();
  const w1 = ['Amber', 'Velvet', 'Hollow', 'Paper', 'Silver', 'Quiet', 'Neon', 'Copper', 'Lunar', 'Wild'];
  const w2 = ['Rivers', 'Engines', 'Gardens', 'Signals', 'Harbors', 'Pilots', 'Lanterns', 'Foxes'];
  return Array.from({ length: 2400 }, (_, i) => {
    const a = Math.floor(i / 12), artist = `${w1[a % 10]} ${w2[a % 8]} ${a % 40}`;
    return { id: 'sc' + i, title: `Song ${String(i).padStart(4, '0')}`, artist, album: `Album ${String(a).padStart(3, '0')}`, albumArtist: artist, track: (i % 12) + 1, year: 1970 + (a % 50),
      durationMs: 180_000 + (i % 60) * 1000, format: 'FLAC', bitrate: 900, sampleRate: 44100, bits: 16, fileName: `sc${i}.flac`, added: now - (i % 300) * DAY,
      plays: i % 7, lastPlayed: i % 7 ? now - (i % 90) * DAY : 0, rating: i % 11 === 0 ? 5 : 0 };
  });
}

/** In the page: each row shown, with what it shows and where; and where the list's geometry puts it. A Home shelf
 * (home/shelf.js) shows the covers in its `shown`, each by its place in the strip and whether it is bound to that
 * place's own item: its children also hold the covers it keeps spare (gone, still bound to what they showed last),
 * in the order they were made, so its first child's title is no reading of what it shows. */
const shownRows = () => {
  const { ctx } = window.__cp, l = ctx.listWidget.libList, k = ctx.dpr;
  const box = l.el.getBoundingClientRect();
  const titleOf = (v) => v.title?.text ?? v.findViewById?.('title')?.text ?? '';
  const covers = (v) => [...v.shown].sort((a, b) => a[0] - b[0])
    .map(([at, c]) => `${at}:${titleOf(c)}${c.visibility === 0 && c.record === v.row.items[at]?.record ? '' : ' (not its own)'}`).join(',');
  return [...l.active].filter(([i, v]) => i >= 0 && v.visibility === 0).sort((a, b) => a[0] - b[0]).map(([i, v]) => {
    const r = v.el.getBoundingClientRect(), want = l.itemRect(i);
    const text = v.shown instanceof Map ? 'shelf|' + covers(v) : titleOf(v) + '|' + (v.line2?.text ?? '');
    return { i, type: v.listItemType, text, at: [r.left - box.left, r.top - box.top], want: want ? [want.left / k, want.top / k] : null };
  });
};

test('rows after drags and flings are the rows of their places, where the list puts them; one recorder entry a gesture', opts, async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/music/?demo`);
  await page.waitForFunction(() => window.__cp?.player?.queue?.length === 4 && !!window.__cp.ctx.homeTabs, null, { timeout: 60_000 });
  await page.evaluate(async (src) => {
    const { ctx } = window.__cp;
    await ctx.library.r2Ready?.catch(() => {});
    const tracks = eval(`(${src})`)();
    ctx.library.withUserData(tracks);
    ctx.library.setTracks(tracks);
    ctx.bus.post('bus_gui', 'cmd_nav_to_lib');
  }, inventLibrary.toString());
  const cdp = await context.newCDPSession(page);
  const touch = (type, pts, timestamp) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p) => ({ x: p.x, y: p.y, id: 1 })), timestamp });
  // Each event says when it happened, 16 ms apart, so a finger's speed is the same on any machine: by the machine's
  // own clock a slow frame between two moves (over 40 ms, gesture.js VelocityTracker) read as a finger that had
  // stopped, and the fling never came. The times only go forward, gesture after gesture.
  let clock = 0;
  /** A drag from y0 to y1 at x, in steps 16 ms apart: let go while moving it flings (few steps, fast); with `hold` the
   * finger rests 100 ms before it lifts, a drag alone. */
  const drag = async (x, y0, y1, steps = 10, { hold = false } = {}) => {
    const t0 = Math.max(Date.now() / 1000, clock + 0.05), at = (/** @type {number} */ i) => t0 + (i * 16) / 1000;
    await touch('touchStart', [{ x, y: y0 }], at(0));
    for (let i = 1; i <= steps; i++) await touch('touchMove', [{ x, y: y0 + ((y1 - y0) * i) / steps }], at(i));
    clock = hold ? at(steps) + 0.1 : at(steps) + 0.008;
    await touch('touchEnd', [], clock);
  };
  /** In the page: the lowest point at x (CSS px) where a finger lands on the list itself, not on what lies over its
   * foot (the navbar with its mini player, the list's bottom toolbar): a drag from there is the list's. From a
   * fixed y of 700 the fling moved the Songs not at all, in two runs: the finger was not on the list. */
  const footOf = (x) => page.evaluate(async (x) => {
    const { ctx } = window.__cp, l = ctx.listWidget.libList, k = ctx.dpr;
    const { hitTest } = await import('/music/src/input.js');
    const r = document.getElementById('cp-root').getBoundingClientRect();
    const lists = (y) => {
      for (let v = hitTest(ctx.root, (x - r.left) * k, (y - r.top) * k); v; v = v.parent) {
        if (v === l.toolbarView) return false;
        if (v === l) return true;
      }
      return false;
    };
    for (let y = Math.floor(r.bottom) - 1; y > r.top + 4; y--) if (lists(y) && lists(y - 2) && lists(y - 4)) return y - 2;
    return null;
  }, x);
  const scrollOf = () => page.evaluate(() => { const l = window.__cp.ctx.listWidget.libList; return { y: l.scrollY, over: l.over, k: window.__cp.ctx.dpr }; });
  /** A drag up by `dist` px from the list's own foot (footOf), as `drag`; returns the list's scroll before and after, once at rest. */
  const swipe = async (dist, steps, how) => {
    const y0 = await footOf(200);
    assert.ok(y0 != null && y0 - dist > 0, `a drag of ${dist} px from the list's foot fits on screen (foot at ${y0})`);
    const from = await scrollOf();
    await drag(200, y0, y0 - dist, steps, how);
    await atRest();
    return { y0, from, to: await scrollOf() };
  };
  /** A slow drag moved the list exactly as far as the finger went after its touch slop (gesture.js TOUCH_SLOP_DP). */
  const followed = (what, dist, { y0, from, to }) => {
    const want = (dist - 8) * to.k, got = to.y - from.y;
    assert.ok(Math.abs(got - want) <= 2 && !to.over, `${what}: the list followed the finger from y ${y0}: scrolled ${got} px, the finger ${want} px past its slop (overscroll ${to.over})`);
  };
  /** A fling carried the list on past where the finger let go. */
  const flung = (what, dist, { y0, from, to }) => {
    const finger = (dist - 8) * to.k, got = to.y - from.y;
    assert.ok(got > finger, `${what}: the fling from y ${y0} scrolled on past the finger: ${got} px, the finger ${finger} px (scroll ${from.y} → ${to.y})`);
  };
  /** The list at rest: no transition, no drag, fling or spring, nothing moving, rows placed; the recorder idle. */
  const atRest = () => until(() => page.evaluate(() => {
    const { ctx } = window.__cp, lw = ctx.listWidget, l = lw.libList;
    return ctx.topNav.nav === 'nav_lib' && !ctx.topNav.scenes.running && !lw.trans && !l._fling && !l.springAnim && !l.drag && !ctx.scrolling.size && !ctx.scrollLog.target && l.active.size > 0;
  }), { message: 'the list never came to rest' });
  /** The rows shown, each where the list's geometry puts it and the same after the list is placed afresh at that scroll. */
  const near = (a, b) => !!a && !!b && Math.abs(a[0] - b[0]) <= 1 && Math.abs(a[1] - b[1]) <= 1;
  const check = async (what, least = 4) => {
    await atRest();
    const rows = await page.evaluate(shownRows);
    assert.ok(rows.length >= least, `${what}: rows are shown`);
    for (const r of rows) assert.ok(near(r.at, r.want), `${what}: row ${r.i} at ${r.at}, the list puts it at ${r.want}`);
    for (const r of rows) assert.ok(!r.text.includes('(not its own)'), `${what}: row ${r.i}'s covers are each its own place's: ${r.text}`);
    // The list placed afresh at the same scroll (its rows given back and taken again, the page written whole).
    await page.evaluate(() => {
      const { ctx } = window.__cp, l = ctx.listWidget.libList, y = l.scrollY;
      l.setSource(l.source);
      l.scrollTo(y);
      ctx.layoutNow();
    });
    const again = await page.evaluate(shownRows);
    assert.deepEqual(again.map((r) => [r.i, r.text]), rows.map((r) => [r.i, r.text]), `${what}: the same rows as a list placed afresh`);
    for (const [n, r] of again.entries()) assert.ok(near(r.at, rows[n].at), `${what}: row ${r.i} in the same place`);
    return rows;
  };
  const entries = () => page.evaluate(() => window.__cp.ctx.scrollLog.entries.map((e) => ({ ...e })));

  // The Library's Songs: two slow drags up and a fling.
  await page.evaluate(() => { window.__cp.ctx.libraryChip = 'songs'; window.__cp.ctx.homeTabs.go('library'); });
  await atRest();
  const before = (await entries()).length;
  followed('songs, first drag', 400, await swipe(400, 20, { hold: true }));
  await check('songs, dragged');
  followed('songs, second drag', 350, await swipe(350, 20, { hold: true }));
  flung('songs', 500, await swipe(500, 4));
  const songs = await check('songs, flung');
  assert.ok(songs[0].i > 10, `the fling scrolled on (first row ${songs[0].i})`);
  const log = (await entries()).slice(before);
  assert.equal(log.length, 3, `one entry a gesture: ${JSON.stringify(log)}`);
  for (const e of log) {
    assert.equal(e.screen, 'library-songs');
    assert.equal(e.layout, 'list');
    assert.ok(e.frames > 0 && e.ms > 0 && e.worstMs > 0 && e.late >= e.jank && e.frames >= e.late, `counts: ${JSON.stringify(e)}`);
    assert.deepEqual(Object.keys(e).sort(), ['covers', 'frames', 'jank', 'late', 'layout', 'ms', 'rows', 'screen', 'worstMs', 'zoom'].sort(), 'numbers and names only');
  }
  assert.ok(log.some((e) => e.rows > 0), 'the rows bound are counted');

  // The Albums grid, the same way.
  // (A tab's button on its own tab only scrolls it to the top: by Home, the Library comes back at the chip.)
  await page.evaluate(() => { localStorage.setItem('cp-list-opts', JSON.stringify({ 'cat:albums': { zoom: 5 } })); window.__cp.ctx.libraryChip = 'albums'; window.__cp.ctx.homeTabs.go('home'); window.__cp.ctx.homeTabs.go('library'); });
  await atRest();
  followed('albums grid, drag', 400, await swipe(400, 20, { hold: true }));
  flung('albums grid', 500, await swipe(500, 4));
  assert.equal(await page.evaluate(() => window.__cp.ctx.listWidget.libList.source.libraryChip), 'albums');
  const grid = await check('albums grid, flung');
  assert.ok(new Set(grid.map((r) => r.at[0])).size > 1, 'a grid: tiles side by side');
  assert.ok((await entries()).some((e) => e.screen === 'library-albums' && e.layout === 'grid'));

  // Home: down past its shelves. Its shelves are built in idle time (home/data.js warmHome: never within
  // 300 ms of a touch nor while a list moves), so after the gestures above Home can still show what it had
  // before this library came: the demo's few songs, too short to scroll (a fling from its foot moved it 0 → 0).
  // It opens once its shelves are this library's.
  await until(() => page.evaluate(() => {
    const { ctx } = window.__cp, k = ctx.homeDataKept;
    return !!k && k.tracks === ctx.library.tracks && !k.stale && !ctx.homeWarming;
  }), { timeout: 30_000, message: "Home's shelves of this library were never built" });
  await page.evaluate(() => window.__cp.ctx.homeTabs.go('home'));
  await atRest();
  const homeMax = await page.evaluate(() => { const l = window.__cp.ctx.listWidget.libList; return { max: l.maxScroll(), home: !!l.source?.isHomeV2 }; });
  assert.ok(homeMax.home && homeMax.max > 0, `home is shown with room to scroll (${JSON.stringify(homeMax)})`);
  const home = await swipe(500, 4);
  assert.ok(home.to.y > home.from.y, `home: the fling from y ${home.y0} moved it (scroll ${home.from.y} → ${home.to.y}, most ${homeMax.max})`);
  await check('home, flung', 2);

  // The session's summary goes with the playback batches: per screen, counts only.
  const state = await page.evaluate(async () => {
    const { stateOf } = await import('/th/music/report-batch.js');
    return stateOf(window.__cp.ctx.playbackLog.snapshot());
  });
  const songsSum = state.scrolls.find((s) => s.screen === 'library-songs');
  assert.ok(songsSum && songsSum.scrolls >= 3 && songsSum.frames > 0 && songsSum.p95Ms > 0 && songsSum.worstMs >= songsSum.p95Ms - 1, `the summary: ${JSON.stringify(state.scrolls)}`);
  assert.ok(state.start.boot > 0 && state.start.ready >= state.start.boot, `start steps: ${JSON.stringify(state.start)}`);
  assert.deepEqual(errors, []);
  await context.close();
});

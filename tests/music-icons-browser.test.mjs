// Music's icons stay painted (MUSIC.md §5.11, "Icons that disappeared"): the navbar's icons, the library
// sections' symbols and the A–Z bar, in Chromium at phone size (frontend/music/, the demo songs), after
// the screens were built ahead and then opened, after a transition turned back mid-way and interrupted,
// and after rapid changes of screen. Each is checked in pixels at rest, not only in the DOM:
// - painted: its box's pixels change when its marks are hidden (something is drawn there);
// - drawn as defined: an icon cut out by an SVG mask looks the same when its mask is given an id no other
//   element has (a `url(#id)` resolves to the first element with that id in the page: when that one is in
//   a hidden copy of a screen, the shown icon lost its cut-out).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { outlast, until } from './fixtures/waits.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (the demo songs)', timeout: 240_000 };
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

const still = (page) => page.evaluate(() => {
  const c = window.__cp.ctx;
  return !c.topNav.scenes.running && !c.listWidget.trans && !c.moving?.size && !c.tweens.size && !c.frameCallbacks.size;
});
/** At rest, after the idle work a rest lets run (the deferred work of view/motion.js, rows built ahead). */
const rest = async (page, what) => {
  await until(() => still(page), { message: `${what}: never came to rest` });
  await page.evaluate(() => new Promise((r) => requestIdleCallback(() => requestAnimationFrame(() => setTimeout(r)), { timeout: 2000 })));
  await until(() => still(page), { message: `${what}: never came to rest` });
};
/** The next animation frame of the page (a transition in flight is then one frame further). */
const frame = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
const nav = (page, cmd) => page.evaluate((c) => window.__cp.ctx.bus.post('bus_gui', c), cmd);

/** Tags what must be painted: the navbar's icons, the shown library rows' symbols, the A–Z bar. */
const targets = (page) => page.evaluate(() => {
  const { ctx } = window.__cp;
  for (const e of document.querySelectorAll('[data-paint]')) delete e.dataset.paint;
  const out = [];
  const tag = (el, name, marks) => {
    el.dataset.paint = String(out.length);
    out.push({ i: out.length, name, marks });
  };
  for (const b of ctx.root.findViewById('navbar_nav_buttons')?.children ?? []) if (b.visibility === 0) tag(b.el, `navbar ${b.id}`, 'svg');
  const lw = ctx.listWidget;
  if (lw.mode === 'list') {
    const rows = lw.libList.el.getBoundingClientRect();
    // (The rows behind the floating navbar are covered by it.)
    const bottom = Math.min(rows.bottom, ctx.root.findViewById('navbar')?.el.getBoundingClientRect().top ?? rows.bottom);
    for (const svg of lw.libList.el.querySelectorAll('svg')) {
      const op = svg.parentElement, r = op.getBoundingClientRect();
      // A row's symbol: at the row's start, inside the list's box above the navbar, and shown.
      if (r.width && r.left - rows.left < 80 && r.top >= rows.top && r.bottom <= bottom && getComputedStyle(op).visibility !== 'hidden') tag(op, `row symbol at ${Math.round(r.top)}`, 'svg');
    }
  }
  const sc = ctx.listScroller;
  if (lw.mode === 'list' && sc?.mode === 2 && sc.visibility === 0) tag(sc.el, 'A–Z bar', '.ops');
  return out;
});

/** The share of two same-sized screenshots' pixels that differ clearly (by more than 64 in a channel). */
const differ = (page, a, b) => page.evaluate(async ([a, b]) => {
  const px = async (b64) => {
    const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0))], { type: 'image/png' }));
    const c = new OffscreenCanvas(bmp.width, bmp.height), g = c.getContext('2d');
    g.drawImage(bmp, 0, 0);
    return g.getImageData(0, 0, bmp.width, bmp.height).data;
  };
  const [x, y] = await Promise.all([px(a), px(b)]);
  let n = 0;
  for (let i = 0; i < x.length; i += 4) if (Math.max(Math.abs(x[i] - y[i]), Math.abs(x[i + 1] - y[i + 1]), Math.abs(x[i + 2] - y[i + 2])) > 64) n++;
  return n / (x.length / 4);
}, [a.toString('base64'), b.toString('base64')]);

/** Whether a tagged target is painted, and drawn as its icon defines it. */
async function paintOf(page, t) {
  const clip = await page.evaluate((i) => {
    const r = document.querySelector(`[data-paint="${i}"]`).getBoundingClientRect();
    const x = Math.max(0, r.left), y = Math.max(0, r.top);
    return { x, y, width: Math.min(r.right, innerWidth) - x, height: Math.min(r.bottom, innerHeight) - y };
  }, t.i);
  if (!(clip.width > 0 && clip.height > 0)) return `${t.name}: no box on screen`;
  const shown = await page.screenshot({ clip });
  const hide = (on) => page.evaluate(([i, marks, on]) => {
    for (const m of document.querySelector(`[data-paint="${i}"]`).querySelectorAll(marks)) m.style.visibility = on ? 'hidden' : '';
  }, [t.i, t.marks, on]);
  await hide(true);
  const hidden = await page.screenshot({ clip });
  await hide(false);
  if (shown.equals(hidden)) return `${t.name}: nothing painted`;
  const masked = await page.evaluate((i) => {
    const el = document.querySelector(`[data-paint="${i}"]`);
    const svgs = [...el.querySelectorAll('svg')].filter((s) => s.querySelector('[id]'));
    for (const s of svgs) {
      s.dataset.was = s.innerHTML;
      // The same icon, its ids no other element has.
      s.innerHTML = s.innerHTML.replace(/(id="|url\(#)([^")]+)/g, (m, a, id) => `${a}${id}-own${i}`);
    }
    return svgs.length;
  }, t.i);
  if (!masked) return null;
  const own = await page.screenshot({ clip });
  await page.evaluate((i) => {
    for (const s of document.querySelector(`[data-paint="${i}"]`).querySelectorAll('svg[data-was]')) {
      s.innerHTML = s.dataset.was;
      delete s.dataset.was;
    }
  }, t.i);
  // (Text inside a mask may move its edges by a shade when drawn again: a lost cut-out changes far more.)
  const changed = await differ(page, shown, own);
  return changed <= 0.02 ? null : `${t.name}: its mask drew another copy's (a hidden one's) cut-out (${Math.round(changed * 100)} % of its pixels)`;
}

async function check(page, what, want) {
  await rest(page, what);
  const ts = await targets(page);
  for (const kind of want) assert.ok(ts.some((t) => t.name.startsWith(kind)), `${what}: ${kind} is on screen`);
  const bad = [];
  for (const t of ts) {
    const b = await paintOf(page, t);
    if (b) bad.push(b);
  }
  assert.deepEqual(bad, [], `${what}: every icon, symbol and the A–Z bar painted`);
}

test('the navbar icons, the library symbols and the A–Z bar stay painted', opts, async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // The classic layout (?home1): its navbar's Library and Equaliser icons and its home rows' symbols are checked.
  await page.goto(`${base}/music/?demo&home1`);
  await page.waitForFunction(() => window.__cp?.player?.queue?.length === 4 && !!window.__cp.ctx.feelLog, null, { timeout: 60_000 });
  await until(() => page.evaluate(() => window.__cp.ctx.prebuilt?.done !== false), { message: 'the screens were never built' });

  // Built ahead, then opened: the library at its start.
  await nav(page, 'cmd_nav_to_lib');
  await check(page, 'the library, built ahead', ['navbar', 'row symbol']);

  // A name-sorted list (All Songs) shows the A–Z bar.
  const allSongs = await page.evaluate(() => {
    // The library's first row (All Songs), tapped where it shows.
    const list = window.__cp.ctx.listWidget.libList, at = list.el.getBoundingClientRect(), r = list.itemRect(0), px = window.__cp.ctx.px;
    return { x: at.left + px(r.left + r.width / 2), y: at.top + px(r.top + r.height / 2) };
  });
  await page.mouse.click(allSongs.x, allSongs.y);
  await until(() => page.evaluate(() => window.__cp.ctx.listScroller?.mode === 2), { message: 'All Songs never opened' });
  await check(page, 'All Songs', ['navbar', 'A–Z bar']);

  // A transition turned back mid-way, then interrupted by another.
  await nav(page, 'cmd_nav_to_main');
  await frame(page);
  await frame(page);
  await nav(page, 'cmd_nav_to_lib');
  await frame(page);
  await nav(page, 'cmd_nav_to_eq');
  await frame(page);
  await nav(page, 'cmd_nav_to_lib');
  await check(page, 'turned back and interrupted', ['navbar', 'A–Z bar']);

  // Rapid changes of screen, one frame apart, back to the library's start.
  for (const c of ['cmd_nav_to_eq', 'cmd_nav_to_search', 'cmd_nav_to_main', 'cmd_nav_to_lib', 'cmd_nav_to_main', 'cmd_nav_to_eq', 'cmd_nav_to_lib']) {
    await nav(page, c);
    await frame(page);
  }
  await nav(page, 'cmd_list_to_start');
  await check(page, 'rapid changes', ['navbar', 'row symbol']);

  // The recorder's own check (ui/icon-check.js, `iconsMissing` in Copy report) sees them all painted: it
  // reads 600 ms after the last change of screen has settled.
  await outlast(page, 700);
  await rest(page, 'the recorder');
  const rec = await page.evaluate(async () => {
    const { iconStates } = await import('/music/src/ui/icon-check.js');
    return { names: iconStates(window.__cp.ctx).map((s) => s.name), missing: window.__cp.ctx.feelLog.report().iconsMissing };
  });
  assert.ok(rec.names.filter((n) => n.startsWith('nav:')).length >= 3, `the recorder reads the navbar's icons (${rec.names})`);
  assert.deepEqual(rec.missing, []);

  assert.deepEqual(errors, []);
  await context.close();
});

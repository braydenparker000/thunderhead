// Music's heavy transitions at the screen's rate (MUSIC.md §5.11), in Chromium at phone size with the CPU
// slowed 4x (frontend/music/, the demo songs: no audio, no network). For each named transition (the player,
// the library, the equaliser, search, the art to its list and back with the shared art item, the navbar):
// - its frames are recorded inside the page, from the command to rest, and no gap between two frames is
//   over 50 ms (a timing read: enforced with TH_STRICT_TIMING=1, reported otherwise, fixtures/waits.mjs);
// - the end state's boxes (every shown view: place, size, opacity) equal the ones the code drew before the
//   rebuild of the transitions' frame work (tests/fixtures/music-transition-boxes.json, taken from the
//   code as it was; TH_CAPTURE_BOXES=<file> writes them again from the code as it is).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { timing, until } from './fixtures/waits.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (the demo songs)', timeout: 240_000 };
const capture = process.env.TH_CAPTURE_BOXES;
const REFERENCE = new URL('./fixtures/music-transition-boxes.json', import.meta.url);
const MAX_GAP_MS = 50;
let site, browser, base;

// The shared art item morphing into its row and back (scene:scene_aa>scene_grid on the owner's phone, where
// the list's rows are a grid; the Queue's rows here take their default scene).
const SHARED = /^scene:scene_aa>/;
// The walk: each step's command, the transitions it must run (feel-log names, ui/feel-log.js) and its key
// in the reference boxes. Setup steps (no key) are not measured.
const STEPS = [
  { key: 'player>library', run: 'nav:cmd_nav_to_lib', names: ['top_container:defaultscene>scene_lib', 'page:aa>list', 'navbar_container:defaultscene>scene_navbar_3lines'] },
  { key: 'library>equaliser', run: 'nav:cmd_nav_to_eq', names: ['top_container:scene_lib>scene_eq'] },
  { key: 'equaliser>library', run: 'nav:cmd_nav_to_lib', names: ['top_container:scene_eq>scene_lib'] },
  { key: 'library>search', run: 'nav:cmd_nav_to_search', names: ['top_container:scene_lib>scene_search'] },
  { run: 'play' },
  { key: 'search>player', run: 'nav:cmd_nav_to_main', names: ['top_container:scene_search>scene_playing', 'navbar_container:scene_navbar_3lines>defaultscene'] },
  { run: 'pause' },
  { key: 'player>queue', run: 'queue', names: ['top_container:defaultscene>scene_lib', 'page:aa>list'] },
  { key: 'queue>art', run: 'nav:cmd_nav_to_main', names: ['page:list>aa', SHARED, 'top_container:scene_lib>defaultscene'] },
  { key: 'art>queue', run: 'source', names: ['page:aa>list', SHARED, 'top_container:defaultscene>scene_lib'] },
];

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

/** Every shown view's box (place, size, opacity), keyed by its path of ids or kinds without row numbers. */
const boxes = (page) => page.evaluate(() => {
  const out = [];
  const visit = (v, path) => {
    const cs = getComputedStyle(v.el);
    if (cs.display === 'none') return;
    // What changes as a song plays is no end state: the elapsed time and the toasts.
    if (/track_elapsed|toast_container/.test(v.id ?? '')) return;
    const r = v.el.getBoundingClientRect();
    if (cs.visibility !== 'hidden' && r.width && r.height && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight) {
      out.push(`${path}|${[r.left, r.top, r.width, r.height].map((x) => Math.round(x * 10) / 10).join(',')}|${(+cs.opacity).toFixed(3)}`);
    }
    for (const c of v.children ?? []) visit(c, `${path}/${c.id || c.constructor.name}`);
  };
  visit(window.__cp.ctx.root, 'root');
  return out.sort();
});

/** Runs one step and records its frames inside the page, from the command until no transition moves. */
const runStep = (page, run) => page.evaluate(async (run) => {
  const { ctx, player } = window.__cp, lw = ctx.listWidget;
  const busy = () => ctx.topNav.scenes.running || lw.trans || ctx.feelLog.running.size || ctx.moving?.size;
  const from = ctx.feelLog.runs.length;
  const times = [performance.now()];
  const rest = new Promise((done) => {
    const frame = (t) => { times.push(t); if (times.length > 3 && !busy()) done(); else requestAnimationFrame(frame); };
    requestAnimationFrame(frame);
  });
  if (run.startsWith('nav:')) ctx.bus.post('bus_gui', run.slice(4));
  else if (run === 'source') lw.showSourceList();
  else if (run === 'queue') {
    // The Queue (the four demo songs) as the playing song's list: the library shows it.
    ctx.bus.post('bus_gui', 'cmd_nav_to_lib');
    const { categorySource } = await import('/music/src/list/sources.js');
    lw.open(categorySource(ctx, lw.libList, lw.nav, { id: 10, title: 'queue', icon: '?queue', kind: 'queue' }));
    lw.rememberQueueSource(lw.stack[lw.stack.length - 1]);
  }
  await rest;
  // A frame's timestamp is when it began; the first gap counts from the command.
  let worst = 0;
  for (let i = 1; i < times.length; i++) worst = Math.max(worst, times[i] - times[i - 1]);
  return { worst: Math.round(worst), frames: times.length - 1, runs: ctx.feelLog.runs.slice(from).map((r) => ({ name: r.name, frames: r.frames, worstGap: r.worstGap })) };
}, run);

test('the named transitions run without a long frame and end where they ended before', opts, async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/music/?demo`);
  await page.waitForFunction(() => window.__cp?.player?.queue?.length === 4 && !!window.__cp.ctx.feelLog, null, { timeout: 60_000 });
  // The likely next screens are built in idle time after start (view/prebuild.js; true at once before it).
  await until(() => page.evaluate(() => window.__cp.ctx.prebuilt?.done !== false), { message: 'the screens were never built' });
  await page.evaluate(() => { const { player } = window.__cp; player.enqueue([player.queue[0], player.queue[1], player.queue[2], player.queue[3]]); });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const still = () => page.evaluate(() => { const c = window.__cp.ctx; return !c.topNav.scenes.running && !c.listWidget.trans && !c.feelLog.running.size && !c.moving?.size && !c.tweens.size; });
  const reference = capture ? {} : JSON.parse(readFileSync(REFERENCE, 'utf8'));
  const got = {};
  for (const step of STEPS) {
    if (step.run === 'play' || step.run === 'pause') {
      await page.evaluate((r) => window.__cp.player[r](), step.run);
      await until(still, { message: `${step.run}: the player never came to rest` });
      continue;
    }
    const r = await runStep(page, step.run);
    await until(still, { message: `${step.key}: never came to rest` });
    const names = r.runs.map((x) => x.name);
    for (const n of step.names) assert.ok(names.some((x) => (n instanceof RegExp ? n.test(x) : x === n)), `${step.key}: ${n} ran (ran: ${names.join(', ')})`);
    console.log(`# ${step.key}: ${r.frames} frames, worst gap ${r.worst} ms; ${r.runs.map((x) => `${x.name} ${x.frames}f ${x.worstGap}ms`).join('; ')}`);
    timing(r.worst <= MAX_GAP_MS, `${step.key}: worst frame gap ${r.worst} ms (at most ${MAX_GAP_MS} ms at 4x)`);
    got[step.key] = await boxes(page);
    if (!capture) assert.deepEqual(got[step.key], reference[step.key], `${step.key}: the end state's boxes are the ones drawn before`);
  }
  if (capture) writeFileSync(capture, JSON.stringify(got, null, 1) + '\n');
  assert.deepEqual(errors, []);
  await context.close();
});

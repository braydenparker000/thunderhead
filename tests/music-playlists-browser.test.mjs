// Music's playlists in the real player, in Chromium at phone size (frontend/music/, MUSIC.md §21,
// owner 2026-11-25), over an invented library (tests/fixtures/music-shelves-library.mjs; no audio,
// no network): the Library home has no Streams or Bookmarks, whatever a saved setting says; Add to
// Playlist's + asks the name ("Playlist 1" selected) and the songs held go straight into the new
// playlist; Cancel makes none; songs already there are asked about (how many) and Skip duplicates
// adds only the new one; Back closes a dialog and moves nothing else; a tap on a playlist's title
// renames it; a song removed goes at once and Undo puts it back where it was. With none yet, the Playlists
// list, the Queue and Add to Playlist each say so in one quiet line; Re-Sort's choices are a finger's height
// and its last one comes into view above Close.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { outlast, until } from './fixtures/waits.mjs';
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

test('playlists: the home without empty rows, a new one named from Add to Playlist, duplicates asked, Back, rename by the title, remove and Undo', opts, async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/music/?demo`);
  await page.waitForFunction(() => window.__cp?.player?.queue?.length === 4 && !!window.__cp.ctx.listWidget, null, { timeout: 60_000 });

  /** The view's centre: by id, or by its text; in the newest dialog, the list header, or anywhere. */
  const where = (q) => page.evaluate((q) => {
    const { ctx } = window.__cp;
    const root = q.in === 'dialog' ? ctx.dialogs.at(-1)?.host : q.in === 'header' ? ctx.listWidget.libList.active.get(-1) : ctx.root;
    let v = null;
    root?.walk((x) => { if (!v && (q.text ? x.text === q.text : x.id === q.id) && x.visibility === 0 && x.width > 0) v = x; });
    if (!v) return null;
    const a = v.getLocationIn(null);
    return { x: a.x + Math.min(v.width / 2, 40), y: a.y + v.height / 2 };
  }, q);
  const tap = async (q) => {
    const c = await until(() => where(q), { message: `nothing to tap: ${JSON.stringify(q)}` });
    await page.mouse.click(c.x, c.y);
  };
  const atRest = () => until(() => page.evaluate(() => { const lw = window.__cp.ctx.listWidget; return lw.mode === 'list' && !lw.trans && lw.libList.source === lw.stack[lw.stack.length - 1]; }), { message: 'the list never came to rest' });
  const dialogs = () => page.evaluate(() => window.__cp.ctx.dialogs?.length ?? 0);
  /** n dialogs are open and the newest has come in (its enter scene is 350 ms). */
  const dialogUp = async (n = 1) => {
    await until(async () => (await dialogs()) === n, { message: `${n} dialog(s) never showed` });
    await page.waitForTimeout(450);
  };
  const playlist = (name) => page.evaluate((name) => { const p = window.__cp.ctx.playlists.items.find((x) => x.name === name); return p && { id: p.id, ids: [...p.ids] }; }, name);
  const shownText = () => page.evaluate(() => { const out = []; window.__cp.ctx.root.walk((v) => { if (v.visibility === 0 && v.width > 0 && typeof v.text === 'string' && v.text) out.push(v.text); }); return out; });

  await page.evaluate(async (lib) => {
    const { ctx } = window.__cp;
    await ctx.library.r2Ready?.catch(() => {});
    ctx.library.withUserData(lib);
    ctx.library.setTracks(lib);
    ctx.bus.post('bus_gui', 'cmd_nav_to_lib');
  }, inventedLibrary());
  await atRest();

  // The Library home: no Streams or Bookmarks, not even with a saved setting that has them; Queue and
  // Recently played stay where they were.
  const home = await page.evaluate(() => { const lw = window.__cp.ctx.listWidget; lw.openHome(); return { rows: lw.stack[0].items.map((c) => c.title), offered: lw.stack[0].homeCategories.map((c) => c.title) }; });
  for (const gone of ['streams', 'bookmarks']) {
    assert.ok(!home.rows.includes(gone), `${gone} is not a row`);
    assert.ok(!home.offered.includes(gone), `${gone} is not offered in List Options`);
  }
  assert.equal(home.rows[home.rows.indexOf('playlists') + 1], 'queue');
  assert.ok(home.rows.indexOf('recently_played') > home.rows.indexOf('queue'));
  const saved = await page.evaluate(() => { const { ctx } = window.__cp; ctx.settings.library_lists = String((1 << 22) - 1); const lw = ctx.listWidget; lw.openHome(); return lw.stack[0].items.map((c) => c.title); });
  assert.ok(!saved.includes('streams') && !saved.includes('bookmarks'), 'a saved mask with their bits shows neither');
  await atRest();
  const words = await page.evaluate(() => { const out = []; window.__cp.ctx.listWidget.libList.walk((v) => { if (v.visibility === 0 && typeof v.text === 'string') out.push(v.text); }); return out; });
  assert.ok(words.includes('All Songs') && !words.includes('Streams') && !words.includes('Bookmarks'), `the home's rows: ${words.join(' / ')}`);

  // With none yet, the Playlists list and the empty Queue each say so in one quiet line (and the Playlists
  // list draws no letter column beside it).
  /** The library list's shown texts with a home category open (by its kind). */
  const listOf = async (kind) => {
    await page.evaluate(async (kind) => {
      const { ctx } = window.__cp, lw = ctx.listWidget;
      lw.openHome();
      const m = await import('/music/src/list/sources.js');
      lw.open(m.categorySource(ctx, lw.libList, lw.nav, lw.stack[0].items.find((c) => c.kind === kind)));
    }, kind);
    await atRest();
    return page.evaluate(() => { const out = []; window.__cp.ctx.listWidget.libList.walk((v) => { if (v.visibility === 0 && typeof v.text === 'string' && v.text) out.push(v.text); }); return out; });
  };
  assert.ok((await listOf('playlists')).includes('No playlists yet.'), 'the Playlists list says it has none');
  assert.notEqual(await page.evaluate(() => window.__cp.ctx.listScroller.mode), 2, 'no letter column beside the line');
  assert.ok((await listOf('queue')).includes('Nothing queued.'), 'the Queue says it is empty');

  // Add to Playlist's +: the name dialog with "Playlist 1" selected; the two songs held go straight in.
  await page.evaluate(async () => {
    const { ctx } = window.__cp, lw = ctx.listWidget;
    const m = await import('/music/src/list/sources.js');
    lw.open(m.categorySource(ctx, lw.libList, lw.nav, m.homeCategory(0)));
  });
  await atRest();
  const two = await page.evaluate(() => { const l = window.__cp.ctx.listWidget.libList; l.setSelectionMode(true); l.toggleSelected(0); l.toggleSelected(1); return l.selectedTracks().map((t) => t.id); });
  await page.evaluate(() => window.__cp.ctx.bus.post('list', 'cmd_list_add_to_pl_dialog', null, {}));
  await dialogUp();
  assert.ok((await shownText()).includes('No playlists yet. Tap + to make one.'), 'Add to Playlist says how to make one');
  await tap({ in: 'dialog', id: 'add_to_pl_button' });
  await dialogUp(2);
  await until(() => page.evaluate(() => { const i = document.activeElement; return i instanceof HTMLInputElement && i.value === 'Playlist 1' && i.selectionStart === 0 && i.selectionEnd === 10; }), { message: 'the name field is not focused with "Playlist 1" selected' });
  await page.keyboard.type('Weekend Mix');
  await page.keyboard.press('Enter');
  await until(async () => (await playlist('Weekend Mix'))?.ids.length === 2, { message: 'the songs never reached the new playlist' });
  assert.deepEqual((await playlist('Weekend Mix')).ids, two);
  await until(async () => (await shownText()).includes('Added to Weekend Mix'), { message: 'no "Added to Weekend Mix"' });
  await until(async () => (await dialogs()) === 0, { message: 'Add to Playlist never closed' });

  // Cancel makes nothing.
  await page.evaluate(() => window.__cp.ctx.bus.post('bus_data_cmd', 'cmd_data_add_playlist', null, {}));
  await dialogUp();
  await tap({ in: 'dialog', id: 'button2' });
  await until(async () => (await dialogs()) === 0, { message: 'Cancel did not close the name dialog' });
  assert.equal(await page.evaluate(() => window.__cp.ctx.playlists.items.length), 1);

  // Songs already there: the confirm dialog asks, saying how many; Skip duplicates adds only the new one.
  await page.evaluate(async (first) => {
    const { ctx } = window.__cp;
    const m = await import('/music/src/widgets/playlist-dialog.js');
    m.openAddToPlaylist(ctx, [ctx.library.byId.get(first), ctx.library.tracks.find((t) => !ctx.playlists.items[0].ids.includes(t.id))]);
  }, two[0]);
  await dialogUp();
  await tap({ in: 'dialog', text: 'Weekend Mix' });
  await dialogUp(2);
  const asked = await shownText();
  assert.ok(asked.includes('1 of these 2 songs is already in Weekend Mix.'), asked.join(' / '));
  assert.ok(asked.includes('Add anyway') && asked.includes('Skip duplicates'));
  await tap({ in: 'dialog', text: 'Skip duplicates' });
  await until(async () => (await playlist('Weekend Mix')).ids.length === 3, { message: 'the new song was not added' });
  assert.equal((await playlist('Weekend Mix')).ids.filter((id) => id === two[0]).length, 1, 'the duplicate was skipped');
  await until(async () => (await dialogs()) === 0, { message: 'Add to Playlist never closed' });

  // Back closes a dialog and nothing else.
  const levels = await page.evaluate(() => window.__cp.ctx.listWidget.stack.length);
  await page.evaluate(() => window.__cp.ctx.bus.post('bus_data_cmd', 'cmd_data_add_playlist', null, {}));
  await dialogUp();
  await page.goBack();
  await until(async () => (await dialogs()) === 0, { message: 'Back did not close the dialog' });
  // A Back that also went up a level would have done so by now (on the page's own timer queue).
  await outlast(page, 300);
  assert.equal(await page.evaluate(() => window.__cp.ctx.listWidget.stack.length), levels, 'the list stayed where it was');

  // The playlist: a tap on its title renames it.
  await page.evaluate(() => window.__cp.ctx.bus.post('bus_gui', 'cmd_nav_to_playlist', null, { playlist: window.__cp.ctx.playlists.items[0] }));
  await atRest();
  await page.waitForTimeout(300);
  await tap({ in: 'header', id: 'title' });
  await dialogUp();
  await until(() => page.evaluate(() => document.activeElement?.value === 'Weekend Mix'), { message: 'the rename field never had the name' });
  await page.keyboard.type('Sunday Mix');
  await page.keyboard.press('Enter');
  await until(async () => (await playlist('Sunday Mix'))?.ids.length === 3, { message: 'the rename never landed' });
  await until(() => page.evaluate(() => window.__cp.ctx.listWidget.libList.active.get(-1)?.findViewById('title')?.text === 'Sunday Mix'), { message: 'the header kept the old name' });
  await until(async () => (await dialogs()) === 0);

  // A song out at once (no question), and Undo puts it back where it was.
  const was = (await playlist('Sunday Mix')).ids;
  await page.evaluate(() => { const l = window.__cp.ctx.listWidget.libList; l.setSelectionMode(true); l.toggleSelected(1); });
  await page.evaluate(() => window.__cp.ctx.bus.post('list', 'cmd_list_delete_dialog', null, {}));
  await until(async () => (await playlist('Sunday Mix')).ids.length === 2, { message: 'the song was not removed' });
  assert.equal(await dialogs(), 0, 'nothing was asked');
  assert.deepEqual((await playlist('Sunday Mix')).ids, [was[0], was[2]]);
  await until(async () => (await shownText()).includes('Removed 1 song'), { message: 'no Undo bar' });
  await page.waitForTimeout(400);
  await tap({ id: 'undo_action' });
  await until(async () => (await playlist('Sunday Mix')).ids.length === 3, { message: 'Undo did not bring it back' });
  assert.deepEqual((await playlist('Sunday Mix')).ids, was);

  // Re-Sort: its choices are a finger's height, its hint at the secondary text size, and the last choice
  // (Shuffle) is in view or comes into view when the body is dragged up, above Close.
  await page.evaluate(() => window.__cp.ctx.bus.post('list', 'cmd_list_resort_dialog', null, {}));
  await dialogUp();
  const sortBox = (what) => page.evaluate((what) => {
    const d = window.__cp.ctx.dialogs.at(-1), group = d.find('song_sorting_group');
    let v = null;
    if (what === 'last') group.walk((x) => { if (String(x.tag) === '9' && x.visibility === 0) v = x; });
    else v = what === 'body' ? group.parent : d.find(what);
    const r = v.el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, h: v.height / window.__cp.ctx.dpr, size: v.textSize };
  }, what);
  const choice = await sortBox('last');
  assert.ok(choice.h >= 44, `a choice is ${choice.h} px high`);
  const hint = await page.evaluate(() => { let t = null; window.__cp.ctx.dialogs.at(-1).find('song_sorting_group').walk((x) => { if (!t && x.text?.startsWith('The playlist shows')) t = x; }); return t.textSize / window.__cp.ctx.dpr; });
  assert.ok(hint >= 13, `the hint is ${hint} px`);
  const body = await sortBox('body');
  if (choice.bottom > body.bottom) {
    const x = 195, y = body.top + 60;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let k = 1; k <= 30; k++) await page.mouse.move(x, y - k * 20);
    await page.mouse.up();
  }
  const shown = await until(async () => { const c = await sortBox('last'); return c.bottom <= body.bottom + 0.5 && c.top >= body.top - 0.5 && c; }, { message: 'the last choice never came into view' });
  assert.ok(shown.bottom <= (await sortBox('button1')).top, 'above Close');
  await page.goBack();
  await until(async () => (await dialogs()) === 0, { message: 'Back did not close Re-Sort' });

  assert.deepEqual(errors, []);
  await context.close();
});

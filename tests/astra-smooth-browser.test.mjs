// Heavy work and movement do not share frames (the owner's feel report, round 1): in a real browser at phone size,
// the player's work after a movement's first frame runs a piece a frame in order (player/stages.js); a menu is built
// in one frame and rises from the next, a long one adding its rows once it has landed (player/menu-sheet.js); a toast
// is held unseen until the main thread is free, then rises (ui/overlays.js); a press ended by its release is not
// counted as cut in the feel log (ui/motion.js). The lab page, a PlayerScreen with its engine's load stubbed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { until } from './fixtures/waits.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only' };
let site, browser, base;

before(async () => {
  if (live) return;
  site = await serve(0, {});
  base = `http://127.0.0.1:${site.address().port}`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => { await browser?.close(); site?.close(); });

async function lab(t) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  t.after(() => context.close());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/astra/lab/`);
  return { page, errors };
}

test('the player\'s work after a movement runs once its first frame is drawn, a piece a frame, in order', opts, async (t) => {
  const { page, errors } = await lab(t);
  const got = await page.evaluate(async () => {
    const { Stages } = await import('/astra/src/player/stages.js');
    const s = new Stages(), ran = [], frames = [];
    let frame = 0;
    const count = () => { frame++; frames.push(frame); if (frame < 30) requestAnimationFrame(count); };
    requestAnimationFrame(count);
    let open;
    const gate = new Promise((r) => { open = r; });
    s.add(() => ran.push(['a', frame]));
    s.add(() => ran.push(['b', frame]));
    s.add(() => ran.push(['gated', frame]), { after: gate });
    s.add(() => ran.push(['first', frame]), { first: true });
    const sync = ran.length;
    await new Promise((r) => setTimeout(r, 150));
    const before = ran.map((x) => x[0]);
    open();
    await new Promise((r) => setTimeout(r, 100));
    return { sync, before, all: ran.map((x) => x[0]), frames: ran.map((x) => x[1]), running: !!s.running };
  });
  assert.equal(got.sync, 0, 'nothing runs in the frame being made');
  assert.deepEqual(got.before, ['first', 'a', 'b'], 'a first piece goes ahead; a gated one waits, with what is behind it');
  assert.deepEqual(got.all, ['first', 'a', 'b', 'gated']);
  assert.ok(got.frames[0] >= 2, `the first piece after two frames (frame ${got.frames[0]})`);
  assert.ok(got.frames[1] > got.frames[0] && got.frames[2] > got.frames[1], `one piece a frame (${got.frames})`);
  assert.equal(got.running, false);
  assert.deepEqual(errors, []);
});

test('a menu is built held at its start and rises from the next frame; a long Sources list adds its rows once landed', opts, async (t) => {
  const { page, errors } = await lab(t);
  const got = await page.evaluate(async () => {
    const { PlayerScreen } = await import('/astra/src/player/player-screen.js');
    const { CUT_ROWS } = await import('/astra/src/player/menu-sheet.js');
    await import('/astra/src/screens/stream-card.js');
    const p = (window.p = new PlayerScreen());
    p.engine.load = async () => {};
    const sources = Array.from({ length: 40 }, (_, i) => ({ id: 's' + i, label: 'Example · ' + i, stream: { url: `https://cdn.example/${i}.mkv`, name: 'Example', title: `Invented.Film.2019.1080p.WEB-DL.x265-GRP${i}` } }));
    p.open({ stream: sources[0].stream, meta: { title: 'Invented film' }, sourceId: 's0', sources });
    while (p.stages.running) await new Promise((r) => setTimeout(r, 20));
    await new Promise((r) => setTimeout(r, 50));
    p.menus.openPanel('sources');
    const sheet = p.panel.querySelector('.ap-sheet');
    const built = { rows: p.panel.querySelectorAll('.ap-panel-list > *').length, held: sheet.style.transform, anims: sheet.getAnimations().length, hidden: p.panel.hidden };
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    const risen = { anims: sheet.getAnimations().length, held: sheet.style.transform, overlay: p.root.classList.contains('overlay') };
    await Promise.all(sheet.getAnimations().map((a) => a.finished));
    for (let i = 0; i < 60 && p.panel.querySelectorAll('.ap-panel-list > *').length < 40; i++) await new Promise((r) => requestAnimationFrame(r));
    const all = p.panel.querySelectorAll('.ap-panel-list > *').length;
    p.menus.dismiss();
    await new Promise((r) => setTimeout(r, 400));
    const list = p.panel.querySelector('.ap-panel-list');
    p.menus.openPanel('sources');
    return { CUT_ROWS, built, risen, all, kept: p.panel.querySelector('.ap-panel-list') === list };
  });
  assert.equal(got.built.hidden, false);
  assert.equal(got.built.rows, got.CUT_ROWS, 'a screenful is built in the first frame');
  assert.match(got.built.held, /translateY\(\d+(\.\d+)?px\)/, 'held at its start, below the screen');
  assert.equal(got.built.anims, 0, 'nothing moves in the frame it is built in');
  assert.ok(got.risen.anims > 0 && got.risen.held === '' && got.risen.overlay, 'it rises from the next frame, the controls going as it starts');
  assert.equal(got.all, 40, 'the rest once it has landed');
  assert.equal(got.kept, true, 'opened again with the same list: kept as it was built');
  assert.deepEqual(errors, []);
});

test('a toast is held unseen while the page is busy and rises once it is free; a press ended by its release is not cut', opts, async (t) => {
  const { page, errors } = await lab(t);
  const got = await page.evaluate(async () => {
    const { toast } = await import('/astra/src/ui/overlays.js');
    const { press } = await import('/astra/src/ui/motion.js');
    const { feelEntries, clearFeelLog } = await import('/astra/src/ui/feel-log.js');
    clearFeelLog();
    toast('An invented message');
    const el = document.querySelector('.toast');
    const now = { text: el.textContent, show: el.classList.contains('show'), opacity: el.style.opacity, anims: el.getAnimations().length };
    const end = performance.now() + 200;
    while (performance.now() < end); // the page busy: nothing rises meanwhile
    const busy = el.getAnimations().length;
    for (let i = 0; i < 100 && !el.getAnimations().length; i++) await new Promise((r) => setTimeout(r, 20));
    const risen = { opacity: el.style.opacity, anims: el.getAnimations().length };
    await Promise.all(el.getAnimations().map((a) => a.finished.catch(() => {})));
    const b = document.createElement('button');
    b.style.cssText = 'position:fixed;left:20px;top:20px;width:100px;height:40px';
    document.body.append(b);
    press(b);
    const ev = (type) => b.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1 }));
    ev('pointerdown'); ev('pointerup');
    ev('pointerdown'); ev('pointercancel');
    await new Promise((r) => setTimeout(r, 300));
    return { now, busy, risen, presses: feelEntries().filter((e) => e.name === 'press').map((e) => e.interrupted), toastIn: feelEntries().some((e) => e.name === 'toast:in') };
  });
  assert.deepEqual(got.now, { text: 'An invented message', show: true, opacity: '0', anims: 0 }, 'its words at once, held unseen');
  assert.equal(got.busy, 0);
  assert.ok(got.risen.opacity === '' && got.risen.anims > 0, 'it rises once the page is free');
  assert.ok(got.toastIn);
  assert.deepEqual(got.presses, [false, true], 'released: not cut; cancelled (a scroll took over): cut');
  assert.deepEqual(errors, []);
});

// Astra's player screen (frontend/astra/src/player/) in a real browser at phone size with touch: the
// real PlayerScreen on the lab page (its CSP and styles), with the engine's load stubbed and the
// video's clock, length and paused state faked, so no film is needed. Each check is one of the
// faults a review found: the resume point kept when the source changes before the first frame, the
// app reachable behind picture-in-picture, a hold that a second finger cannot leave stuck, nothing
// left running after close, controls that stay while used, no page writes per timeupdate while
// hidden, a live stream's seek bar, Tab kept inside a menu, Unlock reachable while locked, and full
// screen lost in the background not taken for back.
// The pure rules (gestures, progress, filters) are in astra-player.test.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { outlast } from './fixtures/waits.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only' };
const LANDSCAPE = { width: 844, height: 390 }, PORTRAIT = { width: 390, height: 844 };
let site, browser, base;

before(async () => {
  if (live) return;
  site = await serve(0, {});
  base = `http://127.0.0.1:${site.address().port}`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => { await browser?.close(); site?.close(); });

/** A phone-sized page holding one open player: `window.p`, with `window.fake` to move its clock. */
async function player(t, { viewport = LANDSCAPE, clock = false, open = {} } = {}) {
  const context = await browser.newContext({ viewport, hasTouch: true, isMobile: true });
  t.after(() => context.close());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (clock) await page.clock.install();
  await page.goto(`${base}/astra/lab/`);
  await page.evaluate(async (open) => {
    // Something of the app's behind the player, to tap through picture-in-picture.
    const behind = Object.assign(document.createElement('button'), { textContent: 'Behind', className: 'behind' });
    behind.style.cssText = 'position:fixed;left:8px;top:120px;width:140px;height:60px;z-index:999';
    window.behindTaps = 0;
    behind.onclick = () => window.behindTaps++;
    document.body.prepend(behind);
    // The lock screen's position line and the wake lock, counted.
    window.positions = 0;
    if (navigator.mediaSession) navigator.mediaSession.setPositionState = () => window.positions++;
    window.wake = { asked: 0, held: 0 };
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: () => new Promise((r) => setTimeout(() => {
      window.wake.asked++; window.wake.held++;
      const s = new EventTarget(); s.release = async () => { window.wake.held--; s.dispatchEvent(new Event('release')); }; r(s);
    }, 50)) } });
    const { PlayerScreen } = await import('/astra/src/player/player-screen.js');
    const p = (window.p = new PlayerScreen());
    window.loads = [];
    p.engine.load = async ({ url, startTime }) => { window.loads.push({ url, startTime }); };
    const v = p.video;
    let paused = true, duration = 600, time = 0;
    Object.defineProperties(v, {
      paused: { get: () => paused, configurable: true },
      duration: { get: () => duration, configurable: true },
      // As Chrome's: a time that is not a finite number throws.
      currentTime: { get: () => time, set: (x) => { if (!Number.isFinite(x)) throw new TypeError('The provided double value is non-finite.'); time = x; }, configurable: true },
    });
    v.play = async () => { paused = false; v.dispatchEvent(new Event('play')); };
    v.pause = () => { if (!paused) { paused = true; v.dispatchEvent(new Event('pause')); } };
    window.fake = {
      at(t) { time = t; },
      length(d) { duration = d; v.dispatchEvent(new Event('durationchange')); },
      /** The first frame: playing from `t`. */
      plays(t = time) { time = t; paused = false; v.dispatchEvent(new Event('play')); v.dispatchEvent(new Event('playing')); },
    };
    const url = 'https://cdn.example/one.mkv';
    p.open({ stream: { url, name: 'One' }, meta: { title: 'Invented film' }, sourceId: 'a',
      sources: [{ id: 'a', label: 'One', stream: { url, name: 'One' } }, { id: 'b', label: 'Two', stream: { url: 'https://cdn.example/two.mkv', name: 'Two' } }], ...open });
  }, open);
  const cdp = await context.newCDPSession(page);
  /** Touch points by [x, y, id]; an empty list lifts every finger. */
  const touch = (type, points = []) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y, id = 0]) => ({ x, y, id })) });
  const state = () => page.evaluate(() => ({ controls: p.root.classList.contains('controls'), rate: p.video.playbackRate, feedback: p.feedback.className }));
  return { page, errors, touch, state, viewport };
}

const press = (page, label) => page.evaluate((label) => [...p.root.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === label || b.textContent.trim() === label).click(), label);

test('a source chosen before the first frame starts where the first was asked to, and the app can resolve it itself', opts, async (t) => {
  const { page, errors } = await player(t, { open: { startTime: 600 } });
  assert.deepEqual(await page.evaluate(() => window.loads), [{ url: 'https://cdn.example/one.mkv', startTime: 600 }]);
  await press(page, 'Sources');
  await press(page, 'Two');
  assert.equal((await page.evaluate(() => window.loads))[1].startTime, 600, 'not 0:00: the video clock had not started');
  // The app's way: it resolves the address (debrid) and loads; the player only says what was picked and from where.
  const told = await page.evaluate(() => new Promise((resolve) => {
    p.addEventListener('source', (e) => { e.preventDefault(); resolve({ id: e.detail.source.id, startTime: e.detail.startTime, loads: window.loads.length }); }, { once: true });
    p.menus.openPanel('sources');
    [...p.panel.querySelectorAll('.ap-source')].find((b) => b.textContent.includes('One')).click();
  }));
  assert.deepEqual(told, { id: 'a', startTime: 600, loads: 2 }, 'told, and nothing loaded by the player');
  // After the first frame, from where the film is; "Try again" the same.
  await page.evaluate(() => { fake.plays(700); p.showError('Lost', { retry: true }, { network: true }); });
  await press(page, 'Try again');
  assert.equal((await page.evaluate(() => window.loads)).at(-1).startTime, 700);
  assert.deepEqual(errors, []);
});

test('in picture-in-picture the app behind takes taps; back in the player it is out of reach again', opts, async (t) => {
  for (const viewport of [LANDSCAPE, PORTRAIT]) {
    const { page } = await player(t, { viewport });
    assert.equal(await page.evaluate(() => document.querySelector('.behind').inert), true);
    await page.evaluate(() => { fake.plays(5); p.system.minimize(); });
    await page.touchscreen.tap(60, 150);
    assert.equal(await page.evaluate(() => window.behindTaps), 1, `the tap reached the app (${viewport.width}×${viewport.height})`);
    await page.evaluate(() => p.system.restoreFromPip());
    assert.equal(await page.evaluate(() => document.querySelector('.behind').inert), true);
  }
});

test('leaving full screen while the page is hidden, or just back, is not back: the player stays open', opts, async (t) => {
  const { page } = await player(t);
  const open = await page.evaluate(async () => {
    if (document.fullscreenElement) await document.exitFullscreen(); // out of full screen (as Chrome takes it when the app goes to the background)
    await new Promise((r) => setTimeout(r, 50));
    const s = p.system, seen = [];
    let state = 'hidden';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
    // Out of full screen for the whole check, whatever this browser grants or takes back in the meantime.
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => null });
    const mm = window.matchMedia.bind(window);
    window.matchMedia = (q) => (q === '(pointer: coarse)' ? { matches: true } : mm(q)); // a phone's finger
    Object.assign(s, { wasFullscreen: true, wantFullscreen: true, visibleAt: 0 });
    s.fullscreenChanged(); seen.push(p.isOpen); // the change as the app goes to the background
    state = 'visible'; document.dispatchEvent(new Event('visibilitychange'));
    s.fullscreenChanged(); seen.push(p.isOpen); // the change arriving just after coming back
    s.visibleAt = performance.now() - 2000;
    s.fullscreenChanged(); seen.push(p.isOpen); // a real exit, in view: back, which closes
    return seen;
  });
  assert.deepEqual(open, [true, true, false]);
});

test('hold for 2× ends with the first finger’s lift, even after a second finger came and went', opts, async (t) => {
  for (const viewport of [LANDSCAPE, PORTRAIT]) {
    const { page, touch, state } = await player(t, { viewport });
    const x = viewport.width / 2, y = viewport.height * 0.3;
    await page.evaluate(() => fake.plays(5));
    await touch('touchStart', [[x, y, 1]]);
    await outlast(page, 500); // past the 400 ms hold
    assert.equal((await state()).rate, 2);
    await touch('touchStart', [[x, y, 1], [x - 120, y + 40, 2]]); // a second finger
    await touch('touchMove', [[x, y, 1]]); // the second lifts
    assert.equal((await state()).rate, 2, 'still holding');
    await touch('touchEnd');
    assert.deepEqual(await state(), { controls: true, rate: 1, feedback: 'ap-feedback' }, `back to the chosen speed, the chip gone (${viewport.width}×${viewport.height})`);
    // A slow swipe up on the right (under the 50 px vertical threshold in portrait for most of its way) never holds.
    await touch('touchStart', [[viewport.width * 0.85, viewport.height * 0.6, 1]]);
    for (let i = 1; i <= 12; i++) { await touch('touchMove', [[viewport.width * 0.85, viewport.height * 0.6 - i * 3, 1]]); await outlast(page, 50); }
    assert.equal((await state()).rate, 1, 'a moving finger is not a hold');
    await touch('touchEnd');
  }
});

test('close leaves no loading clock, notice, wake lock, hold or timer running', opts, async (t) => {
  const { page, touch } = await player(t);
  await page.evaluate(() => { p.loader.networkState('reconnecting'); fake.plays(5); p.video.dispatchEvent(new Event('playing')); });
  await touch('touchStart', [[422, 120, 1]]);
  await outlast(page, 500); // a hold under way
  // Closed while the wake lock request (two of them) is still on its way.
  const now = await page.evaluate(() => { p.close('user'); return { rate: p.video.playbackRate, loadingTimer: p.loader.timer, notice: p.noticeEl.hidden }; });
  assert.deepEqual(now, { rate: 1, loadingTimer: 0, notice: true });
  await outlast(page, 150);
  assert.deepEqual(await page.evaluate(() => window.wake), { asked: 1, held: 0 }, 'one lock asked for, and let go once it arrived');
  await touch('touchEnd');
  // Opened again: the clock counts from this open, and no notice from before.
  const reopened = await page.evaluate(() => { p.open({ stream: { url: 'https://cdn.example/x.mkv' }, meta: { title: 'Another' } }); return { since: performance.now() - p.loader.since, notice: p.noticeEl.hidden, info: p.loadingInfo.textContent }; });
  assert.ok(reopened.since < 100 && reopened.notice && reopened.info === '', JSON.stringify(reopened));
});

test('the controls stay while ±10 is tapped, and hide 3.5 s after the last touch', opts, async (t) => {
  const { page, state } = await player(t, { clock: true });
  await page.evaluate(() => fake.plays(30));
  const forward = await page.evaluate(() => { const r = p.root.querySelector('[aria-label="Forward 10 seconds"]').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
  await page.clock.runFor(3000);
  await page.touchscreen.tap(...forward);
  await page.clock.runFor(3000);
  assert.equal((await state()).controls, true, '6 s after showing, 3 s after the tap');
  await page.clock.runFor(800);
  assert.equal((await state()).controls, false);
});

test('while the controls are hidden a timeupdate writes nothing, and the lock screen line is not redrawn', opts, async (t) => {
  const { page } = await player(t);
  const seen = await page.evaluate(async () => {
    fake.plays(10); p.hideControls(); window.positions = 0;
    await new Promise((r) => setTimeout(r)); // the first frame's own changes (the controls uncovered) are done
    const records = [];
    const watch = new MutationObserver((r) => records.push(...r));
    watch.observe(p.root, { subtree: true, attributes: true, childList: true, characterData: true });
    for (let i = 1; i <= 20; i++) { fake.at(10 + i * 0.25); p.video.dispatchEvent(new Event('timeupdate')); }
    await new Promise((r) => setTimeout(r));
    const hidden = { records: records.length, positions: window.positions };
    p.video.dispatchEvent(new Event('ratechange'));
    p.showControls();
    await new Promise((r) => setTimeout(r));
    watch.disconnect();
    return { ...hidden, afterRate: window.positions, time: p.timeEl.textContent, thumb: p.thumb.style.transform, left: p.thumb.style.left };
  });
  assert.deepEqual(seen, { records: 0, positions: 0, afterRate: 1, time: '0:15 / 10:00', thumb: 'translateX(2.5%)', left: '' });
  // The brightness swipe darkens with a layer and leaves no filter on the video at 100 %.
  const bright = await page.evaluate(() => { p.touch.setBrightness(0.6); const a = [p.dim.style.opacity, p.video.style.filter]; p.touch.setBrightness(1.2); const b = [p.dim.style.opacity, p.video.style.filter]; p.touch.setBrightness(1); return [a, b, [p.dim.style.opacity, p.video.style.filter]]; });
  assert.deepEqual(bright, [['0.4', ''], ['', 'brightness(1.2)'], ['', '']]);
});

test('a stream with no length (live): the bar says Live and a tap on it throws nothing', opts, async (t) => {
  const { page, errors } = await player(t);
  await page.evaluate(() => { fake.plays(30); fake.length(Infinity); p.showControls(); });
  const bar = await page.evaluate(() => { const r = p.timeline.getBoundingClientRect(); return [r.x + r.width * 0.3, r.y + r.height / 2]; });
  await page.touchscreen.tap(...bar);
  assert.deepEqual(await page.evaluate(() => ({ time: p.timeEl.textContent, live: p.timeline.classList.contains('live'), scrubbing: p.scrub.active, at: p.video.currentTime })), { time: 'Live', live: true, scrubbing: false, at: 30 });
  await press(page, 'Forward 10 seconds');
  assert.equal(await page.evaluate(() => p.video.currentTime), 40, 'the buttons still work');
  assert.deepEqual(errors, []);
});

test('Tab stays inside an open menu, and while locked Unlock is the one thing it reaches', opts, async (t) => {
  for (const viewport of [LANDSCAPE, PORTRAIT]) {
    const { page, touch } = await player(t, { viewport });
    await page.evaluate(() => fake.plays(5));
    await press(page, 'Stream info');
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      const where = await page.evaluate(() => { const a = document.activeElement; return !a || a === document.body || p.modal.contains(a) ? 'ok' : a.getAttribute('aria-label') || a.className; });
      assert.equal(where, 'ok', `Tab ${i + 1} stayed in the menu (${viewport.width}×${viewport.height})`);
    }
    await page.keyboard.press('Escape');
    await press(page, 'Lock controls');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.className), 'ap-unlock');
    // A tap on the middle of a locked screen shows the hint; it does not unlock by landing on Unlock as it appears.
    await page.evaluate(() => document.activeElement.blur());
    await touch('touchStart', [[viewport.width / 2, viewport.height / 2, 1]]); await touch('touchEnd');
    assert.deepEqual(await page.evaluate(() => [p.ctl.locked, p.lockOverlay.classList.contains('show')]), [true, true]);
    await page.evaluate(() => p.root.querySelector('.ap-unlock').focus());
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => p.ctl.locked), false, 'Enter on Unlock unlocks');
  }
});

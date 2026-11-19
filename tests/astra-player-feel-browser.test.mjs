// The player's feel (FEEL.md; player/passage.js, menu-sheet.js, controls.js, gauges.js, settings/player.js) in a
// real browser at phone size, held sideways first: opening dims over the backdrop and the first picture
// cross-fades in; leaving ends hidden with the engine let go and the tapped card released, and Back during the
// opening turns it round cleanly; a menu is a sheet docked to the right sideways and from the bottom upright,
// out of reach the moment it closes and hidden once it has gone, and opened again mid-leave it comes back; the
// settings rows change what they say. Pure rules (labels, marks, the dock) are checked at the end.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { until } from './fixtures/waits.mjs';
import { stepLabel, seekStep } from '../frontend/astra/src/player/gestures.js';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only' };
const SIDEWAYS = { width: 844, height: 390 }, UPRIGHT = { width: 390, height: 844 };
let site, browser, base;

before(async () => {
  if (live) return;
  site = await serve(0, {});
  base = `http://127.0.0.1:${site.address().port}`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => { await browser?.close(); site?.close(); });

/** The lab page with a card to tap (the origin) and a player whose engine and video are faked. */
async function player(t, viewport = SIDEWAYS) {
  const context = await browser.newContext({ viewport, hasTouch: true, isMobile: true });
  t.after(() => context.close());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/astra/lab/`);
  await page.evaluate(async () => {
    const card = (window.card = Object.assign(document.createElement('button'), { textContent: 'An invented stream' }));
    card.style.cssText = 'position:fixed;left:16px;top:200px;width:200px;height:60px;z-index:900';
    document.body.append(card);
    const { PlayerScreen } = await import('/astra/src/player/player-screen.js');
    const p = (window.p = new PlayerScreen());
    window.resets = 0;
    p.engine.load = async () => {};
    const reset = p.engine.reset.bind(p.engine);
    p.engine.reset = () => { window.resets++; reset(); };
    const v = p.video;
    let paused = true, time = 0;
    Object.defineProperties(v, {
      paused: { get: () => paused, configurable: true },
      duration: { get: () => 600, configurable: true },
      currentTime: { get: () => time, set: (x) => { time = x; }, configurable: true },
    });
    v.play = async () => { paused = false; v.dispatchEvent(new Event('play')); };
    v.pause = () => { if (!paused) { paused = true; v.dispatchEvent(new Event('pause')); } };
    window.plays = () => { paused = false; v.dispatchEvent(new Event('play')); v.dispatchEvent(new Event('playing')); };
    window.openIt = () => p.open({ stream: { url: 'https://cdn.example/one.mkv', name: 'One' }, meta: { title: 'Invented film' }, origin: card, sourceId: 'a',
      sources: [{ id: 'a', label: 'One', stream: { url: 'https://cdn.example/one.mkv' } }, { id: 'b', label: 'Two', stream: { url: 'https://cdn.example/two.mkv' } }] });
  });
  /** Every animation that ends has ended (the endless ones, a breathing logo, aside). */
  const settled = () => page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {}))));
  return { page, errors, settled };
}

test('opening dims over the backdrop, the picture cross-fades in, and leaving ends hidden with the card let go', opts, async (t) => {
  for (const viewport of [SIDEWAYS, UPRIGHT]) {
    const { page, errors, settled } = await player(t, viewport);
    const opening = await page.evaluate(() => { openIt(); return { opening: p.root.classList.contains('opening'), loading: getComputedStyle(p.loading).opacity, stage: getComputedStyle(p.stage).opacity, background: getComputedStyle(p.root).backgroundColor }; });
    assert.equal(opening.opening, true);
    assert.ok(Number(opening.loading) < 0.5, `the dim starts from the screen as it was (${opening.loading})`);
    assert.equal(opening.stage, '0', 'no black picture under the dim');
    assert.equal(opening.background, 'rgba(0, 0, 0, 0)', 'the root itself is not a black sheet');
    await settled();
    assert.equal(await page.evaluate(() => getComputedStyle(card).transform), 'matrix(0.97, 0, 0, 0.97, 0, 0)', 'the card stays pressed under the player');
    await page.evaluate(() => plays());
    assert.deepEqual(await page.evaluate(() => [p.root.classList.contains('opening'), p.loading.inert]), [false, true], 'the loading layer is out of reach at once');
    await settled();
    assert.deepEqual(await page.evaluate(() => [p.loading.hidden, getComputedStyle(p.stage).opacity]), [true, '1']);
    const leaving = await page.evaluate(() => { p.close('user'); return { open: p.isOpen, hidden: p.root.hidden, inert: p.root.inert, resets }; });
    assert.deepEqual(leaving, { open: false, hidden: false, inert: true, resets: 0 }, 'closed at once, still fading, the engine let go at the end');
    await until(() => page.evaluate(() => p.root.hidden));
    await settled();
    assert.deepEqual(await page.evaluate(() => ({ resets, card: getComputedStyle(card).transform, opacity: getComputedStyle(p.root).opacity })), { resets: 1, card: 'none', opacity: '1' });
    assert.deepEqual(errors, []);
  }
});

test('Back during the opening turns it round; opening again during a leave starts clean', opts, async (t) => {
  const { page, settled } = await player(t);
  await page.evaluate(() => { openIt(); });
  await page.waitForTimeout(60);
  await page.evaluate(() => p.close('back'));
  await until(() => page.evaluate(() => p.root.hidden));
  await settled();
  assert.deepEqual(await page.evaluate(() => ({ resets, card: getComputedStyle(card).transform, opening: p.root.classList.contains('opening') })), { resets: 1, card: 'none', opening: false });
  // A tap on another stream while the last one still fades out: the leave ends now, the new one opens.
  const again = await page.evaluate(() => { openIt(); plays(); p.close('user'); openIt(); return { open: p.isOpen, hidden: p.root.hidden, leaving: p.root.classList.contains('leaving'), resets }; });
  assert.deepEqual(again, { open: true, hidden: false, leaving: false, resets: 2 });
});

test('a menu is a sheet: docked to the right sideways, from the bottom upright; gone from reach at once, back if reopened', opts, async (t) => {
  for (const [viewport, docked] of [[SIDEWAYS, true], [UPRIGHT, false]]) {
    const { page, settled } = await player(t, viewport);
    await page.evaluate(() => { openIt(); plays(); p.menus.openModal('info'); });
    await settled();
    const where = await page.evaluate(() => { const s = p.modal.querySelector('.ap-sheet'), r = s.getBoundingClientRect(); return { docked: s.classList.contains('docked'), right: Math.round(r.right), bottom: Math.round(r.bottom), left: Math.round(r.left) }; });
    assert.equal(where.docked, docked);
    assert.equal(where.right, viewport.width, 'at the right edge');
    assert.equal(where.bottom, viewport.height, 'down to the bottom');
    if (docked) assert.ok(where.left > viewport.width / 2, `the film shows beside it (${where.left})`);
    // Read after the microtask in which the player redraws what is in reach: before the next frame.
    const closing = await page.evaluate(async () => { p.menus.dismiss(); await Promise.resolve(); return { name: p.menus.open, inert: p.modal.inert, hidden: p.modal.hidden, controls: p.controls.inert }; });
    assert.deepEqual(closing, { name: null, inert: true, hidden: false, controls: false }, 'the controls take touches before the next frame');
    const back = await page.evaluate(() => { p.menus.openModal('info'); return { inert: p.modal.inert, leaving: p.modal.dataset.leaving ?? null }; });
    assert.deepEqual(back, { inert: false, leaving: null });
    await page.evaluate(() => p.menus.dismiss());
    await until(() => page.evaluate(() => p.modal.hidden));
  }
});

test('the settings change what they say: hide delay, double-tap step, the time, the top bar', opts, async (t) => {
  const { page } = await player(t);
  await page.evaluate(() => { openIt(); plays(); });
  const shown = await page.evaluate(async () => {
    const { applyLook } = await import('/astra/src/player/view.js');
    Object.assign(p.prefs, { seekStep: 30, topSpeed: true, topLock: false, timeShows: 'remaining', controlsHideAfter: 0 });
    applyLook(p);
    p.showControls();
    return { forward: p.forwardBtn.getAttribute('aria-label'), speed: !p.topSpeedBtn.hidden, lock: !p.lockBtn.hidden, time: p.timeEl.textContent };
  });
  assert.deepEqual(shown, { forward: 'Forward 30 seconds', speed: true, lock: false, time: '0:00 / −10:00' });
  await page.evaluate(() => p.forwardBtn.click());
  assert.equal(await page.evaluate(() => p.video.currentTime), 30);
  await page.waitForTimeout(3300);
  assert.equal(await page.evaluate(() => p.ctl.visible), true, 'Never: the controls stay');
});

test('the labels and steps the gestures use', () => {
  assert.deepEqual([stepLabel(20), stepLabel(-10), stepLabel(90)], ['+20 s', '−10 s', '+1:30']);
  assert.deepEqual([seekStep({ seekStep: 15 }), seekStep({ seekStep: 7 }), seekStep({})], [15, 10, 10]);
});

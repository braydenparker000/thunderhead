// Music in Chromium at phone size with touch (frontend/music/, the demo songs: no audio, no network):
// a drag on the player's waveform seeks wherever it starts, also in the screen's rightmost 24 px, where
// the library list's scroller stands. On the player the scroller is hidden (mode 0) and takes no touch
// (list/scroller.js touchable, input.js hitTest); before, it took the press and the list widget took the
// drag over as its swipe, so the waveform never moved. A side swipe on the art from that edge still
// goes to the art pager, as one from the middle does.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { outlast, until } from './fixtures/waits.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (the demo songs)', timeout: 120_000 };
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

test('a drag on the waveform from its right edge seeks; a swipe on the art from there still pages', opts, async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/music/?demo`);
  await page.waitForFunction(() => window.__cp?.player?.queue?.length === 4 && window.__cp.ctx.listWidget?.mode === 'aa', null, { timeout: 30_000 });
  const cdp = await context.newCDPSession(page);
  const drag = async (x, y, dx) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let k = 1; k <= 8; k++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + (dx * k) / 8, y }] });
      await outlast(page, 16);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await outlast(page, 300);
  };
  const wave = await page.evaluate(() => {
    const { ctx } = window.__cp, r = ctx.root.findViewById('waveseek').el.getBoundingClientRect();
    const sc = ctx.listScroller.el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, right: r.right, scrollerLeft: sc.left, scrollerMode: ctx.listScroller.mode };
  });
  assert.ok(wave.right >= 390 && wave.scrollerLeft < 390 && wave.scrollerLeft > 390 - 40, 'the hidden scroller stands over the waveform\'s right edge');
  assert.ok(wave.scrollerMode <= 0, 'on the player the scroller is hidden');
  // Below the buttons that sit over the waveform's middle band.
  const y = wave.bottom - 12;
  const pos = () => page.evaluate(() => window.__cp.player.positionMs());
  for (const x of [380, 370, 300]) {
    const from = await pos();
    await drag(x, y, -120);
    assert.ok((await pos()) > from + 5000, `a drag from x ${x} seeks (from ${from} ms to ${await pos()} ms)`);
  }

  // The art pager's side swipe from the same edge, as from the middle: on to the next song.
  const artY = await page.evaluate(() => (window.__cp.ctx.root.findViewById('waveseek').el.getBoundingClientRect().top) / 2);
  for (const x of [200, 380]) {
    const index = await page.evaluate(() => window.__cp.player.index);
    await drag(x, artY, -200);
    await until(() => page.evaluate((i) => window.__cp.player.index !== i, index), { message: `the swipe from x ${x} did not page` });
  }
  assert.deepEqual(errors, []);
  await context.close();
});

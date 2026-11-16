// The level hls.js picks for the player's size on a dense phone screen (engine/adaptive-tuning.js): the device
// pixel ratio is counted at most 2, so a phone held sideways (about 800 CSS pixels at a ratio near 3) is not
// given 4K. The two-level fixture (hls2/: 320x180 and 1920x1080, see tests/astra-routes-browser.test.mjs) stands
// in at a smaller scale: a 150x84 player at a ratio of 3 is 450 physical pixels, which would take the 1080p level;
// counted at 2 it is 300, which the 320x180 level fills. Local only: nothing here reaches the internet.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { astraHost } from './fixtures/astra-host.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (synthetic films)', timeout: 90_000 };
let site, host, browser, base, h264 = false;

before(async () => {
  if (live) return;
  site = await serve(0, {});
  base = `http://127.0.0.1:${site.address().port}`;
  host = await astraHost();
  browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'], ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  const page = await browser.newPage();
  h264 = await page.evaluate(() => MediaSource.isTypeSupported('video/mp4; codecs="avc1.4d400d"'));
  await page.close();
});
after(async () => { await browser?.close(); site?.close(); await host?.close(); });

/** The hls.js level an engine player of `size` CSS pixels settles on at a device pixel ratio of `ratio`. */
async function levelFor(t, size, ratio) {
  const context = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: ratio });
  t.after(() => context.close());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/astra/lab/`);
  await page.evaluate(async ([size, url]) => {
    const { AstraPlayer } = await import('/astra/src/engine/player.js');
    const video = Object.assign(document.createElement('video'), { muted: true, playsInline: true });
    Object.assign(video.style, { width: size[0] + 'px', height: size[1] + 'px', display: 'block' });
    const layer = document.createElement('div');
    document.body.prepend(video, layer);
    window.p = new AstraPlayer(video, layer);
    window.p.load({ url, autoplay: true });
  }, [size, host.url('hls2/index.m3u8')]);
  // hls.js sets its cap from the player's size once the picture is under way; then the level it loads follows it.
  await page.waitForFunction(() => { const hls = window.p.hls, v = window.p.video; return hls && v.videoWidth > 0 && v.currentTime > 0.5 && hls.autoLevelCapping >= 0 && hls.loadLevel <= hls.autoLevelCapping; }, null, { timeout: 60_000 });
  const r = await page.evaluate(() => { const hls = window.p.hls; return { ratio: devicePixelRatio, max: hls.config.maxDevicePixelRatio, cap: hls.levels[hls.autoLevelCapping]?.height, level: hls.levels[hls.loadLevel]?.height }; });
  assert.deepEqual(errors, []);
  return r;
}

test('HLS: a dense screen counts its pixel ratio at most 2, so the player is not given a level far bigger than it shows', opts, async (t) => {
  if (!h264) return t.skip('this browser has no H.264 decoder');
  const dense = await levelFor(t, [150, 84], 3);
  t.diagnostic(`ratio 3: ${JSON.stringify(dense)}`);
  assert.equal(dense.ratio, 3);
  assert.equal(dense.max, 2);
  assert.equal(dense.cap, 180, '150 CSS pixels counted at 2 is 300, which the 320x180 level fills');
  assert.equal(dense.level, 180);
  // A big player on the same screen still gets the big level.
  const big = await levelFor(t, [640, 360], 3);
  t.diagnostic(`ratio 3, 640x360: ${JSON.stringify(big)}`);
  assert.equal(big.cap, 1080);
});

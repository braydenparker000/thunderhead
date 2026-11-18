// How much of a film the engine holds at once (hold.js), in a real browser from a file host on another origin
// (tests/fixtures/astra-host.mjs). A fast film is held to bytes as well as seconds: on a 25 Mbit/s film the 40 s the
// pipelines read ahead were 125 MB in the browser's buffer, at its own limit, and the page was about 600 MB
// (scripts/astra/real.mjs, 2026-11-18). Here the small test film is made to count as fast by lowering HOLD's bytes:
// the buffer then runs a few seconds ahead of the playhead and keeps a few behind, where by time alone it holds the
// whole film. Local only: nothing here reaches the internet.
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

/** clusters.mkv (30 s, about 9.6 kB a second, a key frame every 10 s) played at twice the speed to 13 s: what is buffered around the playhead. */
async function played(t, held) {
  const page = await browser.newPage({ viewport: { width: 844, height: 390 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  t.after(() => page.close());
  await page.goto(`${base}/astra/lab/`);
  await page.evaluate(async ([url, held]) => {
    // 5 s ahead and 3 s behind of this film's bitrate, never under 1 s: what 48 and 24 MiB are to a 25 Mbit/s film.
    if (held) Object.assign((await import('/astra/src/engine/hold.js')).HOLD, { ahead: 48_000, behind: 29_000, minAhead: 1, minBehind: 1 });
    const { AstraPlayer } = await import('/astra/src/engine/player.js');
    const video = Object.assign(document.createElement('video'), { muted: true, playsInline: true });
    document.body.append(video);
    window.p = new AstraPlayer(video, document.createElement('div'));
    video.addEventListener('playing', () => { video.playbackRate = 2; }, { once: true });
    window.p.load({ url, autoplay: true });
  }, [host.url('clusters.mkv'), held]);
  await page.waitForFunction(() => window.p.video.currentTime >= 13, null, { timeout: 60_000, polling: 100 });
  await page.waitForTimeout(500); // the last append's eviction
  const r = await page.evaluate(() => {
    const v = window.p.video, b = window.p.session.queues.video.buffer.buffered, t = v.currentTime;
    for (let i = 0; i < b.length; i++) if (b.start(i) <= t && b.end(i) >= t) return { t, ahead: b.end(i) - t, behind: t - b.start(i), rate: window.p.probed.source.byteRate };
    return { t, ahead: 0, behind: 0 };
  });
  assert.deepEqual(errors, []);
  return r;
}

test('a fast film is held to bytes: a few seconds ahead of the playhead and behind it, not the whole film', opts, async (t) => {
  if (!h264) return t.skip('this browser has no H.264 decoder');
  const free = await played(t, false), held = await played(t, true);
  t.diagnostic(JSON.stringify({ free, held }));
  assert.ok(free.ahead > 14 && free.behind > 12, `by time alone the whole film stays (${JSON.stringify(free)})`);
  assert.ok(held.ahead < 9, `about 5 s read ahead, the sound at most 3 s past the picture (${held.ahead.toFixed(1)} s)`);
  assert.ok(held.behind < 4, `about 3 s kept behind, to the key frame after (${held.behind.toFixed(1)} s)`);
});

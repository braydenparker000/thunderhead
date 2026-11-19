// How much of a film the engine holds at once (hold.js), in a real browser from a file host on another origin
// (tests/fixtures/astra-host.mjs). A fast film is held to the memory budget's bytes (budget.js) before seconds: on a
// 25 Mbit/s film the 40 s the pipelines read ahead were 125 MB in the browser's buffer, at its own limit, and the page
// was about 600 MB (scripts/astra/real.mjs, 2026-11-18). Here the small test film is made to count as fast by a budget
// of 160 kB: the buffer then runs a few seconds ahead of the playhead and lets go of what is a few seconds behind it,
// where by time alone it holds the whole film; and the engine's log says what it held at the first picture
// (player-memory.js). Local only: nothing here reaches the internet.
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

/** clusters.mkv (30 s, about 9.6 kB a second, a key frame every 10 s) played at twice the speed to 13 s, then paused: what is buffered around the playhead. */
async function played(t, held) {
  const page = await browser.newPage({ viewport: { width: 844, height: 390 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  t.after(() => page.close());
  await page.goto(`${base}/astra/lab/`);
  await page.evaluate(async ([url, held]) => {
    // 160 kB of this film (9.6 kB a second): 24 kB of reach and a second behind it for the reader, 3 s behind the
    // playhead, then about 5 s ahead, kept in the cache too: what the roomy budget's 112 MiB is to a 25 Mbit/s film.
    if (held) {
      Object.assign((await import('/astra/src/engine/hold.js')).HOLD, { leastReach: 16_384, minAhead: 1, minBehind: 1, skipBack: 3 });
      for (const b of Object.values((await import('/astra/src/engine/budget.js')).BUDGETS)) b.film = 160_000;
    }
    const { AstraPlayer } = await import('/astra/src/engine/player.js');
    const video = Object.assign(document.createElement('video'), { muted: true, playsInline: true });
    document.body.append(video);
    window.p = new AstraPlayer(video, document.createElement('div'));
    video.addEventListener('playing', () => { video.playbackRate = 2; }, { once: true });
    window.p.load({ url, autoplay: true });
  }, [host.url('clusters.mkv'), held]);
  await page.waitForFunction(() => window.p.video.currentTime >= 13, null, { timeout: 60_000, polling: 50 });
  await page.evaluate(() => window.p.video.pause());
  await page.waitForTimeout(800); // the last appends, each followed by its eviction
  const r = await page.evaluate(() => {
    const v = window.p.video, b = window.p.session.queues.video.buffer.buffered, t = v.currentTime;
    const memory = window.p.log.filter((x) => x.kind === 'memory').map((x) => x.detail);
    for (let i = 0; i < b.length; i++) if (b.start(i) <= t && b.end(i) >= t) return { t, ahead: b.end(i) - t, behind: t - b.start(i), rate: window.p.probed.source.byteRate, memory };
    return { t, ahead: 0, behind: 0, memory };
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
  assert.ok(held.behind < 5, `3 s kept behind, from the key frame after their start (one every 10 s here) (${held.behind.toFixed(1)} s)`);
  // The log's entry at the first picture: numbers and fixed words only, the budget in force.
  const first = held.memory[0];
  assert.equal(held.memory.length, 1, 'one entry, at the first picture (the next comes after 60 s of play)');
  assert.equal(first.at, 'picture');
  assert.ok(['roomy', 'small', 'tight'].includes(first.budget) && first.filmMB === 0 && first.budgetMB > 0, JSON.stringify(first));
  assert.ok(first.ahead >= 0 && first.behind >= 0 && Number.isFinite(first.cacheMB), JSON.stringify(first));
  assert.ok(first.heap === null || first.heap > 0, 'the JS heap in MB where the browser gives it');
  assert.ok(!JSON.stringify(held.memory).includes('clusters'), 'nothing of the film\'s address');
});

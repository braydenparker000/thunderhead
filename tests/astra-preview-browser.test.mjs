// Seek previews in a real browser (engine/player-preview.js, player/seek-preview.js): the real PlayerScreen and
// engine play the films in tests/fixtures/astra/ from another origin (tests/fixtures/astra-host.mjs, which counts
// requests and bytes). A drag that rests shows the key frame in the bubble, matching ffmpeg's own decode of that
// frame, fetched with bounded side requests while the film plays on and its download is not restarted; a fast
// drag fetches at most two frames; the data saver and the Playback switch turn them off; closing the film leaves
// no decoder and no picture; a film the browser plays itself shows the plain bubble; the bubble stays on screen
// at both ends of the bar, landscape and portrait. WebCodecs decodes no H.264 in some browsers (CI's): the H.264
// films are skipped there and the VP9 WebM still checked. Local only: nothing here reaches the internet.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { astraHost } from './fixtures/astra-host.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (synthetic films)', timeout: 60_000 };
let site, host, browser, base, can = { h264: false, vp9: false }, ffmpeg = true;

before(async () => {
  if (live) return;
  site = await serve(0, {});
  base = `http://127.0.0.1:${site.address().port}`;
  host = await astraHost();
  browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'], ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  const page = await browser.newPage();
  await page.goto(`${base}/astra/lab/`); // a secure context: WebCodecs is there
  can = await page.evaluate(async () => {
    const ok = async (codec) => { try { return (await VideoDecoder.isConfigSupported({ codec, codedWidth: 320, codedHeight: 180 })).supported; } catch { return false; } };
    return { h264: MediaSource.isTypeSupported('video/mp4; codecs="avc1.64000d"') && await ok('avc1.64000d'), vp9: MediaSource.isTypeSupported('video/webm; codecs="vp09.00.10.08"') && await ok('vp09.00.10.08') };
  });
  await page.close();
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { ffmpeg = false; }
});
after(async () => { await browser?.close(); site?.close(); await host?.close(); });

/** The lab page with a real PlayerScreen as `window.p`; `film(url)` opens one and waits for it to play. */
async function player(t, { prefs = null, viewport = { width: 844, height: 390 } } = {}) {
  host.reset();
  const context = await browser.newContext({ viewport, hasTouch: true, isMobile: true });
  t.after(() => context.close());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/astra/lab/`);
  await page.evaluate(async (prefs) => {
    localStorage.setItem('astra.v2.player', JSON.stringify({ dataSaver: 'never', ...prefs }));
    const { PlayerScreen } = await import('/astra/src/player/player-screen.js');
    const p = (window.p = new PlayerScreen());
    p.video.muted = true;
    window.film = async (url) => {
      const ready = new Promise((r) => p.engine.addEventListener('ready', r, { once: true }));
      p.open({ stream: { url, name: 'Example 1080p' }, meta: { id: url, title: 'Invented film' } });
      await ready;
      await new Promise((r) => { const on = () => (p.video.currentTime > 0.3 ? r() : setTimeout(on, 50)); on(); });
      return p.engine.mode;
    };
  }, prefs);
  /** Presses on the bar at fraction `from`, moves to each of `path` (`gap` ms apart) and stays pressed. */
  const press = async (from, path = [], gap = 30) => {
    await page.evaluate(() => p.showControls());
    const r = await page.locator('.ap-timeline').boundingBox();
    const x = (f) => r.x + r.width * Math.min(0.998, Math.max(0.002, f)), y = r.y + r.height / 2;
    await page.mouse.move(x(from), y);
    await page.mouse.down();
    for (const f of path) { await page.mouse.move(x(f), y); await page.waitForTimeout(gap); }
  };
  const picture = (timeout = 8000) => page.waitForSelector('.ap-bubble:not([hidden]) .ap-preview:not(.empty):not(.stale)', { timeout });
  const bounded = (from) => host.stats.ranges.slice(from).filter(([, end]) => end < host.size - 1);
  return { page, errors, press, picture, bounded };
}

/** ffmpeg's decode of the film's frame at `time`, as RGBA `w`×`h`. */
function reference(name, time, w, h) {
  const file = fileURLToPath(new URL(`./fixtures/astra/${name}`, import.meta.url));
  return execFileSync('ffmpeg', ['-v', 'error', '-ss', String(time), '-i', file, '-frames:v', '1', '-vf', `scale=${w}:${h}:flags=bilinear`, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 24 });
}

/** The mean difference per channel between the bubble's picture and ffmpeg's frame at the key frame's time. */
async function difference(page, name) {
  const shot = await page.evaluate(() => {
    const c = document.querySelector('.ap-preview'), key = [...p.engine.previews.pictures.keys()].at(-1);
    return { w: c.width, h: c.height, key, data: Array.from(c.getContext('2d').getImageData(0, 0, c.width, c.height).data) };
  });
  const ref = reference(name, shot.key, shot.w, shot.h);
  let sum = 0, n = 0;
  for (let i = 0; i < shot.data.length; i += 4) for (let k = 0; k < 3; k++) { sum += Math.abs(shot.data[i + k] - ref[i + k]); n++; }
  // And against a frame a second away: the moving bars and the clock make it plainly different.
  const away = reference(name, shot.key + 1, shot.w, shot.h);
  let other = 0;
  for (let i = 0; i < shot.data.length; i += 4) for (let k = 0; k < 3; k++) other += Math.abs(shot.data[i + k] - away[i + k]);
  return { same: sum / n, other: other / n, key: shot.key };
}

for (const [name, codec, time] of [['multi.mkv', 'h264', 0.42], ['open.webm', 'vp9', 0.62], ['plain.mp4', 'h264', 0.55]]) {
  test(`${name}: a drag that rests shows the key frame in the bubble, fetched on the side while the film plays on`, opts, async (t) => {
    if (!can[codec]) return t.skip(`this browser decodes no ${codec} in WebCodecs`);
    const { page, errors, press, picture, bounded } = await player(t);
    assert.equal(await page.evaluate((u) => film(u), host.url(name)), 'remux');
    host.size = (await page.evaluate(() => p.engine.info.size));
    await page.waitForTimeout(300);
    const before = { ranges: host.stats.ranges.length, t: await page.evaluate(() => p.video.currentTime) };
    const openEnded = () => host.stats.ranges.filter(([, end]) => end >= host.size - 1).length;
    const streams = openEnded();
    await press(time);
    assert.equal(await page.locator('.ap-bubble .ap-preview.empty').count(), 1, 'the box is there, empty, before the picture');
    await picture();
    const fetched = bounded(before.ranges);
    assert.ok(fetched.length >= 1 && fetched.length <= (name === 'plain.mp4' ? 3 : 2), `side requests: ${JSON.stringify(fetched)}`);
    assert.equal(openEnded(), streams, 'no download was started again');
    await page.waitForTimeout(400);
    const now = await page.evaluate(() => ({ t: p.video.currentTime, paused: p.video.paused, used: p.engine.dataUsed() }));
    assert.ok(now.t > before.t + 0.3 && !now.paused, `the film played on (${before.t} → ${now.t})`);
    if (ffmpeg) {
      const d = await difference(page, name);
      assert.ok(d.same < 12 && d.same * 2 < d.other, `the picture is the film's frame at ${d.key}s: ${d.same.toFixed(1)} against ${d.other.toFixed(1)} a second away`);
    }
    // Let go: the bubble and its request are gone; a drag back to the same place costs nothing.
    await page.mouse.up();
    assert.equal(await page.locator('.ap-bubble').isHidden(), true);
    const again = host.stats.ranges.length;
    await press(time);
    await picture();
    assert.equal(bounded(again).length, 0, 'the second time comes from the cache');
    await page.mouse.up();
    assert.deepEqual(errors, []);
  });
}

test('a fast drag across the bar fetches at most two frames; closing the film leaves no decoder and no picture', opts, async (t) => {
  if (!can.h264) return t.skip('this browser decodes no H.264 in WebCodecs');
  const { page, errors, press, picture } = await player(t);
  await page.evaluate((u) => film(u), host.url('multi.mkv'));
  await press(0.05);
  // Moves every 16 ms from inside the page, so a slow round trip to the browser is not taken for a rest.
  await page.evaluate(async () => {
    const tl = p.timeline, r = tl.getBoundingClientRect();
    for (let i = 1; i <= 30; i++) {
      tl.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: r.left + r.width * (0.05 + i * 0.03), clientY: r.top + r.height / 2, bubbles: true }));
      await new Promise((go) => setTimeout(go, 16));
    }
  });
  await picture();
  assert.ok(await page.evaluate(() => p.scrub.time) > 50, 'the drag reached the far end');
  await page.waitForTimeout(300);
  const kept = await page.evaluate(() => { window.held = [...p.engine.previews.pictures.values()]; return window.held.length; });
  assert.ok(kept >= 1 && kept <= 2, `${kept} frames fetched`);
  await page.mouse.up();
  const after = await page.evaluate(() => { p.close(); return { previews: p.engine.previews, decoder: p.engine.previewDecoder, widths: window.held.map((b) => b.width) }; });
  assert.equal(after.previews, null);
  assert.equal(after.decoder, null);
  assert.ok(after.widths.every((w) => w === 0), 'every picture was closed');
  assert.deepEqual(errors, []);
});

for (const [why, prefs] of [['the data saver on', { dataSaver: 'always' }], ['Seek previews off', { seekPreviews: false }]]) {
  test(`with ${why}: the plain bubble and no side request`, opts, async (t) => {
    if (!can.h264) return t.skip('this browser decodes no H.264 in WebCodecs');
    const { page, errors, press, bounded } = await player(t, { prefs });
    await page.evaluate((u) => film(u), host.url('multi.mkv'));
    host.size = await page.evaluate(() => p.engine.info.size);
    const from = host.stats.ranges.length;
    await press(0.5);
    await page.waitForTimeout(600);
    assert.equal(await page.locator('.ap-bubble .ap-preview').count(), 0);
    assert.match(await page.locator('.ap-bubble').textContent(), /\d:\d\d/);
    assert.equal(bounded(from).length, 0);
    await page.mouse.up();
    assert.deepEqual(errors, []);
  });
}

test('a film the browser plays itself shows the plain bubble; the Playback menu’s switch is saved', opts, async (t) => {
  if (!can.h264) return t.skip('this browser plays no H.264');
  const { page, errors, press } = await player(t);
  assert.equal(await page.evaluate((u) => film(u), host.url('plain.mp4?nocors')), 'native');
  await press(0.5);
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.ap-bubble .ap-preview').count(), 0);
  await page.mouse.up();
  await page.evaluate(() => p.menus.openModal('playback'));
  await page.locator('[aria-label="Seek previews"]').click();
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('astra.v2.player')).seekPreviews), false);
  assert.equal(await page.locator('[aria-label="Seek previews"]').getAttribute('aria-checked'), 'false');
  assert.deepEqual(errors, []);
});

for (const viewport of [{ width: 844, height: 390 }, { width: 390, height: 844 }]) {
  test(`the bubble with its picture stays on screen at both ends of the bar at ${viewport.width}×${viewport.height}`, opts, async (t) => {
    if (!can.h264) return t.skip('this browser decodes no H.264 in WebCodecs');
    const { page, errors, press, picture } = await player(t, { viewport });
    await page.evaluate((u) => film(u), host.url('multi.mkv'));
    for (const end of [0, 1]) {
      await press(end);
      await picture();
      const b = await page.locator('.ap-bubble').boundingBox();
      assert.ok(b.x >= 0 && b.x + b.width <= viewport.width && b.y >= 0, `inside the screen: ${JSON.stringify(b)}`);
      if (process.env.PREVIEW_SHOTS) await page.screenshot({ path: `${process.env.PREVIEW_SHOTS}/bubble-${viewport.width}-${end}.png` });
      await page.mouse.up();
    }
    assert.deepEqual(errors, []);
  });
}

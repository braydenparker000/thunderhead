// What the engine does when a route fails, and the phone settings of the adaptive players, in a real browser
// on the real site page with films from a file host on another origin (tests/fixtures/astra-host.mjs).
// This Chromium cannot decode Dolby Digital, so a browser that claims it can is played by changing its
// answers: one that says yes and then cannot open the sound, one that fails on the sound's data, one that
// takes the sound and does nothing with it. Each is met with the sound rebuilt at the same place, and the
// device remembers it. A picture that falls back to the software decoder is remembered the same way.
// hls2/ is two levels of picture alone (320x180 and 1920x1080, 48 s at 6 frames a second, 4 s segments), made with
//   ffmpeg -f lavfi -i testsrc=size=1920x1080:rate=6:duration=48 -filter_complex "[0:v]split=2[a][b];[a]scale=320:180[lo];[b]null[hi]"
//     -map "[lo]" -map "[hi]" -c:v libx264 -preset veryslow -profile:v main -pix_fmt yuv420p -b:v:0 6k -maxrate:v:0 8k
//     -bufsize:v:0 16k -b:v:1 20k -maxrate:v:1 24k -bufsize:v:1 48k -g 24 -keyint_min 24 -sc_threshold 0 -bf 2 -f hls -hls_time 4
//     -hls_playlist_type vod -master_pl_name index.m3u8 -var_stream_map "v:0 v:1" -hls_segment_filename "hls2/%v/seg%d.ts" "hls2/%v/level.m3u8"
// Local only: nothing here reaches the internet.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { astraHost } from './fixtures/astra-host.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (synthetic films)', timeout: 60_000 };
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

/**
 * The lab page with one engine player (`window.p`) on a muted video of `size` CSS pixels. `lie` changes the
 * browser's Dolby answers before the engine loads: 'open' says yes and cannot open it, 'data' opens a buffer
 * that fails on Dolby data, 'mute' opens one that takes the data and keeps nothing.
 */
async function player(t, { lie = null, size = [640, 360], viewport = { width: 844, height: 390 } } = {}) {
  host.reset();
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  t.after(() => page.close());
  await page.goto(`${base}/astra/lab/`);
  await page.evaluate(async ([lie, size]) => {
    localStorage.removeItem('astra-routes');
    if (lie) {
      const dolby = (mime) => /ac-3|ec-3/.test(mime);
      const says = MediaSource.isTypeSupported.bind(MediaSource);
      MediaSource.isTypeSupported = (mime) => dolby(mime) || says(mime);
      const add = MediaSource.prototype.addSourceBuffer;
      if (lie !== 'open') {
        MediaSource.prototype.addSourceBuffer = function (mime) {
          if (!dolby(mime)) return add.call(this, mime);
          const sb = add.call(this, 'audio/mp4; codecs="opus"');
          if (lie === 'mute') sb.appendBuffer = function () { setTimeout(() => this.dispatchEvent(new Event('updateend'))); };
          if (lie === 'mute') this.endOfStream = () => {}; // so nothing but the empty sound buffer gives it away
          return sb;
        };
      }
    }
    window.breakVideo = false; // true: the browser refuses an H.264 buffer (a decoder that fails)
    const add = MediaSource.prototype.addSourceBuffer;
    MediaSource.prototype.addSourceBuffer = function (mime) {
      if (window.breakVideo && /avc1/.test(mime)) throw new DOMException('refused', 'NotSupportedError');
      return add.call(this, mime);
    };
    const { AstraPlayer } = await import('/astra/src/engine/player.js');
    const video = Object.assign(document.createElement('video'), { muted: true, playsInline: true });
    Object.assign(video.style, { width: size[0] + 'px', height: size[1] + 'px', display: 'block' });
    const layer = document.createElement('div');
    document.body.prepend(video, layer);
    const p = (window.p = new AstraPlayer(video, layer));
    window.seen = { errors: [], ready: 0 };
    p.addEventListener('error', (e) => window.seen.errors.push(e.detail.message));
    p.addEventListener('ready', () => window.seen.ready++);
  }, [lie, size]);
  const load = (url, o = {}) => page.evaluate(([url, o]) => { window.seen.ready = 0; window.p.load({ url, autoplay: true, ...o }); }, [url, o]);
  const runs = async (by = 1, timeout = 20_000) => page.waitForFunction(([from, by]) => { const v = window.p.video; return v.videoWidth > 0 && v.currentTime >= from + by; }, [await page.evaluate(() => window.p.video.currentTime), by], { timeout });
  const state = () => page.evaluate(() => ({
    mode: window.p.mode, audio: window.p.audioOptions(), notes: window.p.plan?.notes || [], routes: JSON.parse(localStorage.getItem('astra-routes') || 'null'),
    switched: window.p.log.filter((l) => l.kind === 'passthrough').length, ...window.seen,
  }));
  return { page, errors, load, runs, state };
}

for (const [lie, what] of [['open', 'cannot open it'], ['data', 'fails on its data'], ['mute', 'keeps none of it']]) {
  test(`Dolby Digital the browser claims but ${what} is rebuilt at the same place, and the next film starts rebuilt`, opts, async (t) => {
    if (!h264) return t.skip('this browser has no H.264 decoder');
    const p = await player(t, { lie });
    assert.equal(await p.page.evaluate(() => window.p.constructor && MediaSource.isTypeSupported('audio/mp4; codecs="ac-3"')), true);
    await p.load(host.url('surround.mkv'));
    await p.runs(1.5, 30_000);
    let s = await p.state();
    assert.equal(s.mode, 'remux');
    assert.equal(s.audio[0].delivery, 'rebuilt', 'the sound now converted on the device');
    assert.equal(s.switched, 1, 'switched once');
    t.diagnostic(`switched because: ${await p.page.evaluate(() => JSON.stringify(window.p.log.find((l) => l.kind === 'passthrough').detail))}`);
    assert.ok(s.routes.pass.ac3 > 0, 'remembered for this device');
    assert.deepEqual(s.errors, [], 'nothing said to the owner');
    // The next film with that sound does not try passing it through again.
    await p.load(host.url('surround.mkv'));
    await p.runs(1);
    s = await p.state();
    assert.equal(s.audio[0].delivery, 'rebuilt');
    assert.equal(s.switched, 1);
    assert.deepEqual(p.errors, []);
  });
}

test('a picture that failed in the browser and played in software starts in software next time', opts, async (t) => {
  if (!h264) return t.skip('this browser has no H.264 decoder');
  const p = await player(t);
  await p.page.evaluate(() => { window.breakVideo = true; });
  await p.load(host.url('multi.mkv'));
  await p.runs(3, 30_000);
  let s = await p.state();
  assert.equal(s.mode, 'software');
  const codec = await p.page.evaluate(() => window.p.info.video[0].codecString);
  assert.equal(s.routes.fallback[codec]?.ok, true, `${codec} remembered once software played it`);
  await p.page.evaluate(() => { window.breakVideo = false; });
  await p.load(host.url('multi.mkv'));
  await p.page.waitForFunction(() => window.seen.ready > 0 || window.seen.errors.length, null, { timeout: 20_000 });
  s = await p.state();
  assert.equal(s.mode, 'software', 'straight to the software decoder');
  assert.match(s.notes.join(' '), /failed in this phone's own decoder before/);
  assert.deepEqual(s.errors, []);
});

/** hls.js's level now and how far ahead it has read, once it has stopped reading. */
async function settled(p) {
  await p.runs(1);
  let last = -1;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const end = await p.page.evaluate(() => { const b = window.p.video.buffered; return b.length ? b.end(b.length - 1) : 0; });
    if (end === last && i > 4) break;
    last = end;
  }
  return p.page.evaluate(() => {
    const v = window.p.video, b = v.buffered, hls = window.p.hls;
    return { level: hls.levels[hls.loadLevel]?.height, ahead: (b.length ? b.end(b.length - 1) : 0) - v.currentTime, cap: hls.config.capLevelToPlayerSize };
  });
}

test('HLS: a small player loads the small level, a big one the big level, and the saver holds it to 720p and 20 s ahead', opts, async (t) => {
  if (!h264) return t.skip('this browser has no H.264 decoder');
  const small = await player(t, { size: [300, 170] });
  await small.load(host.url('hls2/index.m3u8'));
  let r = await settled(small);
  t.diagnostic(`small: ${JSON.stringify(r)}`);
  assert.equal(r.cap, true);
  assert.equal(r.level, 180, 'the 320x180 level fills a 300x170 player');
  assert.ok(r.ahead > 30 && r.ahead <= 44, `about 40 s read ahead, not the whole 48 s (${r.ahead.toFixed(1)} s)`);
  const big = await player(t, { size: [1280, 720], viewport: { width: 1280, height: 720 } });
  await big.load(host.url('hls2/index.m3u8'));
  r = await settled(big);
  assert.equal(r.level, 1080, 'a big player gets the big level');
  const saver = await player(t, { size: [1280, 720], viewport: { width: 1280, height: 720 } });
  await saver.page.evaluate(() => window.p.setDataSaver(true));
  await saver.load(host.url('hls2/index.m3u8'));
  r = await settled(saver);
  t.diagnostic(`saver: ${JSON.stringify(r)}`);
  assert.equal(r.level, 180, 'with the saver, nothing above 720p');
  assert.ok(r.ahead > 12 && r.ahead <= 25, `about 20 s read ahead (${r.ahead.toFixed(1)} s)`);
  // Turned off while playing: the ceiling and the reach follow.
  await saver.page.evaluate(() => window.p.setDataSaver(false));
  assert.equal(await saver.page.evaluate(() => window.p.hls.config.maxBufferLength), 40);
  for (const p of [small, big, saver]) assert.deepEqual(p.errors, []);
});

test('DASH plays with the phone settings put on dash.js, and the saver reaches it', opts, async (t) => {
  if (!h264) return t.skip('this browser has no H.264 decoder');
  const p = await player(t);
  await p.load(host.url('dash/index.mpd'));
  await p.runs(1);
  const read = () => p.page.evaluate(() => { const s = window.p.dash.getSettings().streaming; return { ahead: s.buffer.bufferTimeAtTopQuality, behind: s.buffer.bufferToKeep, portal: s.abr.limitBitrateByPortal, ratio: s.abr.usePixelRatioInLimitBitrateByPortal, max: s.abr.maxBitrate.video }; });
  assert.deepEqual(await read(), { ahead: 40, behind: 30, portal: true, ratio: true, max: -1 });
  await p.page.evaluate(() => window.p.setDataSaver(true));
  const on = await read();
  assert.equal(on.ahead, 20);
  assert.ok(on.max > 0 && on.max <= 3000, `a ceiling under the saver (${on.max} kbit/s)`);
  assert.deepEqual(p.errors, []);
});

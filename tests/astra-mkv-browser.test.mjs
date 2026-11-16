// Astra's own Matroska packet reader (mkv-packets.js) in a real browser, from a file host on another origin
// (tests/fixtures/astra-host.mjs): films with 5-second clusters and with their cue index at the front play and seek
// through it; a film it will not read past (a cluster holding a second time) goes back to Mediabunny's reader and
// plays on; and with the host paced, a film whose clusters are megabytes shows its first picture, from the start and
// after a seek, once well under one cluster has arrived. That film is made here with ffmpeg (about 10 MB).
// Local only: nothing here reaches the internet.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { astraHost } from './fixtures/astra-host.mjs';
import { readLayout, header, uint } from '../frontend/astra/src/engine/mkv.js';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (synthetic films)', timeout: 120_000 };
let site, host, browser, base, h264 = false, dir;

before(async () => {
  if (live) return;
  site = await serve(0, {});
  base = `http://127.0.0.1:${site.address().port}`;
  host = await astraHost();
  browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'], ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  const page = await browser.newPage();
  h264 = await page.evaluate(() => MediaSource.isTypeSupported('video/mp4; codecs="avc1.4d400d"'));
  await page.close();
  dir = mkdtempSync(join(tmpdir(), 'astra-mkv-'));
});
after(async () => { await browser?.close(); site?.close(); await host?.close(); });

/** A page of the real site holding one engine player on a muted video (`window.p`); `own: false` turns Astra's reader off. */
async function player(t, own = true) {
  const page = await browser.newPage({ viewport: { width: 844, height: 390 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  t.after(() => page.close());
  await page.goto(`${base}/astra/lab/`);
  await page.evaluate(async (own) => {
    (await import('/astra/src/engine/remux.js')).TUNING.ownMkv = own;
    const { AstraPlayer } = await import('/astra/src/engine/player.js');
    const video = Object.assign(document.createElement('video'), { muted: true, playsInline: true });
    document.body.append(video);
    window.p = new AstraPlayer(video, document.createElement('div'));
    window.seen = [];
    window.p.addEventListener('error', (e) => window.seen.push(e.detail.message));
  }, own);
  const load = (url, o = {}) => page.evaluate(([url, o]) => { window.p.load({ url, autoplay: true, ...o }); }, [url, o]);
  const at = (time, timeout = 30_000) => page.waitForFunction((time) => { const v = window.p.video; return v.videoWidth > 0 && v.readyState >= 2 && !v.seeking && v.currentTime >= time; }, time, { timeout, polling: 40 });
  const state = () => page.evaluate(() => ({ own: !!window.p.session?.packets, stats: window.p.session?.stats, t: window.p.video.currentTime, errors: window.seen }));
  return { page, errors, load, at, state };
}

for (const name of ['clusters.mkv', 'frontcues.mkv']) {
  test(`${name} plays and seeks through Astra's own reader`, opts, async (t) => {
    if (!h264) return t.skip('this browser has no H.264 decoder');
    host.reset();
    const p = await player(t);
    await p.load(host.url(name));
    await p.at(1);
    await p.page.evaluate(() => { window.p.video.currentTime = 7.5; });
    await p.at(8.2);
    const s = await p.state();
    assert.ok(s.own, 'read by Astra’s reader');
    assert.equal(s.stats.fallback, undefined);
    assert.deepEqual([s.errors, p.errors], [[], []]);
  });
}

test('a film Astra’s reader will not read past goes back to Mediabunny’s reader and plays on', opts, async (t) => {
  if (!h264) return t.skip('this browser has no H.264 decoder');
  // frontcues.mkv with one sound block in its fourth cluster replaced by a second cluster time and a Void of the same
  // length: Mediabunny takes the time again (the same) and steps over the Void; Astra's reader will not guess.
  const bytes = new Uint8Array(readFileSync(new URL('./fixtures/astra/frontcues.mkv', import.meta.url)));
  const layout = await readLayout(async (s, e) => bytes.subarray(s, e), bytes.length);
  const cluster = layout.trackCues.get(1)[3].position, top = header(bytes, cluster);
  let at = top.dataStart, done = false, base = 0;
  while (!done) {
    const h = header(bytes, at), length = h.dataStart - at + h.size; // header() gives dataStart in the file
    if (h.id === 0xe7) base = uint(bytes, h.dataStart, at + length);
    if (h.id === 0xa3 && bytes[h.dataStart] === 0x82 && length > 16 && length < 200) {
      bytes.set([0xe7, 0x82, base >> 8, base & 255, 0xec, 0x01, 0, 0, 0, 0, 0, 0, length - 13], at);
      bytes.fill(0, at + 13, at + length);
      done = true;
    }
    at += length;
  }
  writeFileSync(join(dir, 'damaged.mkv'), bytes);
  const damaged = await astraHost({ root: dir + '/' });
  t.after(() => damaged.close());
  const p = await player(t);
  await p.load(damaged.url('damaged.mkv'));
  await p.at(9.5);
  const s = await p.state();
  assert.match(s.stats.fallback || '', /second cluster time/);
  assert.equal(s.own, false, 'Mediabunny reads it now');
  assert.deepEqual([s.errors, p.errors], [[], []]);
});

/** Bytes the host sent, and milliseconds, before the first picture at `time`, from a fresh load (`startTime`) or a seek. */
async function firstPicture(t, film, own, time, how) {
  const p = await player(t, own);
  host.reset();
  if (how === 'seek') {
    host.control.bps = 800_000;
    await p.load(host.url(film));
    await p.at(0.2);
    await p.page.evaluate(() => window.p.video.pause());
  }
  host.control.bps = 375_000;
  const from = host.stats.bytes, began = Date.now();
  if (how === 'seek') await p.page.evaluate((time) => { window.p.video.currentTime = time; window.p.video.play(); }, time);
  else await p.load(host.url(film), { startTime: time });
  await p.at(time, 60_000);
  const sent = host.stats.bytes - from, ms = Date.now() - began;
  assert.equal((await p.state()).own, own);
  await p.page.close();
  return {sent, ms};
}

test('paced at 375 kB/s, a film of 2.5 MB clusters shows its first picture after well under one, from the start and after a seek', opts, async (t) => {
  if (!h264) return t.skip('this browser has no H.264 decoder');
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { return t.skip('ffmpeg is not installed, so the film cannot be made'); }
  // 20 s at 4 Mbit/s, key frames at 0 and 10 s, a cluster every 5 s.
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24:duration=20', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=20',
    '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', '4M', '-minrate', '4M', '-maxrate', '4M', '-bufsize', '8M', '-x264-params', 'nal-hrd=cbr', '-g', '240',
    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-cluster_time_limit', '5000', '-cluster_size_limit', '50000000', join(dir, 'big.mkv')]);
  await host.close();
  host = await astraHost({ root: dir + '/' });
  const cluster = 2_500_000, oneCluster = (cluster / 375_000) * 1000;
  const before = await firstPicture(t, 'big.mkv', false, 0, 'load');
  const start = await firstPicture(t, 'big.mkv', true, 0, 'load');
  const seek = await firstPicture(t, 'big.mkv', true, 10, 'seek');
  const kB = (n) => Math.round(n / 1e3);
  t.diagnostic(`first picture: Mediabunny's reader ${kB(before.sent)} kB, ${before.ms} ms; Astra's ${kB(start.sent)} kB, ${start.ms} ms; after a seek ${seek.ms} ms`);
  assert.ok(before.sent > cluster * 0.9, 'Mediabunny’s reader needed the whole first cluster');
  assert.ok(start.sent < cluster / 2, 'Astra’s reader, well under one cluster');
  // After a seek the bytes also count the old download's last moments, so the time is what is held: under half of
  // what one cluster takes to arrive.
  assert.ok(seek.ms < oneCluster / 2, `and after a seek (${seek.ms} ms)`);
});

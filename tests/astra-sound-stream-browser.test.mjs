// Rebuilt sound decoded from Astra's own Matroska reader's packets (sound-stream.js) in a real browser, from a file
// host on another origin (tests/fixtures/astra-host.mjs): Dolby Digital 5.1, Dolby TrueHD and DTS 5.1 each play with
// their tone heard and go on being heard after a seek; a switch between two rebuilt tracks is heard; the dialogue lift
// still raises the centre; and with the host paced, a film of 5-second clusters with Dolby Digital sound has its first
// picture and its sound buffered after well under one cluster, where Mediabunny's reader needed the whole cluster for
// the sound. The two films made here with ffmpeg (skipped without it) are about 10 MB and 100 kB.
// Local only: nothing here reaches the internet.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { astraHost } from './fixtures/astra-host.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (synthetic films)', timeout: 120_000 };
let site, host, made, browser, base, h264 = false, dir = null, ffmpeg = true;
const ff = (...args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);

before(async () => {
  if (live) return;
  site = await serve(0, {});
  base = `http://127.0.0.1:${site.address().port}`;
  host = await astraHost();
  browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'], ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  const page = await browser.newPage();
  h264 = await page.evaluate(() => MediaSource.isTypeSupported('video/mp4; codecs="avc1.4d400d"'));
  await page.close();
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { ffmpeg = false; return; }
  dir = mkdtempSync(join(tmpdir(), 'astra-sound-'));
  // two.mkv: two Dolby Digital tracks, English at 660 Hz and Japanese at 990 Hz. 10 s.
  ff('-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=12:duration=10', '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=48000:duration=10',
    '-f', 'lavfi', '-i', 'sine=frequency=990:sample_rate=48000:duration=10', '-map', '0:v', '-map', '1:a', '-map', '2:a', '-c:v', 'libx264', '-preset', 'veryfast',
    '-pix_fmt', 'yuv420p', '-b:v', '40k', '-g', '24', '-c:a', 'ac3', '-b:a', '64k', '-ac', '2', '-metadata:s:a:0', 'language=eng', '-metadata:s:a:1', 'language=jpn', join(dir, 'two.mkv'));
  // big.mkv: 20 s at 4 Mbit/s, key frames at 0 and 10 s, a cluster every 5 s (2.5 MB), Dolby Digital 5.1 at 440 Hz.
  ff('-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24:duration=20', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=20',
    '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', '4M', '-minrate', '4M', '-maxrate', '4M', '-bufsize', '8M', '-x264-params', 'nal-hrd=cbr', '-g', '240',
    '-pix_fmt', 'yuv420p', '-c:a', 'ac3', '-b:a', '192k', '-ac', '6', '-cluster_time_limit', '5000', '-cluster_size_limit', '50000000', join(dir, 'big.mkv'));
  made = await astraHost({ root: dir + '/' });
});
after(async () => { await browser?.close(); site?.close(); await host?.close(); await made?.close(); if (dir) rmSync(dir, { recursive: true, force: true }); });

/** A page of the real site holding one engine player on a muted video (`window.p`); `own: false` reads rebuilt sound with Mediabunny. */
async function player(t, own = true) {
  host.reset(); made?.reset();
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  t.after(() => page.close());
  await page.goto(`${base}/astra/lab/`);
  await page.evaluate(async (own) => {
    (await import('/astra/src/engine/sound-stream.js')).SOUND.own = own;
    const { AstraPlayer } = await import('/astra/src/engine/player.js');
    const video = Object.assign(document.createElement('video'), { muted: true, playsInline: true });
    document.body.append(video);
    window.p = new AstraPlayer(video, document.createElement('div'));
    window.seen = [];
    window.p.addEventListener('error', (e) => window.seen.push(e.detail.message));
  }, own);
  const load = (url, o = {}) => page.evaluate(([url, o]) => { window.p.load({ url, autoplay: true, ...o }); }, [url, o]);
  const at = (time, timeout = 30_000) => page.waitForFunction((time) => { const v = window.p.video; return v.videoWidth > 0 && v.readyState >= 2 && !v.seeking && v.currentTime >= time; }, time, { timeout, polling: 40 });
  const state = () => page.evaluate(() => ({ stats: window.p.session?.stats, audio: window.p.audioOptions(), t: window.p.video.currentTime, errors: window.seen }));
  return { page, errors, load, at, state };
}

/** The loudest pitch the video element plays (Hz), heard through an AnalyserNode over `ms`; 0 for silence. */
const heard = (page, ms = 1200) => page.evaluate(async (ms) => {
  const v = window.p.video;
  if (!window.ear) {
    const ctx = new AudioContext(), a = ctx.createAnalyser();
    a.fftSize = 8192; ctx.createMediaElementSource(v).connect(a); a.connect(ctx.destination);
    window.ear = { ctx, a };
    await ctx.resume();
  }
  v.muted = false; v.volume = 1;
  const { ctx, a } = window.ear, bins = new Float32Array(a.frequencyBinCount);
  let best = -Infinity, at = 0;
  for (const until = performance.now() + ms; performance.now() < until;) {
    await new Promise((r) => setTimeout(r, 100));
    a.getFloatFrequencyData(bins);
    bins.forEach((db, i) => { if (db > best) { best = db; at = i; } });
  }
  return best > -70 ? Math.round((at * ctx.sampleRate) / a.fftSize) : 0;
}, ms);
const near = (hz, want) => Math.abs(hz - want) < 15;

for (const [film, hz, start, label] of [['surround.mkv', 660, 12.3, 'Dolby Digital'], ['truehd.mkv', 770, 3.3, 'Dolby TrueHD'], ['dts.mkv', 880, 1.3, 'DTS']]) {
  test(`${label} (${film}) is decoded from Astra's own reader and heard, from a place mid-film and after a seek back`, opts, async (t) => {
    if (!h264) return t.skip('this browser has no H.264 decoder');
    const p = await player(t);
    // Mid-film, so the decoder starts a pre-roll before the place; then back before it, so fresh pipelines start there.
    await p.load(host.url(film), { startTime: start });
    await p.at(start + 0.1);
    let s = await p.state();
    assert.equal(s.audio[0].delivery, 'rebuilt');
    assert.equal(s.stats.ownSound, true, 'its sound is read by Astra’s reader');
    let pitch = await heard(p.page, film === 'dts.mkv' ? 600 : 1200);
    assert.ok(near(pitch, hz), `its ${hz} Hz tone is heard (loudest: ${pitch} Hz)`);
    await p.page.evaluate(() => { window.p.video.currentTime = 0.2; });
    await p.page.waitForFunction(() => window.p.session.stats.restarts > 0, null, { timeout: 10_000 });
    await p.at(0.4);
    pitch = await heard(p.page, 600);
    assert.ok(near(pitch, hz), `and after the seek back (loudest: ${pitch} Hz)`);
    s = await p.state();
    assert.equal(s.stats.ownSound, true);
    assert.equal(s.stats.soundFallback, undefined);
    assert.deepEqual([s.errors, p.errors], [[], []]);
  });
}

test('a switch between two rebuilt tracks is heard', opts, async (t) => {
  if (!h264) return t.skip('this browser has no H.264 decoder');
  if (!ffmpeg) return t.skip('ffmpeg is not installed, so the film cannot be made');
  const p = await player(t);
  await p.load(made.url('two.mkv'));
  await p.at(0.5);
  assert.ok(near(await heard(p.page), 660), 'English at 660 Hz');
  await p.page.evaluate(() => window.p.selectAudio(window.p.audioOptions()[1].id));
  await p.page.waitForTimeout(1200);
  const pitch = await heard(p.page);
  assert.ok(near(pitch, 990), `then Japanese at 990 Hz (loudest: ${pitch} Hz)`);
  const s = await p.state();
  assert.deepEqual(s.audio.map((a) => a.delivery), ['rebuilt', 'rebuilt']);
  assert.equal(s.stats.ownSound, true);
  assert.deepEqual([s.errors, p.errors], [[], []]);
});

test('the dialogue lift still raises the centre of rebuilt 5.1 sound read this way', opts, async (t) => {
  if (!h264) return t.skip('this browser has no H.264 decoder');
  const p = await player(t);
  await p.load(host.url('surround.mkv'));
  await p.at(1);
  const loudness = () => p.page.evaluate(async () => {
    const { a } = window.ear, buf = new Float32Array(a.fftSize);
    let sum = 0, n = 0;
    for (const until = performance.now() + 1000; performance.now() < until;) {
      await new Promise((r) => setTimeout(r, 50));
      a.getFloatTimeDomainData(buf);
      for (const x of buf) { sum += x * x; n++; }
    }
    return Math.sqrt(sum / n);
  });
  await heard(p.page, 200); // the ear on, the sound unmuted
  const quiet = await loudness();
  await p.page.evaluate(() => window.p.setDialogue(2));
  await p.page.waitForTimeout(1200);
  const db = 20 * Math.log10((await loudness()) / quiet);
  t.diagnostic(`${db.toFixed(1)} dB louder with the centre raised`);
  assert.ok(db > 7 && db < 9, `the centre is raised by about 8 dB (${db.toFixed(1)} dB)`);
  const s = await p.state();
  assert.equal(s.stats.ownSound, true);
  assert.deepEqual([s.errors, p.errors], [[], []]);
});

/** Bytes the host sent, and milliseconds, before the first picture shows and sound is buffered, from a fresh load. */
async function firstSound(t, own) {
  const p = await player(t, own);
  made.control.bps = 375_000;
  const began = Date.now();
  await p.load(made.url('big.mkv'));
  await p.page.waitForFunction(() => { const v = window.p.video, a = window.p.session?.queues.audio?.buffer; return v.videoWidth > 0 && v.readyState >= 2 && a?.buffered.length > 0; }, null, { timeout: 60_000, polling: 40 });
  const sent = made.stats.bytes, ms = Date.now() - began;
  assert.equal((await p.state()).stats.ownSound, own);
  await p.page.close();
  return { sent, ms };
}

test('paced at 375 kB/s, a film of 2.5 MB clusters with Dolby Digital has picture and sound after well under one cluster', opts, async (t) => {
  if (!h264) return t.skip('this browser has no H.264 decoder');
  if (!ffmpeg) return t.skip('ffmpeg is not installed, so the film cannot be made');
  const cluster = 2_500_000;
  const was = await firstSound(t, false), now = await firstSound(t, true);
  const kB = (n) => Math.round(n / 1e3);
  t.diagnostic(`picture and sound: Mediabunny's sound reader ${kB(was.sent)} kB, ${was.ms} ms; Astra's ${kB(now.sent)} kB, ${now.ms} ms`);
  assert.ok(was.sent > cluster * 0.9, 'Mediabunny’s reader needed the whole first cluster for the sound');
  assert.ok(now.sent < cluster / 2, 'Astra’s, well under one cluster');
  assert.ok(now.ms < was.ms / 2, 'in under half the time');
});

test('something unexpected on this path mid-film: Mediabunny\'s sink reads the sound from there, and it is heard', opts, async (t) => {
  if (!h264) return t.skip('this browser has no H.264 decoder');
  const p = await player(t);
  await p.page.evaluate(async () => {
    const { PacketsFrom } = await import('/astra/src/engine/sound-stream.js');
    const packets = PacketsFrom.prototype.packets;
    PacketsFrom.prototype.packets = async function* (start) {
      let n = 0;
      for await (const packet of packets.call(this, start)) { if (++n > 150) throw new Error('an invented surprise'); yield packet; }
    };
  });
  await p.load(host.url('surround.mkv'));
  await p.page.waitForFunction(() => window.p.session?.stats.soundFallback, null, { timeout: 20_000 });
  await p.at(6);
  const pitch = await heard(p.page);
  assert.ok(near(pitch, 660), `heard on (loudest: ${pitch} Hz)`);
  const s = await p.state();
  assert.match(s.stats.soundFallback, /invented surprise/);
  assert.equal(s.stats.ownSound, false, 'Mediabunny reads it now');
  assert.deepEqual([s.errors, p.errors], [[], []]);
});

test('with Headphone surround on, rebuilt 5.1 reaches the page whole (FLAC) and is placed; off, it is stereo Opus again', opts, async (t) => {
  if (!h264) return t.skip('this browser has no H.264 decoder');
  const p = await player(t);
  await p.load(host.url('surround.mkv'));
  await p.at(0.5);
  const r = await p.page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const until = async (ok, ms = 8000) => { for (const end = performance.now() + ms; !ok() && performance.now() < end;) await wait(50); return ok(); };
    const { Sound } = await import('/astra/src/enhance/sound.js');
    const p = window.p, v = p.video, out = { can: p.canKeepSurround(6) };
    const sound = new Sound(v); sound.mode = p.mode;
    v.muted = false;
    sound.set({ headphones: true });
    await until(() => sound.state().channels === 2);
    out.before = { channels: sound.state().channels, mime: p.session.audioMime };
    // Each channel apart, before the chain: surround.mkv's tone is in the centre alone.
    const ctx = sound.ctx, split = ctx.createChannelSplitter(6);
    sound.source.connect(split);
    const ears = [0, 2].map((i) => { const a = ctx.createAnalyser(); a.fftSize = 8192; split.connect(a, i); return a; });
    const placed = ctx.createAnalyser(); placed.fftSize = 8192; sound.chain.out.connect(placed);
    const level = (a) => { const b = new Float32Array(a.fftSize); a.getFloatTimeDomainData(b); return Math.sqrt(b.reduce((s, x) => s + x * x, 0) / b.length); };
    const at = v.currentTime;
    p.setSurround(true); // a fresh session at the same place: the browser fixes the channels as a media source starts
    out.six = await until(() => sound.state().channels === 6);
    out.kept = v.currentTime - at;
    await wait(600);
    out.after = { channels: sound.state().channels, mime: p.session?.audioMime, left: level(ears[0]), centre: level(ears[1]), placed: level(placed), own: p.session.stats.ownSound };
    p.setSurround(false);
    out.two = await until(() => sound.state().channels === 2);
    await wait(400);
    out.back = { mime: p.session?.audioMime, left: level(ears[0]), t: v.currentTime };
    return out;
  });
  t.diagnostic(JSON.stringify(r));
  assert.ok(r.can, 'this browser can keep 5.1 whole');
  assert.deepEqual(r.before, { channels: 2, mime: 'audio/mp4; codecs="opus"' }, 'off: stereo Opus, as before');
  assert.ok(r.six, 'on: the chain’s channel counter says 6');
  assert.ok(r.kept > -0.5 && r.kept < 4, `played on from where it was (${r.kept.toFixed(2)} s later)`);
  assert.equal(r.after.mime, 'audio/mp4; codecs="flac"');
  assert.ok(r.after.centre > 0.05 && r.after.left < 0.005, `the tone is in the centre alone (centre ${r.after.centre}, left ${r.after.left})`);
  assert.ok(r.after.placed > 0.02, 'and placed, heard from the chain');
  assert.equal(r.after.own, true);
  assert.ok(r.two, 'off again: two channels');
  assert.equal(r.back.mime, 'audio/mp4; codecs="opus"');
  assert.ok(r.back.left > 0.02, 'the centre mixed into the left again');
  const s = await p.state();
  assert.deepEqual([s.errors, p.errors], [[], []]);
});

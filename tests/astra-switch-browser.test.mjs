// Changing a film's sound while it plays, in a real browser from the tests' file host (frontend/astra/src/engine/
// remux-switch.js, sound-wait.js). Another track is written over the old from a second past the playhead, so the
// picture does not stop (it stopped 0.9 to 2.7 s on a real film while the buffer was emptied and the film sought in
// place). Sound whose converter cannot be downloaded no longer stops the film: another track that needs none plays,
// with a notice, or the film plays on without sound until the converter comes. Local only: nothing reaches the internet.
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

/** A page of the site with one engine player whose sound is heard through an analyser: `window.p`, `window.seen`. */
async function player(t, { refuse = null } = {}) {
  const context = await browser.newContext({ viewport: { width: 844, height: 390 } });
  t.after(() => context.close());
  // The decoders' downloads refused while `refuse.on` (the converter cannot be downloaded).
  if (refuse) await context.route(/mediabunny-(ac3|dts|truehd)\.js/, (route) => (refuse.on ? route.abort('connectionfailed') : route.continue()));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/astra/lab/`);
  await page.evaluate(async () => {
    Object.assign((await import('/astra/src/engine/sound-wait.js')).CONVERTER, { again: 1 });
    const { AstraPlayer } = await import('/astra/src/engine/player.js');
    const video = Object.assign(document.createElement('video'), { playsInline: true });
    document.body.append(video);
    const ctx = new AudioContext(), a = ctx.createAnalyser();
    a.fftSize = 8192; ctx.createMediaElementSource(video).connect(a); a.connect(ctx.destination);
    await ctx.resume();
    const p = (window.p = new AstraPlayer(video, document.createElement('div')));
    const seen = (window.seen = { errors: [], notices: [], seeks: 0, frames: [] });
    p.addEventListener('error', (e) => seen.errors.push(e.detail.message));
    p.addEventListener('notice', (e) => seen.notices.push(e.detail));
    video.addEventListener('seeking', () => seen.seeks++);
    video.requestVideoFrameCallback(function each(now) { seen.frames.push(now); video.requestVideoFrameCallback(each); });
    // The loudest pitch over the last `ms` (0: silence).
    window.pitch = async (ms = 1200) => {
      const bins = new Float32Array(a.frequencyBinCount); let best = -Infinity, at = 0;
      for (const until = performance.now() + ms; performance.now() < until;) {
        await new Promise((r) => setTimeout(r, 100));
        a.getFloatFrequencyData(bins); bins.forEach((db, i) => { if (db > best) { best = db; at = i; } });
      }
      return best > -70 ? Math.round((at * ctx.sampleRate) / a.fftSize) : 0;
    };
  });
  const at = (s) => page.waitForFunction((s) => window.p.video.currentTime >= s, s, { timeout: 30_000 });
  return { page, errors, at };
}

test('another sound track: the old one plays on for a second, then the new one, and the picture never stops', opts, async (t) => {
  if (!h264) return t.skip('this browser has no H.264 decoder');
  const { page, errors, at } = await player(t);
  await page.evaluate((url) => window.p.load({ url, autoplay: true }), host.url('multi.mkv'));
  await at(3);
  assert.equal(await page.evaluate(() => window.pitch()), 440, 'English, at 440 Hz');
  const before = await page.evaluate(() => { window.seen.seeks = 0; window.seen.frames.length = 0; window.p.selectAudio(window.p.audioOptions()[1].id); return window.p.video.currentTime; });
  await at(before + 2.5);
  const r = await page.evaluate(async () => {
    const f = window.seen.frames; let pause = 0; for (let i = 1; i < f.length; i++) pause = Math.max(pause, f[i] - f[i - 1]);
    return { hz: await window.pitch(), seeks: window.seen.seeks, pause: Math.round(pause), joins: window.p.session.stats.joins };
  });
  t.diagnostic(JSON.stringify(r));
  assert.equal(r.hz, 880, 'Japanese, at 880 Hz');
  assert.equal(r.joins, 1, 'written over the old sound from a second on');
  assert.equal(r.seeks, 0, 'no seek in place to let go of the old sound');
  assert.ok(r.pause < 400, `the picture kept going (longest pause ${r.pause} ms; a frame every 83 ms)`);
  assert.deepEqual([errors, await page.evaluate(() => window.seen.errors)], [[], []]);
});

test('the converter refused: the film plays another track that needs none, and says so', opts, async (t) => {
  if (!h264) return t.skip('this browser has no H.264 decoder');
  const { page, errors, at } = await player(t, { refuse: { on: true } });
  await page.evaluate((url) => window.p.load({ url, autoplay: true }), host.url('mixed.mkv'));
  await at(3);
  const r = await page.evaluate(async () => ({ hz: await window.pitch(), notices: window.seen.notices, errors: window.seen.errors, selected: window.p.audioOptions().find((a) => a.selected)?.label, offered: window.p.audioOptions().map((a) => a.supported) }));
  t.diagnostic(JSON.stringify(r));
  assert.deepEqual(r.errors, [], 'no stop');
  assert.equal(r.hz, 440, 'the AAC track, passed through as it is');
  assert.match(r.selected, /Stereo/);
  assert.ok(r.notices.some((n) => /converter could not be downloaded, so this plays Stereo/.test(n)), r.notices.join(' | '));
  assert.deepEqual(r.offered, [true, true], 'the converted track stays in the menu, to try again');
  assert.deepEqual(errors, []);
});

test('the converter refused and no other track: the film plays on without sound, and the sound comes in once it can', opts, async (t) => {
  if (!h264) return t.skip('this browser has no H.264 decoder');
  const refuse = { on: true };
  const { page, errors, at } = await player(t, { refuse });
  await page.evaluate((url) => window.p.load({ url, autoplay: true }), host.url('surround.mkv'));
  await at(2);
  const quiet = await page.evaluate(async () => ({ hz: await window.pitch(800), notices: window.seen.notices, errors: window.seen.errors }));
  refuse.on = false; // the next try (every second here, every 15 s in use) downloads it
  const from = await page.evaluate(() => { window.seen.frames.length = 0; return window.p.video.currentTime; });
  await at(from + 5);
  const r = await page.evaluate(async () => {
    const f = window.seen.frames; let pause = 0; for (let i = 1; i < f.length; i++) pause = Math.max(pause, f[i] - f[i - 1]);
    return { hz: await window.pitch(), pause: Math.round(pause), errors: window.seen.errors };
  });
  t.diagnostic(JSON.stringify({ quiet, r }));
  assert.deepEqual(quiet.errors, [], 'no stop');
  assert.equal(quiet.hz, 0, 'silence meanwhile');
  assert.ok(quiet.notices.some((n) => /without sound until it can be/.test(n)), quiet.notices.join(' | '));
  assert.equal(r.hz, 660, 'the Dolby Digital track, converted, once its converter came');
  assert.ok(r.pause < 400, `the picture kept going as the sound came in (longest pause ${r.pause} ms)`);
  assert.deepEqual([errors, r.errors], [[], []]);
});

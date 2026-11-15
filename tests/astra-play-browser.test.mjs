// Astra's engine playing real (small, synthetic) films in a real browser, from a file host on
// another origin (tests/fixtures/astra-host.mjs): each way of playing starts and runs, seeks land,
// the sound track changes, a film closed early lets go of its connections, and a host that is gone,
// silent or cutting connections is met with words or a retry, never a spinner for good.
// The films are made by scripts/astra/fixtures.sh. Local only: nothing here reaches the internet.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { astraHost } from './fixtures/astra-host.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (synthetic films)' };
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

/** A page of the real site (its CSP and all) holding one engine player on a muted video: `window.p`. */
async function player(t) {
  host.reset();
  const page = await browser.newPage({ viewport: { width: 844, height: 390 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  t.after(() => page.close());
  await page.goto(`${base}/astra/lab/`);
  await page.evaluate(async () => {
    const { AstraPlayer } = await import('/astra/src/engine/player.js');
    const video = Object.assign(document.createElement('video'), { muted: true, playsInline: true });
    const layer = document.createElement('div');
    document.body.append(video, layer);
    const p = (window.p = new AstraPlayer(video, layer));
    window.seen = { errors: [], ready: 0, network: [] };
    p.addEventListener('error', (e) => window.seen.errors.push(e.detail.message));
    p.addEventListener('ready', () => window.seen.ready++);
    p.addEventListener('network', (e) => window.seen.network.push(e.detail));
  });
  const load = (url, o = {}) => page.evaluate(([url, o]) => { window.p.load({ url, autoplay: true, ...o }); }, [url, o]);
  /** Waits until the picture has moved on by `by` seconds from where it is now (so: it is really playing). */
  const runs = async (by = 1, timeout = 20_000) => page.waitForFunction(([from, by]) => { const v = window.p.video; return v.videoWidth > 0 && v.currentTime >= from + by; }, [await page.evaluate(() => window.p.video.currentTime), by], { timeout });
  const seek = async (to) => { await page.evaluate((to) => { window.p.video.currentTime = to; }, to); await runs(0.7); };
  const state = () => page.evaluate(() => ({ mode: window.p.mode, t: window.p.video.currentTime, audio: window.p.audioOptions(), subs: window.p.subtitleOptions(), ...window.seen }));
  return { page, errors, load, runs, seek, state };
}
const idle = async (ms = 4000) => { const until = Date.now() + ms; while (host.stats.open && Date.now() < until) await new Promise((r) => setTimeout(r, 100)); return host.stats.open; };

test('a film unpacked on the device: plays, lists its tracks, changes sound, and every seek lands', opts, async (t) => {
  if (!h264) return t.skip('this browser has no H.264 decoder');
  const p = await player(t);
  await p.load(host.url('multi.mkv'));
  await p.runs(1.5);
  let s = await p.state();
  assert.equal(s.mode, 'remux');
  assert.deepEqual(s.audio.map((a) => [a.language, a.supported]), [['eng', true], ['jpn', true]]);
  assert.equal(s.subs.filter((x) => x.kind === 'embedded').length, 1, 'the SRT track inside the film is listed');
  await p.page.evaluate(() => window.p.selectAudio(window.p.audioOptions()[1].id));
  await p.runs(1);
  // Far ahead, back to the start, then into what was buffered before the seek back: each shows a picture.
  await p.seek(45); await p.seek(3); await p.seek(46);
  s = await p.state();
  assert.ok(s.t >= 46 && s.t < 52, `playing on from the last seek (at ${s.t})`);
  assert.deepEqual(s.errors, []);
  assert.deepEqual(p.errors, []);
});

test('Dolby Digital is rebuilt as it plays; a plain MP4 and a WebM play as they are', opts, async (t) => {
  const p = await player(t);
  if (h264) {
    await p.load(host.url('surround.mkv'));
    await p.runs(1.5);
    let s = await p.state();
    assert.equal(s.mode, 'remux');
    assert.equal(s.audio[0].delivery, 'rebuilt');
    await p.load(host.url('plain.mp4'));
    await p.runs(1.5);
    s = await p.state();
    assert.equal(s.mode, 'native');
    assert.ok(s.t < 10, 'the second film started from its own beginning');
  }
  await p.load(host.url('open.webm'));
  await p.runs(1.5);
  const s = await p.state();
  assert.deepEqual(s.errors, []);
  assert.deepEqual(p.errors, []);
});

test('a film started at a place starts there', opts, async (t) => {
  if (!h264) return t.skip('this browser has no H.264 decoder');
  const p = await player(t);
  await p.load(host.url('multi.mkv'), { startTime: 30 });
  await p.runs(1);
  const s = await p.state();
  assert.ok(s.t >= 30 && s.t < 36, `resumed near 30 s (at ${s.t})`);
});

test('a film replaced or closed early lets go of the host', opts, async (t) => {
  if (!h264) return t.skip('this browser has no H.264 decoder');
  const p = await player(t);
  host.control.bps = 200_000; // slow enough that the first film is still being read when it is replaced
  await p.load(host.url('multi.mkv'));
  await new Promise((r) => setTimeout(r, 300));
  await p.load(host.url('surround.mkv'));
  await new Promise((r) => setTimeout(r, 300));
  await p.page.evaluate(() => window.p.destroy());
  assert.equal(await idle(), 0, 'no connection is left open after the player is destroyed');
  const before = host.stats.bytes;
  await new Promise((r) => setTimeout(r, 1200));
  assert.equal(host.stats.bytes, before, 'and nothing more is downloaded');
});

test('a host that is gone says so; one that cuts connections is read through its cuts', opts, async (t) => {
  if (!h264) return t.skip('this browser has no H.264 decoder');
  const p = await player(t);
  host.control.status = 404;
  await p.load(host.url('multi.mkv'));
  await p.page.waitForFunction(() => window.seen.errors.length > 0, null, { timeout: 15_000 });
  assert.match((await p.state()).errors[0], /link|gone|no longer|not found|404/i);
  host.reset();
  host.control.cutAfter = 150_000; // every connection dies after 150 kB: the film is about 940 kB
  await p.load(host.url('multi.mkv'));
  await p.runs(1.5);
  await p.seek(50);
  assert.deepEqual((await p.state()).errors.slice(1), [], 'no new error while reading through the cuts');
});

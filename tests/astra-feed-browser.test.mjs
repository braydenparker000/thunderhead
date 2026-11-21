// What the engine feeds the player's newer pieces, in a real browser on the real site page (its CSP and all),
// with films from a file host on another origin (tests/fixtures/astra-host.mjs): a film's styled (ASS) track drawn
// by libass with the film's attached font; a second subtitle track in its own layer; the sound tap Skip intro
// listens through; dialogue lift and sound earlier than the picture where the engine mixes the sound.
// The films are made by scripts/astra/fixtures.sh. Local only: nothing here reaches the internet.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { astraHost } from './fixtures/astra-host.mjs';
import { timing, until } from './fixtures/waits.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (synthetic films)', timeout: 60_000 };
let site, host, browser, base, h264 = false, episodes = null, episodeDir = null;

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
after(async () => { await browser?.close(); site?.close(); await host?.close(); await episodes?.close(); if (episodeDir) rmSync(episodeDir, { recursive: true, force: true }); });

/** The Astra page with one engine player over a muted video filling the window, a subtitle layer and a second one: `window.p`. */
async function player(t) {
  host.reset();
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  t.after(() => page.close());
  await page.goto(`${base}/astra/lab/`);
  await page.evaluate(async () => {
    const { AstraPlayer } = await import('/astra/src/engine/player.js');
    const box = document.createElement('div');
    Object.assign(box.style, { position: 'fixed', inset: '0', zIndex: '9999', background: '#000' });
    const video = Object.assign(document.createElement('video'), { muted: true, playsInline: true });
    Object.assign(video.style, { position: 'absolute', inset: '0', width: '100%', height: '100%' });
    const layer = document.createElement('div'), second = document.createElement('div');
    for (const el of [layer, second]) Object.assign(el.style, { position: 'absolute', inset: '0' });
    box.append(video, second, layer);
    document.body.append(box);
    const p = (window.p = new AstraPlayer(video, layer));
    p.setSecondLayer(second);
    window.layers = { layer, second };
    window.seen = { errors: [], ready: 0, tracks: 0 };
    p.addEventListener('error', (e) => window.seen.errors.push(e.detail.message));
    p.addEventListener('ready', () => window.seen.ready++);
    p.addEventListener('tracks', () => window.seen.tracks++);
  });
  const load = async (url, o = {}) => {
    await page.evaluate(([url, o]) => { window.p.load({ url, ...o }); }, [url, o]);
    await page.waitForFunction(() => window.seen.ready > 0 || window.seen.errors.length, null, { timeout: 20_000 });
    assert.deepEqual(await page.evaluate(() => window.seen.errors), []);
  };
  /** Pauses at `at` s once the picture is there, then waits `ms` for subtitles to settle. */
  const at = (at, ms = 400) => page.evaluate(async ([at, ms]) => {
    const v = window.p.video;
    v.pause();
    if (Math.abs(v.currentTime - at) > 0.01) { v.currentTime = at; await new Promise((r) => v.addEventListener('seeked', r, { once: true })); }
    const until = performance.now() + 10_000;
    while (v.readyState < 2 && performance.now() < until) await new Promise((r) => setTimeout(r, 50));
    await new Promise((r) => setTimeout(r, ms));
  }, [at, ms]);
  return { page, errors, load, at };
}

/** Lit pixels of the libass canvas in the subtitle layer, all and inside a box [x0, y0, x1, y1] (fractions); null with no canvas. */
const libassPixels = (page, box = [0, 0, 1, 1]) => page.evaluate((box) => {
  const canvas = window.layers.layer.querySelector('canvas.astra-sub-libass');
  if (!canvas || !canvas.clientWidth) return null;
  const W = canvas.clientWidth, H = canvas.clientHeight, out = new OffscreenCanvas(W, H), g = out.getContext('2d');
  g.drawImage(canvas, 0, 0, W, H);
  const d = g.getImageData(0, 0, W, H).data;
  let all = 0, inside = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3] > 0) {
    all++;
    if (x >= box[0] * W && x < box[2] * W && y >= box[1] * H && y < box[3] * H) inside++;
  }
  return { all, inside };
}, box);

test('a film\'s styled track is drawn by libass with the film\'s own font, follows seeks, and stops when turned off', opts, async (t) => {
  if (!h264) return t.skip('this browser has no H.264 decoder');
  const p = await player(t);
  await p.load(host.url('anime.mkv'));
  assert.equal(await p.page.evaluate(() => window.p.mode), 'remux');
  const id = await p.page.evaluate(() => window.p.subtitleOptions().find((s) => s.label.includes('Signs'))?.id);
  assert.ok(id, 'the Signs track is listed');
  await p.page.evaluate((id) => window.p.selectSubtitle(id), id);
  // The renderer's libass layer starts (JASSUB downloads, the fonts are read from the film).
  await p.page.waitForFunction(() => window.p.subtitles.libassDraws, null, { timeout: 30_000 });
  const fonts = await p.page.evaluate(async () => (await window.p.filmFonts()).map((f) => ({ name: f.name, type: f.type, bytes: f.data.byteLength })));
  assert.equal(fonts.length, 1, 'one font attached');
  assert.equal(fonts[0].name, 'Inter-Bold.woff2');
  assert.ok(fonts[0].bytes > 10_000, `the whole font was read (${fonts[0].bytes} bytes)`);
  // At 3 s the sign NORTH GATE sits at \pos(480,90) of 640×360; nothing in the empty top left.
  await p.at(3, 700);
  const sign = await libassPixels(p.page, [0.6, 0.1, 0.9, 0.4]);
  assert.ok(sign && sign.inside > 200, `the sign is drawn where the script puts it (${JSON.stringify(sign)})`);
  assert.equal((await libassPixels(p.page, [0, 0, 0.4, 0.5])).inside, 0, 'nothing in the empty top left');
  // A seek to the pink line (15-18 s, top left): its block was read with the clusters there, and it shows.
  await p.at(16, 900);
  const pink = await libassPixels(p.page, [0, 0, 0.5, 0.3]);
  assert.ok(pink.inside > 100, `the line after the seek shows (${JSON.stringify(pink)})`);
  // Astra's own renderer draws no text while libass does.
  assert.equal(await p.page.evaluate(() => window.layers.layer.querySelectorAll('.astra-sub').length), 0);
  // Off: libass ends, nothing drawn.
  await p.page.evaluate(() => window.p.selectSubtitle(null));
  await p.at(3, 400);
  assert.equal(await p.page.evaluate(() => window.layers.layer.querySelectorAll('canvas').length), 0, 'no canvas once off');
  assert.equal(await p.page.evaluate(() => window.layers.layer.querySelectorAll('.astra-sub').length), 0, 'and no text');
  assert.deepEqual(p.errors, []);
});

test('the font read through the film changes how the sign is drawn (compared with libass\'s fallback font)', opts, async (t) => {
  if (!h264) return t.skip('this browser has no H.264 decoder');
  const p = await player(t);
  await p.load(host.url('anime.mkv'));
  const id = await p.page.evaluate(() => window.p.subtitleOptions().find((s) => s.label.includes('Signs')).id);
  const mask = async () => {
    await p.page.waitForFunction(() => window.p.subtitles.libassDraws, null, { timeout: 30_000 });
    await p.at(3, 700);
    return p.page.evaluate(() => {
      const canvas = window.layers.layer.querySelector('canvas.astra-sub-libass');
      const W = canvas.clientWidth, H = canvas.clientHeight, g = new OffscreenCanvas(W, H).getContext('2d');
      g.drawImage(canvas, 0, 0, W, H);
      const d = g.getImageData(Math.floor(0.6 * W), Math.floor(0.1 * H), Math.floor(0.3 * W), Math.floor(0.3 * H)).data;
      let s = ''; for (let i = 3; i < d.length; i += 4) s += d[i] > 0 ? 1 : 0;
      return s;
    });
  };
  await p.page.evaluate((id) => window.p.selectSubtitle(id), id);
  const own = await mask();
  // The same track without the film's fonts: libass falls back to Liberation Sans.
  await p.page.evaluate((id) => { window.p.fontsRead = Promise.resolve([]); window.p.selectSubtitle(null); window.p.selectSubtitle(id); }, id);
  const fallback = await mask();
  let differ = 0, lit = 0;
  for (let i = 0; i < own.length; i++) { differ += own[i] !== fallback[i]; lit += own[i] === '1'; }
  assert.ok(lit > 200 && differ > 0.2 * lit, `the attached font is used (${differ} of ${lit} pixels differ)`);
  assert.deepEqual(p.errors, []);
});

test('an .ass file from beside the film is drawn by libass too', opts, async (t) => {
  if (!h264) return t.skip('this browser has no H.264 decoder');
  const p = await player(t);
  await p.load(host.url('plain.mp4'));
  const id = await p.page.evaluate((url) => window.p.addSubtitleTrack({ url, label: 'Signs file', format: 'signs.ass' }), host.url('signs.ass'));
  await p.page.evaluate((id) => window.p.selectSubtitle(id), id);
  await p.page.waitForFunction(() => window.p.subtitles.libassDraws, null, { timeout: 30_000 });
  await p.at(3, 700);
  const sign = await libassPixels(p.page, [0.6, 0.1, 0.9, 0.4]);
  assert.ok(sign.inside > 200, `the sign is drawn (${JSON.stringify(sign)})`);
  assert.deepEqual(p.errors, []);
});

test('a second subtitle track shows in its own layer, smaller and at the top, beside the first', opts, async (t) => {
  if (!h264) return t.skip('this browser has no H.264 decoder');
  const p = await player(t);
  await p.load(host.url('multi.mkv'));
  const ids = await p.page.evaluate((url) => {
    const p = window.p, first = p.subtitleOptions().find((s) => s.kind === 'embedded').id;
    const second = p.addSubtitleTrack({ url, label: 'Beside', format: 'beside.srt' });
    p.selectSubtitle(first);
    return { first, second };
  }, host.url('beside.srt'));
  // The same track as both is refused; picture or unknown ids too.
  assert.equal(await p.page.evaluate((id) => window.p.selectSecondSubtitle(id), ids.first), false);
  assert.equal(await p.page.evaluate(() => window.p.selectSecondSubtitle('mkv:99')), false);
  const tracks = await p.page.evaluate(() => window.seen.tracks);
  assert.equal(await p.page.evaluate((id) => window.p.selectSecondSubtitle(id), ids.second), true);
  assert.equal(await p.page.evaluate(() => window.p.secondSubtitle), ids.second);
  assert.ok(await p.page.evaluate(() => window.seen.tracks) > tracks, '\'tracks\' fired');
  await p.page.waitForFunction(() => window.p.cues.get(window.p.secondSubtitle)?.length > 0, null, { timeout: 10_000 }); // downloaded when chosen
  await p.at(2, 300);
  const shown = await p.page.evaluate(() => {
    const read = (el) => [...el.querySelectorAll('.astra-sub')].map((n) => ({ text: n.textContent, zone: n.parentElement.className, size: parseFloat(getComputedStyle(n.parentElement.parentElement).getPropertyValue('--sub-size')) }));
    return { first: read(window.layers.layer), second: read(window.layers.second) };
  });
  assert.equal(shown.first.length, 1); assert.equal(shown.second.length, 1);
  assert.match(shown.first[0].text, /First line inside the film/);
  assert.match(shown.second[0].text, /A line from a file beside the film/);
  assert.match(shown.first[0].zone, /bottom/); assert.match(shown.second[0].zone, /top/);
  assert.ok(Math.abs(shown.second[0].size / shown.first[0].size - 0.7) < 0.05, `the second is about 70 % of the first (${shown.second[0].size} / ${shown.first[0].size})`);
  // It follows the first's delay: 3 s later, at 2 s neither shows.
  await p.page.evaluate(() => window.p.subtitles.setDelay(3));
  await p.at(2.1, 300);
  assert.equal(await p.page.evaluate(() => window.layers.second.querySelectorAll('.astra-sub').length), 0, 'the delay reaches the second');
  await p.page.evaluate(() => window.p.subtitles.setDelay(0));
  // Choosing the second's track as the first takes it from the second.
  await p.page.evaluate((id) => window.p.selectSubtitle(id), ids.second);
  assert.equal(await p.page.evaluate(() => window.p.secondSubtitle), null);
  // A new load lets it go.
  await p.page.evaluate((id) => { window.p.selectSubtitle(null); window.p.selectSecondSubtitle(id); }, ids.second);
  await p.page.evaluate(() => window.p.reset());
  assert.deepEqual(await p.page.evaluate(() => ({ id: window.p.secondSubtitle, held: !!window.p.second, nodes: window.layers.second.children.length })), { id: null, held: false, nodes: 0 });
  assert.deepEqual(p.errors, []);
});

/** Sets a recording sound tap on the engine: window.tapped holds what it was fed; window.wanted switches it. */
const recordTap = (page) => page.evaluate(() => {
  window.tapped = []; window.wanted = true;
  window.p.setSoundTap({
    wants: () => window.wanted,
    feed: (channels, rate, t) => {
      let finite = true, peak = 0;
      for (const c of channels) for (const v of c) { if (!Number.isFinite(v)) finite = false; else peak = Math.max(peak, Math.abs(v)); }
      window.tapped.push({ n: channels.length, len: channels[0].length, rate, t, finite, peak, wanted: window.wanted });
    },
  });
});
const playsOn = (page, by = 1.5) => page.evaluate(async (by) => {
  const v = window.p.video, from = v.currentTime;
  await v.play();
  const until = performance.now() + 15_000;
  while (v.currentTime < from + by && performance.now() < until) await new Promise((r) => setTimeout(r, 100));
  return v.currentTime - from;
}, by);

for (const [film, delivery, channels] of [['multi.mkv', 'direct', 2], ['surround.mkv', 'rebuilt', 6]]) {
  test(`the sound tap is fed decoded sound of a ${delivery} track (${film}) as it is read, and nothing while it is not wanted`, opts, async (t) => {
    if (!h264) return t.skip('this browser has no H.264 decoder');
    const p = await player(t);
    await recordTap(p.page);
    await p.load(host.url(film), { startTime: 6 });
    assert.equal(await p.page.evaluate(() => window.p.mode), 'remux');
    assert.equal(await p.page.evaluate(() => window.p.audioOptions().find((a) => a.selected).delivery), delivery);
    assert.ok(await playsOn(p.page) >= 1.5, 'it plays');
    await p.page.waitForFunction(() => window.tapped.length > 20, null, { timeout: 10_000 });
    const fed = await p.page.evaluate(() => window.tapped);
    assert.ok(fed.every((f) => f.finite && f.rate === 48000 && f.n === fed[0].n && f.len > 0), 'finite samples at 48 kHz');
    assert.equal(fed[0].n, channels, `before the mix to stereo: ${channels} channels`);
    assert.ok(fed.some((f) => f.peak > 0.05), 'the tone, not silence');
    const times = fed.map((f) => f.t);
    assert.ok(Math.abs(times[0] - 6) < 1.2, `starts near where the load started (${times[0]})`);
    let ahead = 0; for (let i = 1; i < times.length; i++) if (times[i] > times[i - 1]) ahead++;
    assert.ok(ahead >= times.length - 2, 'times advance with the reading');
    const read = await p.page.evaluate(() => window.p.session.readAt.audio);
    assert.ok(Math.max(...times) <= read + 0.2 && Math.max(...times) > 8, `fed up to where the sound is read (${Math.max(...times)} of ${read})`);
    // Not wanted: a seek elsewhere reads sound but feeds none.
    await p.page.evaluate(() => { window.wanted = false; window.tapped.length = 0; window.p.video.currentTime = 14; });
    assert.ok(await playsOn(p.page, 1) >= 1, 'it plays after the seek');
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(await p.page.evaluate(() => window.tapped.length), 0, 'nothing fed while not wanted');
    // Wanted again: the new place is fed, on the film's clock.
    await p.page.evaluate(() => { window.wanted = true; window.p.video.currentTime = 3; });
    await p.page.waitForFunction(() => window.tapped.length > 5, null, { timeout: 10_000 });
    const again = await p.page.evaluate(() => window.tapped[0].t);
    assert.ok(Math.abs(again - 3) < 1.5, `after a seek back, fed from there (${again})`);
    assert.deepEqual(p.errors, []);
  });
}

test('a sound tap that throws ends the tapping for that film, never the film', opts, async (t) => {
  if (!h264) return t.skip('this browser has no H.264 decoder');
  const p = await player(t);
  await p.page.evaluate(() => { window.calls = 0; window.p.setSoundTap({ wants: () => true, feed: () => { window.calls++; throw Error('listener broke'); } }); });
  await p.load(host.url('multi.mkv'));
  assert.ok(await playsOn(p.page, 2) >= 2, 'it plays on');
  assert.equal(await p.page.evaluate(() => window.calls), 1, 'fed once, then no more');
  assert.ok(await p.page.evaluate(() => window.p.log.some((l) => l.kind === 'tap' && /ended/.test(l.detail))), 'a line in the log');
  assert.deepEqual(p.errors, []);
});

// Two "episodes" of 3 minutes with the same 40 s of synthesized music after different openings (at 20 s in the
// first, 45 s in the second), the rest pink noise of different seeds. Made here (4 s each with ffmpeg) rather than
// committed: about 0.9 MB each.
const MUSIC = '0.4*sin(2*PI*t*(220*pow(2,mod(floor(t*4)*7,12)/12)))+0.3*sin(2*PI*t*(330*pow(2,mod(floor(t*3)*5,12)/12)))+0.2*sin(2*PI*t*(110*pow(2,mod(floor(t*2)*3,7)/12)))';
const OPENINGS = { a: ['0.5*sin(2*PI*t*(400+300*mod(floor(t*5)*3,8)/8))', 20, 1], b: ['0.5*sin(2*PI*t*(250+500*mod(floor(t*6)*5,9)/9))*sin(2*PI*t*0.7)', 45, 2] };
function makeEpisodes() {
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { return false; }
  episodeDir = mkdtempSync(join(tmpdir(), 'astra-episodes-'));
  for (const [name, [opening, at, seed]] of Object.entries(OPENINGS)) {
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `aevalsrc=exprs='${opening}':s=48000:d=${at}`, '-f', 'lavfi', '-i', `aevalsrc=exprs='${MUSIC}':s=48000:d=40`,
      '-f', 'lavfi', '-i', `anoisesrc=color=pink:seed=${seed}:amplitude=0.3:r=48000:d=${140 - at}`, '-f', 'lavfi', '-i', 'testsrc2=size=64x36:rate=4:duration=180',
      '-filter_complex', '[0][1][2]concat=n=3:v=0:a=1[a]', '-map', '3:v', '-map', '[a]', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-b:v', '8k', '-g', '40',
      '-c:a', 'aac', '-b:a', '32k', '-ac', '1', join(episodeDir, `${name}.mkv`)]);
  }
  return true;
}

test('Skip intro end to end: the engine\'s tap feeds the real IntroFinder through skip.js; the second episode\'s intro is found within 2 s', { ...opts, timeout: 120_000 }, async (t) => {
  if (!h264) return t.skip('this browser has no H.264 decoder');
  if (!makeEpisodes()) return t.skip('ffmpeg is not installed, so the two episodes cannot be made');
  episodes = await astraHost({ root: episodeDir + '/' });
  const p = await player(t);
  await p.page.evaluate(async () => {
    const { SkipTimes } = await import('/astra/src/app/skip.js');
    // skip.js's player: the engine and its video, open, showing what it is given.
    const screen = { engine: window.p, video: window.p.video, isOpen: true, setSegments: (list) => { window.segments = list; } };
    window.skip = new SkipTimes(screen, { settings: () => ({}) });
    window.store = (await window.skip.parts()).store;
  });
  const series = { type: 'series', id: 'feed-test' };
  /** One episode: told to skip.js, loaded and played at 16 times the speed until `until` s of its sound were heard by the finder. */
  const watch = async (video, until) => {
    await p.page.evaluate(([series, video]) => { window.seen.ready = 0; window.skip.episode({ series, video }); }, [series, video]);
    await p.load(episodes.url(`${video}.mkv`));
    await p.page.evaluate(() => { window.p.video.playbackRate = 16; return window.p.video.play(); });
    await p.page.waitForFunction((until) => (window.skip.ep?.finder?.fed || 0) >= until, until, { timeout: 60_000 }).catch(async (e) => {
      t.diagnostic(JSON.stringify(await p.page.evaluate(() => ({ fed: window.skip.ep?.finder?.fed, hasFinder: !!window.skip.ep?.finder, ep: !!window.skip.ep, tap: window.p.tapFeed?.stats, dead: window.p.tapFeed?.dead, sessTap: !!window.p.session?.tap, read: window.p.session?.readAt, mode: window.p.mode, dur: window.p.video.duration, log: window.p.log.filter((l) => l.kind === 'tap') }))));
      throw e;
    });
  };
  await watch('a', 88);
  await p.page.evaluate(() => window.skip.stop()); // the first episode is left: its fingerprint is kept
  await p.page.waitForFunction((series) => window.store.candidates(series, 'b').then((c) => c.length > 0), series, { timeout: 10_000, polling: 200 });
  await watch('b', 30);
  await p.page.waitForFunction(() => window.segments?.some((s) => s.type === 'intro'), null, { timeout: 60_000 });
  const intro = await p.page.evaluate(() => window.segments.find((s) => s.type === 'intro'));
  t.diagnostic(`intro found at ${intro.start.toFixed(2)}–${intro.end.toFixed(2)} s (truth 45–85 s)`);
  assert.ok(Math.abs(intro.start - 45) <= 2 && Math.abs(intro.end - 85) <= 2, `the intro is within 2 s of the truth (${intro.start}–${intro.end})`);
  assert.deepEqual(p.errors, []);
});

/** The loudness (RMS) of what the video element plays, over `ms`, through an AnalyserNode. */
const loudness = (page, ms = 600) => page.evaluate(async (ms) => {
  const v = window.p.video;
  if (!window.ear) {
    const ctx = new AudioContext(), a = ctx.createAnalyser();
    a.fftSize = 2048; ctx.createMediaElementSource(v).connect(a); a.connect(ctx.destination);
    window.ear = { ctx, a }; await ctx.resume();
  }
  v.muted = false; v.volume = 1;
  const { a } = window.ear, buf = new Float32Array(a.fftSize);
  let sum = 0, n = 0;
  for (const until = performance.now() + ms; performance.now() < until;) {
    await new Promise((r) => setTimeout(r, 50));
    a.getFloatTimeDomainData(buf);
    for (const x of buf) { sum += x * x; n++; }
  }
  return Math.sqrt(sum / n);
}, ms);

test('dialogue lift on rebuilt 5.1 sound: the engine\'s mix raises the centre, heard within about a second', opts, async (t) => {
  if (!h264) return t.skip('this browser has no H.264 decoder');
  const p = await player(t);
  await p.load(host.url('surround.mkv'));
  assert.ok(await playsOn(p.page, 1) >= 1);
  const before = await loudness(p.page);
  // Listened to (a fresh window each time) until the change is heard, not after a guessed wait; how soon is a timing read.
  const heardAs = async (ok) => { let db = NaN; const t0 = Date.now(); await until(async () => ok((db = 20 * Math.log10((await loudness(p.page)) / before))), { timeout: 10_000 }).catch(() => {}); return { db, ms: Date.now() - t0 }; };
  await p.page.evaluate(() => window.p.setDialogue(2));
  // surround.mkv's tone is in the centre channel alone (ffmpeg put the mono tone there): step 2 raises it by 8 dB.
  const up = await heardAs((db) => db > 7 && db < 9);
  t.diagnostic(`${up.db.toFixed(1)} dB louder with the centre raised`);
  assert.ok(up.db > 7 && up.db < 9, `the centre is raised by about 8 dB (${up.db.toFixed(1)} dB)`);
  timing(up.ms < 2500, `the raised centre was heard after ${up.ms} ms`);
  await p.page.evaluate(() => window.p.setDialogue(0));
  const back = await heardAs((db) => Math.abs(db) < 1);
  assert.ok(Math.abs(back.db) < 1, `and back (${back.db.toFixed(1)} dB)`);
  assert.ok(await playsOn(p.page, 1) >= 1, 'it plays on');
  assert.deepEqual(p.errors, []);
});

test('sound earlier than the picture: the audio buffer is placed that much earlier against the video', opts, async (t) => {
  if (!h264) return t.skip('this browser has no H.264 decoder');
  const p = await player(t);
  await p.load(host.url('multi.mkv'));
  assert.ok(await playsOn(p.page, 1) >= 1);
  /** After a seek back to `to` (fresh pipelines read from there): audio's buffered start less video's, around `to`. */
  const lead = async (to) => {
    await p.page.evaluate((to) => { window.p.video.currentTime = to; }, to);
    assert.ok(await playsOn(p.page, 0.8) >= 0.8, 'it plays after the seek');
    return p.page.evaluate((to) => {
      const q = window.p.session.queues, start = (b) => { for (let i = 0; i < b.buffered.length; i++) if (b.buffered.end(i) > to + 0.5) return b.buffered.start(i); return NaN; };
      return start(q.audio.buffer) - start(q.video.buffer);
    }, to);
  };
  await p.page.evaluate(() => { window.p.video.currentTime = 50; });
  assert.ok(await playsOn(p.page, 0.5) >= 0.5);
  const plain = await lead(15); // a seek back: the pipelines start again there
  await p.page.evaluate(() => window.p.setAudioAdvance(0.5));
  await new Promise((r) => setTimeout(r, 500));
  assert.ok(await playsOn(p.page, 0.5) >= 0.5, 'it plays on after the change');
  const early = await lead(7);
  await p.page.evaluate(() => window.p.setAudioAdvance(0));
  await new Promise((r) => setTimeout(r, 500));
  const plainAgain = await lead(3);
  t.diagnostic(`audio starts ${plain.toFixed(3)} s, ${early.toFixed(3)} s with 0.5 s advance, ${plainAgain.toFixed(3)} s back at 0, from the video`);
  // Key frames every 2 s: the video starts at the one before the seek, the sound at the seek (less 0.5 s ahead).
  assert.ok(Math.abs(plain - early - 0.5) < 0.1, 'about 0.5 s earlier');
  assert.ok(Math.abs(plainAgain - plain) < 0.1, 'and back where it was at 0');
  assert.deepEqual(p.errors, []);
});

test('software decoder: the sound chain goes into libmedia\'s own sound path; boost 2 is 6 dB louder after it; closed, the film is still heard', opts, async (t) => {
  const p = await player(t);
  await p.load(host.url('hevc.mkv'));
  if (await p.page.evaluate(() => window.p.mode) !== 'software') return t.skip('this browser decodes HEVC itself, so the software decoder is not used');
  const r = await p.page.evaluate(async () => {
    const { SoundChain } = await import('/astra/src/enhance/sound-chain.js');
    const p = window.p, v = p.video;
    v.muted = false; await v.play();
    const until = performance.now() + 10_000;
    while (!p.session.engine?.gainNode && performance.now() < until) await new Promise((r) => setTimeout(r, 100));
    let chain = null;
    const ok = p.routeSoftwareSound((ctx) => (chain = new SoundChain(ctx)));
    const ctx = p.session.AVPlayer.audioContext;
    const meter = (node) => { const a = ctx.createAnalyser(); a.fftSize = 2048; node.connect(a); return a; };
    const after = meter(chain.out), heard = meter(p.session.engine.gainNode); // after the chain; what goes into the stream
    const db = async (a, ms = 800) => {
      const b = new Float32Array(a.fftSize); let s = 0, n = 0;
      for (const end = performance.now() + ms; performance.now() < end;) { await new Promise((r) => setTimeout(r, 50)); a.getFloatTimeDomainData(b); for (const x of b) { s += x * x; n++; } }
      return 20 * Math.log10(Math.sqrt(s / n) || 1e-9);
    };
    const plain = await db(after);
    chain.apply({ boost: 2 }, 2); await new Promise((r) => setTimeout(r, 300));
    const boosted = await db(after);
    chain.close(); await new Promise((r) => setTimeout(r, 300));
    return { ok, plain, boosted, closed: await db(heard), track: v.srcObject.getAudioTracks().length, t: v.currentTime };
  });
  t.diagnostic(`${r.plain.toFixed(1)} dB, ${r.boosted.toFixed(1)} dB with boost 2, ${r.closed.toFixed(1)} dB once closed`);
  assert.equal(r.ok, true);
  assert.ok(Math.abs(r.boosted - r.plain - 6) < 1, 'boost 2 is about 6 dB');
  assert.ok(r.closed > -40 && Math.abs(r.closed - r.plain) < 1.5, 'closed, the sound goes on as before');
  assert.equal(r.track, 1, 'the stream keeps one sound track');
  assert.ok(await p.page.evaluate(() => window.p.log.some((l) => l.kind === 'sound' && /is in/.test(l.detail))));
  assert.deepEqual(p.errors, []);
});

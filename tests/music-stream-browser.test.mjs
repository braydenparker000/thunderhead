// Music's streaming path in Chromium (frontend/th/music/stream/feed.js; MUSIC.md §5, NEXT-BATCH.md
// part 2): Ogg Opus files fetched in Range requests from a local server, repackaged as WebM and
// played through Media Source Extensions in one audio element. The fixture twice in a row joins at
// the first copy's true end with no silence (on the timeline, in `buffered`, and in the sound itself,
// recorded through an AudioWorklet: a 440 Hz sine whose phase must run on across the join); buffered
// ahead stays under 15.5 s while fetching stops at the cap and starts again under 10 s; seek bisects
// to its page and skip starts the next song; corrupt or missing files raise `fallback`. Then the lab
// page plays the same queue under its own CSP. Local only; no network; synthetic audio.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { CONTENT_TYPES, configJs } from '../scripts/site-config.mjs';
import { TONE, longTone } from './fixtures/ogg-make.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (local files)' };
const SITE = fileURLToPath(new URL('../frontend/', import.meta.url));
const LONG = longTone(12); // 36 s
const BAD = TONE.slice();
BAD[5000] ^= 0x40; // a body byte of the fourth page: its CRC no longer matches
const MEDIA = { 'tone.opus': TONE, 'long.opus': LONG, 'bad.opus': BAD, 'page.opus': new TextEncoder().encode('<!doctype html><title>Not found</title>') };
const HARNESS = '<!doctype html><meta charset="utf-8"><title>stream test</title><audio id="a"></audio>';
const RECORDER = `class Rec extends AudioWorkletProcessor {
  constructor() { super(); this.buf = []; this.n = 0; }
  process(inputs) { const c = inputs[0][0]; if (c) { this.buf.push(c.slice()); this.n += c.length; if (this.n >= 4096) { this.port.postMessage(this.buf); this.buf = []; this.n = 0; } } return true; }
}
registerProcessor('rec', Rec);`;
/** Requests for media, in order: [file, first byte, last byte, ms]. */
let ranges = [];
let server, browser, base;

before(async () => {
  if (live) return;
  server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    if (path === '/t/') return res.writeHead(200, { 'content-type': 'text/html' }).end(HARNESS);
    if (path === '/t/rec.js') return res.writeHead(200, { 'content-type': 'text/javascript' }).end(RECORDER);
    if (path === '/config.js') return res.writeHead(200, { 'content-type': 'text/javascript' }).end(configJs({}));
    if (path.startsWith('/media/')) {
      const body = MEDIA[path.slice(7)];
      if (!body) return res.writeHead(404).end();
      const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '');
      if (!m) return res.writeHead(200, { 'content-type': 'audio/ogg', 'content-length': body.length }).end(body);
      const a = Number(m[1]);
      const b = m[2] ? Math.min(Number(m[2]), body.length - 1) : body.length - 1;
      ranges.push([path.slice(7), a, b, Date.now()]);
      if (a >= body.length) return res.writeHead(416, { 'content-range': `bytes */${body.length}` }).end();
      res.writeHead(206, { 'content-type': 'audio/ogg', 'accept-ranges': 'bytes', 'content-range': `bytes ${a}-${b}/${body.length}` });
      return res.end(body.subarray(a, b + 1));
    }
    let file = normalize(decodeURIComponent(path)).replace(/^[/\\]+/, '');
    if (file === '' || file.endsWith('/')) file += 'index.html';
    const body = file.startsWith('..') ? null : await readFile(join(SITE, file)).catch(() => null);
    if (!body) return res.writeHead(404).end();
    res.writeHead(200, { 'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: ['--autoplay-policy=no-user-gesture-required'],
  });
});
after(async () => {
  await browser?.close();
  server?.close();
});

/** A blank page with the feeder loaded as `window.feed` over its audio element, its events kept in `window.events`. */
async function harness() {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/t/`);
  await page.evaluate(async () => {
    const { StreamFeed } = await import('/th/music/stream/feed.js');
    const a = /** @type {HTMLAudioElement} */ (document.getElementById('a'));
    const w = /** @type {any} */ (window);
    w.feed = new StreamFeed(a);
    w.events = [];
    for (const type of ['trackstart', 'trackend', 'stall', 'error', 'fallback', 'ended'])
      w.feed.addEventListener(type, (e) => w.events.push({ type, ...e.detail, ct: a.currentTime, t: Date.now() }));
    // Buffered ahead of the play position and the start of what is kept, every 100 ms.
    w.samples = [];
    setInterval(() => {
      const b = a.buffered;
      let ahead = 0;
      for (let i = 0; i < b.length; i++) if (a.currentTime >= b.start(i) && a.currentTime < b.end(i)) ahead = b.end(i) - a.currentTime;
      w.samples.push({ t: Date.now(), ct: a.currentTime, ahead, start: b.length ? b.start(0) : 0 });
    }, 100);
  });
  return { page, errors };
}
const until = (page, fn, arg, timeout = 30_000) => page.waitForFunction(fn, arg, { timeout, polling: 50 });

test('the fixture twice: the second copy starts at the first’s true end, gapless in one element', opts, async (t) => {
  const { page, errors } = await harness();
  const r = await page.evaluate(async () => {
    const w = /** @type {any} */ (window);
    const a = /** @type {HTMLAudioElement} */ (document.getElementById('a'));
    const ctx = new AudioContext({ sampleRate: 48000 });
    await ctx.audioWorklet.addModule('/t/rec.js');
    const rec = new AudioWorkletNode(ctx, 'rec');
    const chunks = [];
    rec.port.onmessage = (e) => chunks.push(...e.data);
    ctx.createMediaElementSource(a).connect(rec);
    rec.connect(ctx.destination);
    w.feed.load([{ url: () => '/media/tone.opus' }, { url: () => '/media/tone.opus', bytes: 13722, durationMs: 3000 }]);
    await a.play();
    await new Promise((resolve) => { w.feed.addEventListener('ended', resolve); setTimeout(resolve, 20_000); });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const buffered = [];
    for (let i = 0; i < a.buffered.length; i++) buffered.push([a.buffered.start(i), a.buffered.end(i)]);
    // The recording: where the sound starts and stops, the longest silence inside it, and the 440 Hz
    // phase just before and after the join (one copy = 3 s = 1320 whole cycles, so it must run on).
    const x = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
    let o = 0;
    for (const c of chunks) x.set(c, (o += c.length) - c.length);
    let on = -1;
    let off = -1;
    for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) > 0.02) { if (on < 0) on = i; off = i; }
    let quiet = 0;
    let run = 0;
    for (let i = on; i <= off; i++) { run = Math.abs(x[i]) < 0.01 ? run + 1 : 0; quiet = Math.max(quiet, run); }
    const W = 1091; // 10 cycles
    const phase = (from) => {
      let s = 0;
      let c = 0;
      for (let i = 0; i < W; i++) { const p = (2 * Math.PI * 440 * i) / 48000; s += x[from + i] * Math.sin(p); c += x[from + i] * Math.cos(p); }
      return Math.atan2(c, s);
    };
    const join = on + 144000;
    const a0 = join - 3 * W;
    const a1 = join + 2 * W;
    const turn = phase(a1) - phase(a0) - (2 * Math.PI * 440 * (a1 - a0)) / 48000;
    const jump = (Math.atan2(Math.sin(turn), Math.cos(turn)) / (2 * Math.PI)) * (48000 / 440);
    return { events: w.events, buffered, sounding: off - on + 1, quiet, jump };
  });
  const starts = r.events.filter((e) => e.type === 'trackstart');
  const ends = r.events.filter((e) => e.type === 'trackend');
  assert.deepEqual(starts.map((e) => [e.index, e.at]), [[0, 0], [1, 3]]);
  assert.deepEqual(ends.map((e) => [e.index, e.at]), [[0, 3], [1, 6]], 'each copy ends at its true end: 144000 samples after its start');
  assert.equal(starts[1].at - ends[0].at, 0, 'on the timeline the second copy begins on the sample the first ends');
  assert.ok(starts[1].late <= 250, `the start event came ${starts[1].late} ms after the join`);
  assert.equal(r.events.at(-1).type, 'ended');
  assert.equal(r.buffered.length, 1, 'one buffered range: nothing missing at the join');
  assert.ok(Math.abs(r.buffered[0][0]) < 1e-3 && Math.abs(r.buffered[0][1] - 6) < 1e-3, `buffered ${JSON.stringify(r.buffered)}`);
  const gapMs = (r.sounding - 2 * 144000) / 48;
  t.diagnostic(`sound: ${r.sounding} samples for 288000 expected (gap ${gapMs.toFixed(2)} ms), longest silence ${r.quiet} samples, phase step at the join ${r.jump.toFixed(1)} samples, start event ${starts[1].late} ms late`);
  assert.ok(Math.abs(gapMs) <= 30, `the copies sound ${gapMs.toFixed(1)} ms apart from back to back`);
  assert.ok(r.quiet < 48, `no silence of 1 ms or more inside the sound (longest ${r.quiet} samples)`);
  assert.ok(Math.abs(r.jump) <= 12, `the tone runs on across the join (phase step ${r.jump.toFixed(1)} samples)`);
  assert.ok(!r.events.some((e) => e.type === 'stall' || e.type === 'fallback'));
  assert.deepEqual(errors, []);
  await page.close();
});

test('buffered ahead stays under 15.5 s: fetching stops at the cap, starts again under 10 s, and what is behind goes', opts, async (t) => {
  const { page, errors } = await harness();
  ranges = [];
  await page.evaluate(async (bytes) => {
    const w = /** @type {any} */ (window);
    const a = /** @type {HTMLAudioElement} */ (document.getElementById('a'));
    w.feed.load([{ url: () => '/media/long.opus', bytes, durationMs: 36_000 }]);
    a.playbackRate = 2;
    await a.play();
  }, LONG.length);
  await until(page, () => /** @type {any} */ (window).samples.at(-1)?.ct >= 31, null, 40_000);
  const samples = await page.evaluate(() => /** @type {any} */ (window).samples);
  const reqs = ranges.filter((r) => r[0] === 'long.opus');
  const most = Math.max(...samples.map((s) => s.ahead));
  t.diagnostic(`most buffered ahead ${most.toFixed(2)} s over ${samples.length} samples; ${reqs.length} requests`);
  assert.ok(most <= 15.5, `buffered ahead reached ${most.toFixed(2)} s`);
  assert.ok(most >= 14, 'and it does fill to the cap');
  // Once the cap was first reached, every request began with less than about 10 s buffered ahead.
  const capped = samples.find((s) => s.ahead >= 14).t;
  const later = reqs.filter((r) => r[3] > capped + 150);
  assert.ok(later.length >= 2, 'fetching started again as the buffer drained');
  for (const r of later) {
    const at = samples.filter((s) => s.t <= r[3]).at(-1);
    assert.ok(at.ahead < 10.6, `a request at ${at.ct.toFixed(1)} s with ${at.ahead.toFixed(1)} s ahead`);
  }
  // A pause in fetching of several seconds of play while the buffer held.
  const gaps = later.map((r, i) => r[3] - (i ? later[i - 1][3] : capped));
  assert.ok(Math.max(...gaps) >= 1500, 'fetching waits while the buffer is full');
  const end = samples.at(-1);
  assert.ok(end.ct - end.start <= 15.5, `kept ${(end.ct - end.start).toFixed(1)} s behind the play position`);
  assert.ok(end.start > 0, 'what lay behind was removed');
  assert.ok(!(await page.evaluate(() => /** @type {any} */ (window).events)).some((e) => e.type === 'fallback'));
  assert.deepEqual(errors, []);
  await page.close();
});

test('seek bisects to the right page; inside the buffer it is instant; skip starts the next song now', opts, async (t) => {
  const { page, errors } = await harness();
  ranges = [];
  await page.evaluate(async (bytes) => {
    const w = /** @type {any} */ (window);
    w.feed.load([{ url: () => '/media/long.opus', bytes, durationMs: 36_000 }, { url: () => '/media/tone.opus' }, { url: () => '/media/tone.opus' }]);
    await /** @type {HTMLAudioElement} */ (document.getElementById('a')).play();
  }, LONG.length);
  await until(page, () => /** @type {any} */ (window).events.some((e) => e.type === 'trackstart'));
  // Past what is buffered (about 15 s): a few Range requests find the page, and play goes on from there.
  const before = ranges.length;
  await page.evaluate(() => /** @type {any} */ (window).feed.seek(27_000));
  await until(page, () => document.querySelector('audio').currentTime >= 27.3);
  const probes = ranges.slice(before).filter((r) => r[0] === 'long.opus');
  assert.ok(probes.length >= 2 && probes.length <= 12, `${probes.length} requests to seek`);
  assert.ok(probes.some((r) => r[1] > 100_000), 'it reads near the target, not from the start');
  let pos = await page.evaluate(() => /** @type {any} */ (window).feed.position());
  assert.equal(pos.index, 0);
  assert.ok(pos.ms >= 27_000 && pos.ms < 29_500, `at ${pos.ms} ms`);
  // Inside the buffer: no request at all.
  const n = ranges.length;
  await page.evaluate(() => /** @type {any} */ (window).feed.seek(28_000));
  pos = await page.evaluate(() => /** @type {any} */ (window).feed.position());
  assert.ok(Math.abs(pos.ms - 28_000) < 50, `at ${pos.ms} ms right away`);
  assert.equal(ranges.length, n);
  // Skip: the next song sounds at once (it was joined already, so the element just moves there).
  const t0 = Date.now();
  await page.evaluate(() => /** @type {any} */ (window).feed.skip());
  await until(page, () => /** @type {any} */ (window).events.some((e) => e.type === 'trackstart' && e.index === 1));
  const ev = await page.evaluate(() => /** @type {any} */ (window).events);
  const start1 = ev.find((e) => e.type === 'trackstart' && e.index === 1);
  t.diagnostic(`seek past the buffer: ${probes.length} requests; next song sounded ${start1.t - t0} ms after skip`);
  assert.ok(start1.t - t0 < 1500, `the next song sounded ${start1.t - t0} ms after skip`);
  assert.ok(!ev.some((e) => e.type === 'trackend' && e.index === 0), 'a skipped song does not report a true end');
  // Skip again, before the third song is joined or not: either way it plays and the queue ends.
  await page.evaluate(() => /** @type {any} */ (window).feed.skip());
  await until(page, () => /** @type {any} */ (window).events.some((e) => e.type === 'ended'));
  const done = await page.evaluate(() => /** @type {any} */ (window).events);
  assert.ok(done.some((e) => e.type === 'trackstart' && e.index === 2));
  assert.ok(!done.some((e) => e.type === 'fallback'), JSON.stringify(done.filter((e) => e.type === 'fallback')));
  assert.deepEqual(errors, []);
  await page.close();
});

test('skip before the next song is joined starts it from its first byte, in the same element', opts, async (t) => {
  const { page, errors } = await harness();
  await page.evaluate(async (bytes) => {
    const w = /** @type {any} */ (window);
    w.feed.load([{ url: () => '/media/long.opus', bytes }, { url: () => '/media/long.opus?again', bytes }]);
    await /** @type {HTMLAudioElement} */ (document.getElementById('a')).play();
  }, LONG.length);
  await until(page, () => /** @type {any} */ (window).events.some((e) => e.type === 'trackstart'));
  ranges = [];
  const t0 = Date.now();
  await page.evaluate(() => /** @type {any} */ (window).feed.skip());
  await until(page, () => /** @type {any} */ (window).events.some((e) => e.type === 'trackstart' && e.index === 1));
  const ev = await page.evaluate(() => /** @type {any} */ (window).events);
  const start1 = ev.find((e) => e.type === 'trackstart' && e.index === 1);
  t.diagnostic(`next song (not yet joined) sounded ${start1.t - t0} ms after skip`);
  assert.ok(start1.t - t0 < 1500, `${start1.t - t0} ms`);
  assert.equal(ranges[0][1], 0, 'its first request starts at byte 0');
  await until(page, () => document.querySelector('audio').currentTime > /** @type {any} */ (window).events.at(-1).at + 1);
  const pos = await page.evaluate(() => /** @type {any} */ (window).feed.position());
  assert.equal(pos.index, 1);
  assert.ok(pos.ms > 900 && pos.ms < 4000, `${pos.ms} ms into the next song`);
  assert.ok(!ev.some((e) => e.type === 'trackend' || e.type === 'fallback'));
  assert.deepEqual(errors, []);
  await page.close();
});

test('a corrupt, missing or non-Ogg file raises fallback with a reason, and says where to pick up', opts, async () => {
  const cases = [
    [['bad.opus'], 'ogg-crc', 0],
    [['missing.opus'], 'http-404', 0],
    [['page.opus'], 'ogg-capture', 0],
    [['tone.opus', 'bad.opus'], 'ogg-crc', 1],
  ];
  for (const [files, reason, failed] of cases) {
    const { page, errors } = await harness();
    await page.evaluate(async (files) => {
      const w = /** @type {any} */ (window);
      w.feed.load(files.map((f) => ({ url: () => `/media/${f}` })));
      /** @type {HTMLAudioElement} */ (document.getElementById('a')).play().catch(() => {});
    }, files);
    await until(page, () => /** @type {any} */ (window).events.some((e) => e.type === 'fallback'), null, 15_000);
    const fb = (await page.evaluate(() => /** @type {any} */ (window).events)).find((e) => e.type === 'fallback');
    assert.equal(fb.reason, reason, files.join(' then '));
    assert.equal(fb.failed, failed);
    assert.equal(fb.index, 0, 'playback was in the first song');
    assert.ok(fb.ms >= 0);
    assert.deepEqual(errors, []);
    await page.close();
  }
});

test('the lab page plays the queue under its own CSP and shows the join, the cap and the gap', opts, async () => {
  const page = await browser.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(e.message));
  page.on('console', (m) => /Content Security Policy|Refused to/.test(m.text()) && problems.push(m.text()));
  await page.goto(`${base}/lab/stream/?src=/media/tone.opus,/media/tone.opus`);
  await until(page, () => document.querySelector('audio')?.currentTime > 0);
  await page.evaluate(() => (document.querySelector('audio').playbackRate = 2));
  await until(page, () => document.getElementById('log').textContent.includes('the queue played out'), null, 20_000);
  const log = await page.locator('#log li').allTextContents();
  assert.ok(log.some((l) => /song 2 \(tone\.opus\) started at 3\.000 s · gap 0\.0 ms after song 1/.test(l)), log.join('\n'));
  assert.match(await page.locator('#nums').textContent(), /buffered ahead · cap 15 s · most so far \d+\.\d s/);
  assert.match(await page.locator('#state').textContent(), /tone\.opus, tone\.opus/);
  assert.deepEqual(problems, []);
  // An address outside this site is not followed.
  await page.goto(`${base}/lab/stream/?src=https://elsewhere.example.org/a.opus`);
  await until(page, () => /Sign in/.test(document.getElementById('state').textContent));
  await page.close();
});

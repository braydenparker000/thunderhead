// A real film through Astra's engine, measured: node scripts/astra/real.mjs <film> [options]
// The film is served from its own folder by tests/fixtures/astra-host.mjs (byte ranges, counted) and played by
// AstraPlayer on the lab page of the local site (its own player stays idle), one fresh browser profile a run (no film remembered), then:
//  start   time from load() to the first picture, and the requests and bytes before it
//  play    60 s of play: frames dropped, stalls (waiting after the first picture), long tasks, the page's thread late,
//          bytes downloaded against the bytes of film played (by the cue index), the browser's buffer ahead and
//          behind, appendBuffer errors (QuotaExceededError), removals, the reader's cache, the page's memory
//  seeks   inside the buffer (+5 s), far forward, far back, the last minute: time to a picture at the place
//  resume  a fresh profile opening the film at --resume, and (warm) the same profile opening it again there
// Memory is the renderer process's PSS from /proc (all of it: the page's buffers, Media Source's, the decoders') and
// the JS heap with its ArrayBuffer backing stores (DevTools protocol, Runtime.getHeapUsage); never the Network domain,
// which would keep copies of the film. The link is paced at the host: --mbit shares that many Mbit/s between the
// requests open at the time (one link), --conn paces each connection alone (bytes/s); --delay ms a request.
// Options: --runs 3 --cpu 1 --mbit 0 --conn 0 --delay 0 --audio default|aac --subs <language> --resume 120 --play 60
//          --far 120 --back 15 --last 165 --skip resume,warm,seeks --out results.json --before '<js run in the page first>'
//          --gc (a garbage collection forced before each look at memory: what is still held)
//          --taps (a tap every 2 s while it plays, which changes a line of text as a menu would: how long from the tap to
//          the next paint, by the browser's Event Timing, median and worst)
// Needs Playwright's Chromium (CHROMIUM_PATH, default /opt/pw-browsers/chromium) and ffprobe for --audio aac.
// Films stay where they are: nothing of them is written here.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { serve } from '../serve.mjs';
import { astraHost } from '../../tests/fixtures/astra-host.mjs';

const args = process.argv.slice(2), film = resolve(args[0] || '');
const opt = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args[i + 1]; };
const O = { runs: +opt('runs', 3), cpu: +opt('cpu', 1), mbit: +opt('mbit', 0), conn: +opt('conn', 0), delay: +opt('delay', 0), audio: opt('audio', 'default'),
  subs: opt('subs', ''), resume: +opt('resume', 120), play: +opt('play', 60), far: opt('far'), back: opt('back'), last: opt('last'), skip: new Set(String(opt('skip', '')).split(',')), out: opt('out'), before: opt('before'), gc: args.includes('--gc'), taps: args.includes('--taps') };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (xs) => { const v = xs.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b); return v.length ? v[v.length >> 1] : null; };

/** The Matroska track number of the film's AAC track (ffmpeg numbers tracks from 1 in its own order). */
function aacTrack() {
  const s = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=index,codec_name,codec_type', '-of', 'json', film], { encoding: 'utf8' })).streams;
  const a = s.find((x) => x.codec_type === 'audio' && x.codec_name === 'aac');
  if (!a) throw Error('the film has no AAC track');
  return a.index + 1;
}

/** Renderer processes under the browser, with their PSS in bytes (the largest is the film's page). */
function rendererPss(root) {
  const kids = new Map();
  for (const d of readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    try { const ppid = +readFileSync(`/proc/${d}/stat`, 'utf8').split(') ')[1].split(' ')[1]; if (!kids.has(ppid)) kids.set(ppid, []); kids.get(ppid).push(+d); } catch {}
  }
  const all = [], walk = (p) => { for (const k of kids.get(p) || []) { all.push(k); walk(k); } };
  walk(root);
  let best = 0;
  for (const pid of all) {
    try {
      if (!readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes('--type=renderer')) continue;
      const pss = +/Pss:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8'))[1] * 1024;
      best = Math.max(best, pss);
    } catch {}
  }
  return best;
}

// In the page before anything runs: requests to the film, appendBuffer's errors, removals, long tasks, how late a 50 ms timer runs.
function instrument() {
  const M = window.__m = { fetches: [], errors: {}, removes: [], long: [], late: [], quotaAt: [] };
  const of = window.fetch;
  window.fetch = function (input, init) {
    const range = init?.headers?.Range || init?.headers?.range || '', rec = { t: Math.round(performance.now()), range, method: init?.method || 'GET' };
    if (!String(input?.url || input).includes('/astra/')) M.fetches.push(rec);
    return of.apply(this, arguments);
  };
  const ab = SourceBuffer.prototype.appendBuffer, rm = SourceBuffer.prototype.remove;
  SourceBuffer.prototype.appendBuffer = function (d) {
    try { return ab.call(this, d); } catch (e) { M.errors[e.name] = (M.errors[e.name] || 0) + 1; if (e.name === 'QuotaExceededError') M.quotaAt.push(Math.round(performance.now())); throw e; }
  };
  SourceBuffer.prototype.remove = function (a, b) { const v = window.p?.video; M.removes.push([Math.round(performance.now()), v ? +v.currentTime.toFixed(1) : null, +(+a).toFixed(1), b === Infinity ? 'end' : +(+b).toFixed(1)]); return rm.call(this, a, b); };
  new PerformanceObserver((l) => { for (const e of l.getEntries()) M.long.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ entryTypes: ['longtask'] });
  // A tap's way to the screen (--taps): each pointerdown changes a line of text, as a menu opening would.
  M.taps = [];
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === 'pointerdown') M.taps.push([Math.round(e.startTime), e.duration]); }).observe({ type: 'event', durationThreshold: 16, buffered: true });
  addEventListener('DOMContentLoaded', () => {
    const pad = Object.assign(document.createElement('div'), { id: 'm-tap' }); // the place tapped, over the page's own
    pad.style.cssText = 'position:fixed;left:0;top:0;width:60px;height:40px;z-index:2147483647;background:#000;color:#fff;font:10px sans-serif';
    pad.addEventListener('pointerdown', () => { pad.textContent = 'tap ' + Math.round(performance.now()); });
    document.body.append(pad);
  });
  let last = performance.now();
  setInterval(() => { const now = performance.now(); M.late.push([Math.round(now), Math.round(now - last - 50)]); if (M.late.length > 4000) M.late.shift(); last = now; }, 50);
}

// The page's own view, once a second: the playhead, the buffers, the reader's cache, what waits to be appended.
function sample() {
  const p = window.p, v = p.video, s = p.probed?.source, q = p.session?.queues || {};
  const around = (r) => { const t = v.currentTime; try { for (let i = 0; i < r.length; i++) if (r.start(i) <= t + 0.1 && r.end(i) > t) return [+(t - r.start(i)).toFixed(1), +(r.end(i) - t).toFixed(1), r.length]; return [0, 0, r.length]; } catch { return [0, 0, 0]; } };
  const sum = (it) => { let n = 0; for (const b of it) n += b?.bytes ? b.bytes.length : b?.length || 0; return n; };
  return { now: Math.round(performance.now()), t: +v.currentTime.toFixed(2), rs: v.readyState, seeking: v.seeking, paused: v.paused,
    el: around(v.buffered), vb: q.video ? around(q.video.buffer.buffered) : null, ab: q.audio ? around(q.audio.buffer.buffered) : null,
    cache: s ? sum(s.blocks.values()) + sum(s.partials.values()) + sum(s.filling) + sum(s.kept || []) : 0, blocks: s?.blocks.size || 0, maxBlocks: s?.maxBlocks || 0,
    queued: (q.video?.pending() || 0) + (q.audio?.pending() || 0), fetched: s?.bytesFetched || 0, streams: s?.streams.size || 0, gatePeak: s?.gate?.peak || 0,
    readAt: p.session?.readAt ? { ...p.session.readAt } : null, restarts: p.session?.stats?.restarts || 0, fallback: p.session?.stats?.fallback || null,
    clusters: [...(p.session?.packets?.clusters?.values() || [])].reduce((n, c) => n + [...c.frames.values()].flat().reduce((m, f) => m + f.packet.data.byteLength, 0), 0) };
}

async function setup(browser, base) {
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
  await page.addInitScript(instrument);
  const cdp = await ctx.newCDPSession(page);
  if (O.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: O.cpu });
  await page.goto(`${base}/astra/lab/`); // a page of the site itself (a page made up by the test is refused the loopback host)
  await page.evaluate(async () => {
    const { AstraPlayer } = await import('/astra/src/engine/player.js');
    const video = Object.assign(document.createElement('video'), { playsInline: true });
    video.style.cssText = 'width:844px;height:390px;display:block';
    document.body.append(video);
    const p = window.p = new AstraPlayer(video, document.createElement('div'));
    const M = window.__m; M.frames = []; M.waits = [];
    // Frames are watched only while a picture is awaited: a frame callback asked for again and again makes this browser
    // count nearly every frame as dropped (the browser playing a file by itself too), so it is off while play is measured.
    M.arm = () => { if (M.armed) return; M.armed = true; video.requestVideoFrameCallback(function each(now, meta) { M.frames.push([Math.round(now), +meta.mediaTime.toFixed(3)]); if (M.frames.length > 6000) M.frames.splice(0, 3000); if (M.target != null) video.requestVideoFrameCallback(each); else M.armed = false; }); };
    for (const e of ['waiting', 'playing', 'seeking', 'seeked']) video.addEventListener(e, () => M.waits.push([Math.round(performance.now()), e, +video.currentTime.toFixed(2)]));
    p.addEventListener('error', (e) => { M.error = String(e.detail?.message) + ' ' + String(e.detail?.detail || '').slice(0, 200); });
  });
  if (O.before) await page.evaluate(O.before); // an experiment: e.g. "import('/astra/src/engine/remux.js').then(m => { m.TUNING.ownMkv = false; })"
  return { ctx, page, errors, cdp };
}

/** Loads the film at `from` and waits for a picture there: {ms, bytes, requests, ranges} at that moment. */
async function open(page, url, from, audioId) {
  await page.evaluate(([url, from, audioId, subs]) => {
    const M = window.__m; M.loadAt = performance.now(); M.target = from; M.frames.length = 0; M.arm();
    window.p.load({ url, startTime: from, autoplay: true, prefs: { ...(audioId ? { audioId } : {}), ...(subs ? { subtitleLanguage: subs } : {}) } });
  }, [url, from, audioId, O.subs]);
  return picture(page, 60_000, 'loadAt');
}

/** Waits for a frame within [target - 0.3, target + 5): its time after M[at], and what the reader had fetched by then. */
async function picture(page, timeout, at) {
  const t = Date.now();
  for (;;) {
    const r = await page.evaluate((at) => {
      const M = window.__m, hit = M.frames.find((f) => f[1] >= M.target - 0.3 && f[1] < M.target + 5);
      if (!hit && !M.error) return null;
      const s = window.p.probed?.source, since = M[at];
      M.target = null; // the frame callback stops
      const steps = at === 'loadAt' ? window.p.log.filter((x) => x.t >= since && ['status', 'plan'].includes(x.kind)).map((x) => `${Math.round(x.t - since)} ${x.kind === 'plan' ? 'plan' : x.detail}`) : undefined;
      return { ms: hit ? Math.round(hit[0] - since) : null, error: M.error || null, bytes: s?.bytesFetched ?? null, steps,
        requests: M.fetches.filter((f) => f.t >= since - 1 && f.t <= (hit ? hit[0] : performance.now())).map((f) => f.method === 'HEAD' ? 'HEAD' : f.range.replace('bytes=', '')) };
    }, at).catch(() => null);
    if (r) return r;
    if (Date.now() - t > timeout) return { ms: null, error: 'no picture in time' };
    await sleep(20);
  }
}

async function seek(page, to) {
  const before = await page.evaluate((to) => { const M = window.__m, v = window.p.video; M.seekAt = performance.now(); M.target = to; M.frames.length = 0; M.arm(); const b = window.p.probed?.source?.bytesFetched || 0; v.currentTime = to; return b; }, to);
  const r = await picture(page, 30_000, 'seekAt');
  return { ...r, bytes: r.bytes != null ? r.bytes - before : null };
}

/** Bytes of the file between two times of the film, by the cue index's clusters. */
const filmBytes = (page, a, b) => page.evaluate(([a, b]) => {
  const cues = (window.p.info?.layout?.cues || []).slice().sort((x, y) => x.time - y.time), size = window.p.info.size, dur = window.p.info.duration;
  const at = (t) => { if (!cues.length) return size * t / dur; let i = 0; while (i + 1 < cues.length && cues[i + 1].time <= t) i++; const c = cues[i], n = cues[i + 1] || { time: dur, position: size }; return c.position + (n.position - c.position) * Math.min(1, (t - c.time) / Math.max(1e-6, n.time - c.time)); };
  return Math.round(at(b) - at(a));
}, [a, b]);

async function memory(cdp, root) {
  if (O.gc) await cdp.send('HeapProfiler.collectGarbage').catch(() => {}); // --gc: what is still held, garbage left out
  const h = await cdp.send('Runtime.getHeapUsage').catch(() => null);
  return { pss: rendererPss(root), heap: h ? h.usedSize + (h.backingStorageSize || 0) : null, store: h?.backingStorageSize ?? null };
}

async function playRun(browser, base, host, url, audioId, root) {
  const { ctx, page, errors, cdp } = await setup(browser, base);
  host.reset(); pacing(host);
  const out = { start: await open(page, url, 0, audioId) };
  out.startRequests = out.start.requests?.length; out.startHost = { requests: host.stats.requests, bytes: host.stats.bytes };
  if (out.start.ms == null) { console.error('no first picture:', out.start.error, errors, await page.evaluate(() => window.p.log.slice(-8).map((x) => x.kind + ' ' + JSON.stringify(x.detail).slice(0, 300)))); }
  // 60 s of play from the first picture, sampled each second.
  const s0 = await page.evaluate(() => { const M = window.__m; M.target = null; const q = window.p.video.getVideoPlaybackQuality(); M.playAt = performance.now(); return { q: [q.droppedVideoFrames, q.totalVideoFrames], t: window.p.video.currentTime }; });
  const samples = [];
  let peak = { pss: 0, heap: 0, store: 0 };
  for (let i = 0; i < O.play; i++) {
    await sleep(1000);
    if (O.taps && i % 2) await page.mouse.click(20, 20);
    const [s, m] = await Promise.all([page.evaluate(sample), memory(cdp, root)]);
    samples.push({ ...s, ...m });
    peak = { pss: Math.max(peak.pss, m.pss), heap: Math.max(peak.heap, m.heap || 0), store: Math.max(peak.store, m.store || 0) };
  }
  const p1 = await page.evaluate(() => {
    const M = window.__m, v = window.p.video, q = v.getVideoPlaybackQuality(), at = M.playAt;
    const w = M.waits.filter((x) => x[0] > at), stalls = []; let open = null;
    // Stalls (waiting to playing) and the stretches of play between them (playing, or the start, to waiting, or the end).
    const runs = []; let from = at;
    for (const [t, e] of w) { if (e === 'waiting' && open == null) { open = t; if (from != null) runs.push(t - from); from = null; } if (e === 'playing' && open != null) { stalls.push(t - open); open = null; from = t; } }
    if (open != null) stalls.push(Math.round(performance.now() - open)); else if (from != null) runs.push(performance.now() - from);
    const taps = M.taps.filter((x) => x[0] > at).map((x) => x[1]).sort((a, b) => a - b);
    const long = M.long.filter((l) => l[0] > at), late = M.late.filter((l) => l[0] > at).map((l) => l[1]);
    return { q: [q.droppedVideoFrames, q.totalVideoFrames], t: v.currentTime, stalls, longestRun: Math.round(Math.max(0, ...runs)), taps: taps.length ? [taps[taps.length >> 1], taps.at(-1), taps.length] : null, long: [long.length, long.reduce((n, l) => n + l[1], 0), Math.max(0, ...long.map((l) => l[1]))], lateMax: Math.max(0, ...late),
      errors: { ...M.errors }, quota: M.quotaAt.length, requests: M.fetches.filter((f) => f.t > at).length, removes: M.removes.filter((r) => r[0] > at).length, removesUnder: M.removes.filter((r) => r[0] > at && r[3] !== 'end' && r[3] > r[1] - 0.5).length, log: window.p.log.filter((x) => ['stall', 'resume', 'fallback', 'error', 'rebuffer'].includes(x.kind)).map((x) => x.kind + ' ' + JSON.stringify(x.detail).slice(0, 120)) };
  });
  const played = await filmBytes(page, s0.t, p1.t);
  const last = samples.at(-1);
  out.play = { seconds: +(p1.t - s0.t).toFixed(1), dropped: p1.q[0] - s0.q[0], frames: p1.q[1] - s0.q[1], stalls: p1.stalls.length, stallMs: p1.stalls.reduce((a, b) => a + b, 0), stallWorst: Math.max(0, ...p1.stalls), longestRun: p1.longestRun, taps: p1.taps, long: p1.long, lateMax: p1.lateMax, requests: p1.requests, restarts: last.restarts - samples[0].restarts,
    fetchedTotal: last.fetched, played, appendErrors: p1.errors, quota: p1.quota, removes: p1.removes, removesUnderPlayhead: p1.removesUnder,
    aheadMax: Math.max(...samples.map((s) => s.el[1])), behindMax: Math.max(...samples.map((s) => s.el[0])), ahead: median(samples.map((s) => s.el[1])), behind: median(samples.map((s) => s.el[0])),
    holes: samples.filter((s) => s.el[2] > 1).length, cacheMax: Math.max(...samples.map((s) => s.cache)), queuedMax: Math.max(...samples.map((s) => s.queued)), peak, log: p1.log };
  out.series = samples.map((s) => [Math.round((s.now - samples[0].now) / 1000), s.t, s.el[0], s.el[1], +(s.cache / 1048576).toFixed(0), +(s.clusters / 1048576).toFixed(0), +(s.queued / 1048576).toFixed(0), +(s.pss / 1048576).toFixed(0), +((s.heap || 0) / 1048576).toFixed(0), s.streams]);
  if (!O.skip.has('seeks')) {
    const dur = await page.evaluate(() => window.p.video.duration), here = await page.evaluate(() => window.p.video.currentTime);
    const far = +(O.far ?? Math.min(dur * 0.66, 120)), back = +(O.back ?? 15), lastMin = +(O.last ?? dur - 15);
    out.seeks = {};
    for (const [name, to] of [['near', here + 5], ['far', far], ['back', back], ['last', lastMin]]) { out.seeks[name] = await seek(page, to); await sleep(2500); }
    out.seeks.peak = (await memory(cdp, root)).pss;
  }
  if (!O.skip.has('warm')) out.warm = await open(page, url, O.resume, audioId); // the same profile: the film is remembered
  out.host = { requests: host.stats.requests, peak: host.stats.peak, bytes: host.stats.bytes };
  out.errors = errors;
  await ctx.close();
  return out;
}

async function resumeRun(browser, base, host, url, audioId) {
  const { ctx, page } = await setup(browser, base);
  host.reset(); pacing(host);
  const r = await open(page, url, O.resume, audioId);
  await sleep(8000);
  const after = await page.evaluate((from) => ({ t: window.p.video.currentTime, ok: window.p.video.currentTime > from + 4 }), O.resume);
  await ctx.close();
  return { ...r, playedOn: after.ok, hostRequests: host.stats.requests };
}

let pacer = null;
function pacing(host) {
  clearInterval(pacer);
  host.control.delay = O.delay;
  if (O.conn) host.control.bps = O.conn;
  else if (O.mbit) pacer = setInterval(() => { host.control.bps = Math.floor(O.mbit * 125000 / Math.max(1, host.stats.open)); }, 25);
  else host.control.bps = 0;
}

(async () => {
  if (!film.endsWith('.mkv') && !film.endsWith('.mp4') && !film.endsWith('.webm')) throw Error('usage: node scripts/astra/real.mjs <film> [options]');
  const audioId = O.audio === 'aac' ? aacTrack() : null;
  const site = await serve(0, {}), base = `http://127.0.0.1:${site.address().port}`;
  const host = await astraHost({ root: dirname(film) + '/' });
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox', '--disable-background-networking'] });
  const root = process.pid, url = host.url(basename(film)); // the browser runs under this script
  const runs = [];
  for (let i = 0; i < O.runs; i++) {
    const run = await playRun(browser, base, host, url, audioId, root);
    if (!O.skip.has('resume')) run.resume = await resumeRun(browser, base, host, url, audioId);
    runs.push(run);
    console.error(`run ${i + 1}: first ${run.start.ms} ms, resume ${run.resume?.ms} ms, warm ${run.warm?.ms} ms, seeks ${JSON.stringify(Object.fromEntries(Object.entries(run.seeks || {}).map(([k, v]) => [k, v?.ms ?? v])))}, stalls ${run.play.stalls} (${(run.play.stallMs / 1000).toFixed(1)} s, longest play ${(run.play.longestRun / 1000).toFixed(1)} s), dropped ${run.play.dropped}, pss ${(run.play.peak.pss / 1048576).toFixed(0)} MB`);
  }
  const m = (f) => median(runs.map(f)), MB = (x) => x == null ? null : +(x / 1048576).toFixed(1);
  const summary = { film: basename(film), cpu: O.cpu, mbit: O.mbit, conn: O.conn, delay: O.delay, audio: O.audio, runs: runs.length,
    first: m((r) => r.start.ms), firstRequests: m((r) => r.startRequests), firstMB: MB(m((r) => r.start.bytes)), resume: m((r) => r.resume?.ms), resumeRequests: m((r) => r.resume?.requests?.length), resumeMB: MB(m((r) => r.resume?.bytes)),
    warm: m((r) => r.warm?.ms), warmRequests: m((r) => r.warm?.requests?.length), near: m((r) => r.seeks?.near.ms), far: m((r) => r.seeks?.far.ms), farRequests: m((r) => r.seeks?.far.requests?.length), back: m((r) => r.seeks?.back.ms), last: m((r) => r.seeks?.last.ms),
    dropped: m((r) => r.play.dropped), frames: m((r) => r.play.frames), stalls: m((r) => r.play.stalls), stallMs: m((r) => r.play.stallMs), stallWorst: m((r) => r.play.stallWorst), longestRun: m((r) => r.play.longestRun), tapMs: m((r) => r.play.taps?.[0]), tapWorst: m((r) => r.play.taps?.[1]), playedS: m((r) => r.play.seconds),
    downloadedMB: MB(m((r) => r.play.fetchedTotal)), playedMB: MB(m((r) => r.play.played)), aheadS: m((r) => r.play.ahead), aheadMaxS: m((r) => r.play.aheadMax), behindMaxS: m((r) => r.play.behindMax),
    quota: m((r) => r.play.quota), removesUnder: m((r) => r.play.removesUnderPlayhead), holes: m((r) => r.play.holes), cacheMaxMB: MB(m((r) => r.play.cacheMax)), queuedMaxMB: MB(m((r) => r.play.queuedMax)),
    pssPeakMB: MB(m((r) => r.play.peak.pss)), heapPeakMB: MB(m((r) => r.play.peak.heap)), storePeakMB: MB(m((r) => r.play.peak.store)), seekPssMB: MB(m((r) => r.seeks?.peak)),
    longTasks: m((r) => r.play.long[0]), longMs: m((r) => r.play.long[1]), longWorst: m((r) => r.play.long[2]), lateMax: m((r) => r.play.lateMax),
    playRequests: m((r) => r.play.requests), playRestarts: m((r) => r.play.restarts), hostRequests: m((r) => r.host.requests), hostPeak: m((r) => r.host.peak) };
  console.log(JSON.stringify(summary));
  if (O.out) writeFileSync(O.out, JSON.stringify({ options: { ...O, skip: [...O.skip] }, summary, runs }, null, 1));
  clearInterval(pacer);
  await browser.close(); site.close(); await host.close();
})().catch((e) => { console.error(e); process.exit(1); });

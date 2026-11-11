// How smoothly one film plays through Astra's lab page: node smooth.cjs <file> [cpu slowdown] [bytes per second]
// Start-up, frame pacing while playing, stalls, long tasks on the page's thread, far and near seeks, an audio switch.
const { chromium } = require('playwright');
const [f, cpu = '1', net = '0'] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox', '--headless=new'] });
  const p = await b.newPage({ viewport: { width: 800, height: 450 } }); const cdp = await p.context().newCDPSession(p);
  if (+cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: +cpu });
  if (+net > 0) { await cdp.send('Network.enable'); await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: +net, uploadThroughput: 1e6 }); }
  p.on('pageerror', (e) => console.log('PAGE ERROR', e.message.slice(0, 200)));
  await p.addInitScript(() => {
    const S = window.__s = { t0: performance.now(), frames: [], waits: [], long: [], marks: {} };
    new PerformanceObserver((l) => { for (const e of l.getEntries()) S.long.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ entryTypes: ['longtask'] });
    const hook = () => { const v = document.getElementById('video'); if (!v) return setTimeout(hook, 20);
      const each = (now, meta) => { S.frames.push([now, meta.mediaTime, meta.presentedFrames]); v.requestVideoFrameCallback(each); }; v.requestVideoFrameCallback(each);
      for (const e of ['waiting', 'playing', 'seeking', 'seeked', 'stalled']) v.addEventListener(e, () => S.waits.push([Math.round(performance.now()), e, +v.currentTime.toFixed(2)])); };
    hook();
  });
  const t0 = Date.now();
  await p.goto(`http://127.0.0.1:8080/astra/lab/?src=${encodeURIComponent('http://127.0.0.1:8090/' + f)}&autoplay=1`);
  const wait = (ms) => p.waitForTimeout(ms);
  const until = async (fn, arg, ms = 30000) => { const t = Date.now(); for (;;) { const r = await p.evaluate(fn, arg).catch(() => null); if (r) return Date.now() - t; if (Date.now() - t > ms) return -1; await wait(25); } };
  const first = await until(() => window.__s.frames.length > 0 && performance.now() - window.__s.t0);
  const firstMs = await p.evaluate(() => Math.round(window.__s.frames[0][0] - window.__s.t0));
  await wait(15000);
  // frame pacing over the steady stretch (after the first two seconds)
  const pace = await p.evaluate(() => { const S = window.__s, fr = S.frames.filter((x) => x[0] > S.frames[0][0] + 2000); const gaps = []; for (let i = 1; i < fr.length; i++) gaps.push(fr[i][0] - fr[i - 1][0]);
    const sorted = [...gaps].sort((a, b) => a - b), med = sorted[sorted.length >> 1] || 0; const v = document.getElementById('video'), q = v.getVideoPlaybackQuality();
    const skipped = fr.length ? (fr.at(-1)[2] - fr[0][2] + 1) - fr.length : 0;
    return { frames: fr.length, median: +med.toFixed(1), hitches: gaps.filter((g) => g > med * 1.6).length, worst: +Math.max(0, ...gaps).toFixed(0), dropped: q.droppedVideoFrames, total: q.totalVideoFrames, skipped,
      waits: S.waits.filter((w) => w[1] === 'waiting' && w[0] > S.frames[0][0] + 500).length, long: S.long.filter((l) => l[0] > S.frames[0][0]).length, longMs: S.long.filter((l) => l[0] > S.frames[0][0]).reduce((n, l) => n + l[1], 0), longWorst: Math.max(0, ...S.long.map((l) => l[1])), mode: window.astraLab.player.mode }; });
  // a seek: how long until a frame at or after the target is shown
  const seek = async (to) => { await p.evaluate((t) => { const S = window.__s, v = document.getElementById('video'); S.seekAt = performance.now(); S.seekTo = t; S.frames.length = 0; v.currentTime = t; }, to);
    const ms = await until(() => { const S = window.__s; const hit = S.frames.find((x) => x[1] >= S.seekTo - 0.3 && x[1] < S.seekTo + 5); return hit && Math.round(hit[0] - S.seekAt); }, null, 20000);
    return ms < 0 ? 'never' : await p.evaluate(() => { const S = window.__s; const hit = S.frames.find((x) => x[1] >= S.seekTo - 0.3 && x[1] < S.seekTo + 5); return Math.round(hit[0] - S.seekAt); }); };
  const dur = await p.evaluate(() => document.getElementById('video').duration);
  const far = await seek(Math.min(dur * 0.66, 120)); await wait(2500);
  const near = await seek(Math.min(dur * 0.66, 120) + 6); await wait(1500);
  const back = await seek(8); await wait(2500);
  // an audio switch, when there is a second track: how long the picture stops, how long until the new sound covers the playhead
  const audio = await p.evaluate(async () => { const pl = window.astraLab.player, S = window.__s, opts = pl.audioOptions().filter((o) => o.supported); if (opts.length < 2) return null;
    const other = opts.find((o) => !o.selected); const n = S.frames.length, t = performance.now(); await pl.selectAudio(other.id); await new Promise((r) => setTimeout(r, 3000));
    const fr = S.frames.slice(n); let worst = 0; for (let i = 1; i < fr.length; i++) worst = Math.max(worst, fr[i][0] - fr[i - 1][0]); return { to: other.label, picked: Math.round(performance.now() - t - 3000), worstGap: Math.round(worst), frames: fr.length }; });
  const end = await p.evaluate(() => { const v = document.getElementById('video'), pl = window.astraLab.player, q = pl.session?.queues; const r = (bf) => { try { return Array.from({ length: bf.buffered.length }, (_, i) => [+bf.buffered.start(i).toFixed(2), +bf.buffered.end(i).toFixed(2)]); } catch { return 'gone'; } };
    return { t: +v.currentTime.toFixed(1), paused: v.paused, err: v.error?.message || pl.log.filter((x) => x.kind === 'error').map((x) => JSON.stringify(x.detail).slice(0, 200))[0] || null, video: q?.video && r(q.video.buffer), audio: q?.audio && r(q.audio.buffer), restarts: pl.session?.stats?.restarts, waits: window.__s.waits.slice(-14).map((w) => w.join(' ')).join(' | ') }; });
  console.log(JSON.stringify({ film: f, cpu: +cpu, net: +net, firstFrame: firstMs, pace, seek: { far, near, back }, audio, end }, null, 1));
  await b.close();
})();

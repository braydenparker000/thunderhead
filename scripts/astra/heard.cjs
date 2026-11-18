// The sound that really reaches the speakers, whichever way Astra plays the film (the software decoder
// has its own audio graph, which tone.cjs, listening to the video element, cannot hear):
// node heard.cjs <file>...   Each line: the loudest pitch (the test films' tone is 440 Hz), the level, the mode.
// node heard.cjs --switch 1,2,3,0 [--every 7] [--at 10] [--pitches 440,550,660,880] <file>
//   plays the film and changes its sound track to each listed one in turn (by its place in the audio menu), every
//   `every` seconds, listening all along (pitch every 5 ms, from the last 43 ms) and watching the frames shown. For each
//   change: when the new track's pitch is heard (ms after the tap), the longest silence on the way (ms), how long the old
//   track's pitch is still heard after the new one (ms), the picture's longest pause (ms), and, on a film with sound
//   marks (louder for the first 50 ms of each second, made by the README's real-film scripts), how far the sound is from
//   the picture after the change (ms, median of the marks). CPU=6 slows the page's thread six times.
// BASE: the local site (npm run serve); FILMS: the films (serve.cjs); CHROME: the browser.
const { chromium } = require('playwright');
const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf('--' + k); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const order = opt('switch', null), every = +opt('every', 7), at = +opt('at', 10), pitches = opt('pitches', '440,550,660,880').split(',').map(Number);

// The page's ears: every node wired to the speakers is wired to a recorder too, which posts, every 256 samples, the
// level of those samples and the strength of each pitch asked about over the last 2048 (Goertzel, Hann window).
const REC = `registerProcessor('heard-rec', class extends AudioWorkletProcessor {
  constructor(o) { super(); this.N = 2048; this.ring = new Float32Array(this.N); this.w = 0; this.n = 0; this.sq = 0; this.out = [];
    this.win = Float32Array.from({length: this.N}, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (this.N - 1)));
    this.k = o.processorOptions.freqs.map((f) => 2 * Math.cos(2 * Math.PI * f / sampleRate)); }
  process(inputs) {
    const ins = inputs[0]; if (!ins || !ins.length) return true;
    for (let i = 0; i < ins[0].length; i++) {
      let s = 0; for (const c of ins) s += c[i]; s /= ins.length;
      this.ring[this.w] = s; this.w = (this.w + 1) % this.N; this.sq += s * s;
      if (++this.n % 256) continue;
      const row = [currentFrame + i, Math.sqrt(this.sq / 256)]; this.sq = 0;
      for (const k of this.k) { let a = 0, b = 0; for (let j = 0; j < this.N; j++) { const x = this.ring[(this.w + j) % this.N] * this.win[j], c = x + k * a - b; b = a; a = c; } row.push(Math.sqrt(Math.max(0, a * a + b * b - k * a * b)) / this.N * 4); }
      this.out.push(row); if (this.out.length >= 16) { this.port.postMessage(this.out); this.out = []; }
    }
    return true;
  }
});`;

function ears(freqs) {
  window.__taps = []; const H = (window.__heard = { rows: [], ots: [], frames: [], switches: [] });
  const url = URL.createObjectURL(new Blob([window.__REC], { type: 'text/javascript' }));
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (to, ...rest) {
    if ((to instanceof AudioDestinationNode || to instanceof MediaStreamAudioDestinationNode) && !this.__tapped) {
      this.__tapped = true;
      const a = this.context.createAnalyser(); a.fftSize = 8192;
      connect.call(this, a); window.__taps.push(a);
      const ctx = this.context, node = this;
      if (freqs && !ctx.__rec) ctx.__rec = ctx.audioWorklet.addModule(url).then(() => {
        const r = new AudioWorkletNode(ctx, 'heard-rec', { processorOptions: { freqs } }), mute = ctx.createGain(); mute.gain.value = 0;
        connect.call(r, mute); connect.call(mute, ctx.destination);
        r.port.onmessage = (e) => { for (const row of e.data) H.rows.push(row); };
        H.sr = ctx.sampleRate;
        const stamp = () => { const o = ctx.getOutputTimestamp(); if (o.performanceTime > 0) H.ots.push([o.contextTime, o.performanceTime]); setTimeout(stamp, 100); };
        stamp();
        return r;
      });
      ctx.__rec?.then((r) => connect.call(node, r));
    }
    return connect.call(this, to, ...rest);
  };
}

/** One change of track, from what was heard and shown: see the header. */
function judge(H, [t, from, to], until) {
  const time = (f) => { let o = H.ots[0]; for (const x of H.ots) if (x[0] * H.sr <= f) o = x; return o[1] + (f / H.sr - o[0]) * 1000; };
  const rows = H.rows.map((r) => [time(r[0]), r[1], ...r.slice(2)]).filter((r) => r[0] >= t - 1000 && r[0] < until);
  const top = (r) => { let k = 2; for (let i = 3; i < r.length; i++) if (r[i] > r[k]) k = i; return r[k] > 0.004 ? k - 2 : -1; };
  const was = from ?? mode(rows.filter((r) => r[0] < t).map(top)), now = to ?? mode(rows.filter((r) => r[0] > until - 2000).map(top));
  let heard = null;
  for (let i = 0; i < rows.length && heard == null; i++) if (rows[i][0] >= t && rows.slice(i, i + 10).every((r) => top(r) === now)) heard = rows[i][0];
  let gap = 0, run = null;
  for (const r of rows) { if (r[0] < t || (heard != null && r[0] > heard + 1000)) continue; if (r[1] < 0.004) { run ??= r[0]; gap = Math.max(gap, r[0] - run + 5.3); } else run = null; }
  const old = heard == null ? null : rows.filter((r) => r[0] > heard + 50 && r[0] < heard + 3000 && r[2 + was] > 0.3 * r[2 + now]).length * 5.3;
  const fr = H.frames.filter((f) => f[0] >= t - 200 && f[0] < until);
  let pause = 0; for (let i = 1; i < fr.length; i++) pause = Math.max(pause, fr[i][0] - fr[i - 1][0]);
  return { from: pitches[was], to: pitches[now], heardMs: heard == null ? null : Math.round(heard - t), gapMs: Math.round(gap), oldAfterMs: old == null ? null : Math.round(old), picturePauseMs: Math.round(pause), syncMs: sync(H, rows, (heard ?? t) + 500, until) };
}
const mode = (xs) => { const c = {}; for (const x of xs) if (x >= 0) c[x] = (c[x] || 0) + 1; return +(Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] ?? -1); };

/** The sound's marks (a level five times the 100 ms before) against the film's clock from the frames: median ms late. */
function sync(H, rows, from, until) {
  const fr = H.frames, out = [];
  for (let i = 20; i < rows.length; i++) {
    const r = rows[i]; if (r[0] < from || r[0] > until) continue;
    const before = rows.slice(i - 20, i - 2).map((x) => x[1]).sort((a, b) => a - b)[9];
    if (!(r[1] > 0.02 && r[1] > 5 * before && rows[i - 1][1] <= 5 * before)) continue;
    const near = fr.filter((f) => Math.abs(f[0] - r[0]) < 1000); if (near.length < 10) continue;
    const m = near.map((f) => f[1] - f[0] / 1000).sort((a, b) => a - b)[near.length >> 1] + r[0] / 1000, n = Math.round(m);
    if (Math.abs(m - n) < 0.3) out.push((m - n) * 1000 - 2.7); // a hop's level ends 2.7 ms (half a hop) after it begins
  }
  return out.length >= 3 ? Math.round(out.sort((a, b) => a - b)[out.length >> 1]) : null;
}

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox', '--headless=new'] });
  for (const f of args) {
    const p = await b.newPage();
    await p.addInitScript(`window.__REC = ${JSON.stringify(REC)};`);
    await p.addInitScript(ears, order ? pitches : null);
    if (+process.env.CPU > 1) await (await p.context().newCDPSession(p)).send('Emulation.setCPUThrottlingRate', { rate: +process.env.CPU });
    await p.goto(`${process.env.BASE || 'http://127.0.0.1:8080'}/astra/lab/?src=${encodeURIComponent((process.env.FILMS || 'http://127.0.0.1:8090') + '/' + f)}&autoplay=1${order ? `&t=${at}` : ''}`);
    await p.waitForFunction((at) => document.getElementById('video').currentTime > at + 2, order ? at : 0, { timeout: 60000 }).catch(() => {});
    if (!order) {
      await p.waitForTimeout(1500);
      const r = await p.evaluate(() => ({ mode: window.astraLab?.player?.plan?.mode ?? '?', taps: window.__taps.map((a) => {
        const fr = new Float32Array(a.frequencyBinCount), t = new Float32Array(a.fftSize); a.getFloatFrequencyData(fr); a.getFloatTimeDomainData(t);
        let k = 0; for (let i = 1; i < fr.length; i++) if (fr[i] > fr[k]) k = i;
        let s = 0; for (const v of t) s += v * v;
        return { hz: Math.round(k * a.context.sampleRate / a.fftSize), rms: +Math.sqrt(s / t.length).toFixed(3) };
      }) }));
      console.log(f.padEnd(26), r.mode.padEnd(10), JSON.stringify(r.taps));
      await p.close();
      continue;
    }
    // The film's own sound through a graph of ours when nothing of the page's reaches the speakers (Astra's own route).
    await p.evaluate(async () => {
      const v = document.getElementById('video');
      if (!window.__taps.length) { const ctx = new AudioContext(); ctx.createMediaElementSource(v).connect(ctx.destination); await ctx.resume(); }
      v.requestVideoFrameCallback(function each(now, meta) { window.__heard.frames.push([meta.expectedDisplayTime, meta.mediaTime]); v.requestVideoFrameCallback(each); });
    });
    await p.waitForTimeout(2000);
    const tracks = await p.evaluate(() => window.astraLab.player.audioOptions().map((a) => [a.id, a.label, a.delivery]));
    for (const i of order.split(',').map(Number)) {
      await p.evaluate((id) => { window.__heard.switches.push([performance.now(), id]); window.astraLab.player.selectAudio(id); }, tracks[i][0]);
      await p.waitForTimeout(every * 1000);
    }
    const H = await p.evaluate(() => window.__heard), end = await p.evaluate(() => performance.now());
    console.log(f, tracks.map((t) => `${t[1]} (${t[2]})`).join(', '));
    H.switches.forEach(([t, id], n) => {
      const r = judge(H, [t, null, null], H.switches[n + 1]?.[0] ?? end);
      console.log(`  ${tracks.find((x) => x[0] === id)?.[1]?.padEnd(12)} ${JSON.stringify(r)}`);
    });
    await p.close();
  }
  await b.close();
})();

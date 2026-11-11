// The sound that really reaches the speakers, whichever way Astra plays the film (the software decoder
// has its own audio graph, which tone.cjs, listening to the video element, cannot hear):
// node heard.cjs <file>...   Each line: the loudest pitch (the test films' tone is 440 Hz), the level, the mode.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox', '--headless=new'] });
  for (const f of process.argv.slice(2)) {
    const p = await b.newPage();
    // Every node wired to the speakers, or to the stream the video element plays, is wired to a listener of ours too.
    await p.addInitScript(() => {
      window.__taps = [];
      const connect = AudioNode.prototype.connect;
      AudioNode.prototype.connect = function (to, ...rest) {
        if ((to instanceof AudioDestinationNode || to instanceof MediaStreamAudioDestinationNode) && !this.__tapped) {
          this.__tapped = true;
          const a = this.context.createAnalyser(); a.fftSize = 8192;
          connect.call(this, a); window.__taps.push(a);
        }
        return connect.call(this, to, ...rest);
      };
    });
    await p.goto(`http://127.0.0.1:8080/astra/lab/?src=${encodeURIComponent('http://127.0.0.1:8090/' + f)}&autoplay=1`);
    await p.waitForFunction(() => document.getElementById('video').currentTime > 2, null, { timeout: 40000 }).catch(() => {});
    await p.waitForTimeout(1500);
    const r = await p.evaluate(() => ({ mode: window.astraLab?.player?.plan?.mode ?? '?', taps: window.__taps.map((a) => {
      const fr = new Float32Array(a.frequencyBinCount), t = new Float32Array(a.fftSize); a.getFloatFrequencyData(fr); a.getFloatTimeDomainData(t);
      let k = 0; for (let i = 1; i < fr.length; i++) if (fr[i] > fr[k]) k = i;
      let s = 0; for (const v of t) s += v * v;
      return { hz: Math.round(k * a.context.sampleRate / a.fftSize), rms: +Math.sqrt(s / t.length).toFixed(3) };
    }) }));
    console.log(f.padEnd(26), r.mode.padEnd(10), JSON.stringify(r.taps));
    await p.close();
  }
  await b.close();
})();

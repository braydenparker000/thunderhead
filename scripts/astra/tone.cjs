// The sound a film really makes through Astra: its loudest pitch and its level, each side: node tone.cjs <file>...
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox', '--headless=new'] });
  for (const f of process.argv.slice(2)) {
    const p = await b.newPage();
    await p.goto(`http://127.0.0.1:8080/astra/lab/?src=${encodeURIComponent('http://127.0.0.1:8090/' + f)}&autoplay=1`);
    await p.waitForFunction(() => document.getElementById('video').currentTime > 1.5, null, { timeout: 30000 }).catch(() => {});
    const r = await p.evaluate(async () => { const v = document.getElementById('video'), ctx = new AudioContext(); await ctx.resume(); const src = ctx.createMediaElementSource(v), split = ctx.createChannelSplitter(2); src.connect(split); src.connect(ctx.destination);
      const side = (i) => { const a = ctx.createAnalyser(); a.fftSize = 8192; split.connect(a, i); return a; }; const an = [side(0), side(1)]; await new Promise((q) => setTimeout(q, 1500));
      return an.map((a) => { const fr = new Float32Array(a.frequencyBinCount), t = new Float32Array(a.fftSize); a.getFloatFrequencyData(fr); a.getFloatTimeDomainData(t); let k = 0; for (let i = 1; i < fr.length; i++) if (fr[i] > fr[k]) k = i; return { hz: Math.round(k * ctx.sampleRate / a.fftSize), rms: +Math.sqrt(t.reduce((n, x) => n + x * x, 0) / t.length).toFixed(3) }; }).concat(window.astraLab.player.mode); });
    console.log(f.padEnd(26), JSON.stringify(r)); await p.close();
  }
  await b.close();
})();

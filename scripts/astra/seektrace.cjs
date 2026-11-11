// What a far seek waits for: node seektrace.cjs <file> <to> [cpu] [net]
const { chromium } = require('playwright');
const [f, to = '120', cpu = '1', net = '0'] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox', '--headless=new'] });
  const p = await b.newPage(); p.on('console', (m) => { if (/need block/.test(m.text())) console.log(m.text()); }); const cdp = await p.context().newCDPSession(p);
  if (+cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: +cpu });
  if (+net > 0) { await cdp.send('Network.enable'); await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: +net, uploadThroughput: 1e6 }); }
  p.on('requestfailed', (r) => { if (t0 && r.url().includes(':8090/')) console.log(String(Date.now() - t0).padStart(6), 'cut', r.headers().range); });
  let t0 = 0; p.on('request', (r) => { if (t0 && r.url().includes(':8090/')) console.log(String(Date.now() - t0).padStart(6), 'GET', r.headers().range); });
  await p.goto(`http://127.0.0.1:8080/astra/lab/?src=${encodeURIComponent('http://127.0.0.1:8090/' + f)}&autoplay=1`);
  await p.waitForFunction(() => document.getElementById('video').currentTime > 4, null, { timeout: 60000 });
  t0 = Date.now();
  await p.evaluate((t) => { const v = document.getElementById('video'); window.__k = { at: performance.now(), ev: [] }; const src = window.astraLab.player.probed.source, ob = src.block.bind(src); src.block = (i) => { if (!src.blocks.has(i)) console.log('  need block', i, 'at', Math.round(performance.now() - window.__k.at), 'streams', [...src.streams].map((x) => (x.position / 1048576).toFixed(1) + (x.used ? '' : '(old)')).join(' ')); return ob(i); }; for (const e of ['seeked', 'playing', 'waiting']) v.addEventListener(e, () => window.__k.ev.push([Math.round(performance.now() - window.__k.at), e])); v.requestVideoFrameCallback(function each(now, m) { if (m.mediaTime >= t - 0.5 && !window.__k.frame) window.__k.frame = Math.round(now - window.__k.at); v.requestVideoFrameCallback(each); }); v.currentTime = t; }, +to);
  let last = '';
  for (let i = 0; i < 100; i++) { await p.waitForTimeout(100);
    const s = await p.evaluate((t) => { const q = window.astraLab.player.session?.queues, k = window.__k; const has = (x) => { try { const r = x.buffer.buffered; for (let i = 0; i < r.length; i++) if (r.start(i) <= t + 0.1 && r.end(i) > t) return `${r.start(i).toFixed(1)}-${r.end(i).toFixed(1)}`; } catch {} return '-'; };
      return { ms: Math.round(performance.now() - k.at), v: q?.video ? has(q.video) : 'n/a', a: q?.audio ? has(q.audio) : 'n/a', ev: k.ev.map((e) => e.join(' ')).join(', '), frame: k.frame }; }, +to);
    const line = `video ${s.v}  audio ${s.a}  ${s.ev}  frame ${s.frame}`; if (line !== last) { console.log(String(s.ms).padStart(6), line); last = line; } if (s.frame) break; }
  await b.close();
})();

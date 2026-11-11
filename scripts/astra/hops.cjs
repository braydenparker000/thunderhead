// Many seeks inside and outside the buffer, each checked for a picture at the place and no error: node hops.cjs <file> [count]
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox', '--headless=new'] });
  const p = await b.newPage(); p.on('pageerror', (e) => console.log('PAGE ERROR', e.message.slice(0, 200)));
  await p.goto(`http://127.0.0.1:8080/astra/lab/?src=${encodeURIComponent('http://127.0.0.1:8090/' + process.argv[2])}&autoplay=1`);
  await p.waitForFunction(() => document.getElementById('video').currentTime > 2, null, { timeout: 60000 });
  const dur = await p.evaluate(() => document.getElementById('video').duration), n = +(process.argv[3] || 14); let bad = 0, worst = 0; const lat = [];
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < n; i++) {
    // two of three land inside what is buffered, at any frame, not only at key frames
    const to = await p.evaluate(([r1, r2, d]) => { const v = document.getElementById('video'), bf = v.buffered; let t; if (r1 < 0.67 && bf.length) { const k = Math.floor(r2 * bf.length); t = bf.start(k) + r2 * Math.max(0, bf.end(k) - bf.start(k) - 0.5); } else t = r2 * (d - 3); return +t.toFixed(3); }, [rnd(), rnd(), dur]);
    const r = await p.evaluate((t) => new Promise((done) => { const v = document.getElementById('video'), t0 = performance.now(); let got = false;
      const each = (now, m) => { if (!got && Math.abs(m.mediaTime - t) < 0.75) { got = true; done({ ms: Math.round(now - t0), at: +m.mediaTime.toFixed(3) }); } else if (!got) v.requestVideoFrameCallback(each); };
      v.requestVideoFrameCallback(each); v.currentTime = t; setTimeout(() => { if (!got) { got = true; done({ ms: -1, err: v.error?.message, rs: v.readyState, t: v.currentTime }); } }, 8000); }), to);
    if (r.ms < 0) { bad++; console.log('  seek to', to, 'FAILED', JSON.stringify(r)); } else { lat.push(r.ms); worst = Math.max(worst, r.ms); }
    await p.waitForTimeout(350);
  }
  const end = await p.evaluate(() => { const v = document.getElementById('video'), pl = window.astraLab.player, q = v.getVideoPlaybackQuality(); return { mode: pl.mode, err: v.error?.message || null, log: pl.log.filter((x) => /error|resume|fallback/.test(x.kind)).map((x) => `${x.kind} ${JSON.stringify(x.detail).slice(0, 120)}`), dropped: q.droppedVideoFrames, corrupted: q.corruptedVideoFrames, restarts: pl.session?.stats?.restarts }; });
  lat.sort((a, b) => a - b); console.log(process.argv[2].padEnd(30), `${n - bad}/${n} seeks landed, median ${lat[lat.length >> 1]} ms, worst ${worst} ms`, JSON.stringify(end));
  await b.close();
})();

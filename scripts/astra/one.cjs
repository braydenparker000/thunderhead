// One test film through the lab page, with the player's own log and every failed request: node one.cjs <file> [seconds] [seek to]
const { chromium } = require('playwright');
const SITE = process.env.BASE || 'http://127.0.0.1:8080', FILMS = process.env.FILMS || 'http://127.0.0.1:8090', f = process.argv[2], secs = +(process.argv[3] || 6), seek = process.argv[4];
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox', '--headless=new'] });
  const ctx = await b.newContext({ viewport: { width: 800, height: 450 } }), p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('PAGE ERROR', e.message.slice(0, 300), (e.stack || '').split('\n').slice(1, 4).join(' | ').slice(0, 300))); p.on('console', (m) => { if (process.env.ALL || /error|warn/.test(m.type())) console.log(m.type().toUpperCase(), m.text().slice(0, 400)); });
  ctx.on('response', (r) => { if (r.status() >= 400) console.log('HTTP', r.status(), r.url().slice(0, 140)); }); ctx.on('requestfailed', (r) => console.log('FAILED', r.url().slice(0, 120), r.failure()?.errorText));
  if (process.env.ALL) await p.addInitScript(() => { globalThis.ASTRA_DECODER_LOG = 1; });
  await p.goto(`${SITE}/astra/lab/?src=${encodeURIComponent(FILMS + '/' + f)}&autoplay=1`);
  await p.waitForTimeout(secs * 1000);
  if (seek) { await p.evaluate((t) => { document.getElementById('video').currentTime = t; }, +seek); await p.waitForTimeout(3000); }
  const st = await p.evaluate(() => { const v = document.getElementById('video'), pl = window.astraLab.player, b = v.buffered; return { mode: pl.mode, t: v.currentTime, paused: v.paused, rs: v.readyState, w: v.videoWidth, buffered: Array.from({ length: b.length }, (_, i) => [b.start(i).toFixed(2), b.end(i).toFixed(2)]), err: v.error && [v.error.code, v.error.message], q: v.getVideoPlaybackQuality && [v.getVideoPlaybackQuality().totalVideoFrames, v.getVideoPlaybackQuality().droppedVideoFrames],
    info: pl.info && { container: pl.info.container, video: (pl.info.video || []).map((x) => [x.codec, x.codecString, x.label]), audio: (pl.info.audio || []).map((x) => [x.codec, x.codecString, x.channels, x.label]) }, log: pl.log.map((x) => `${x.t} ${x.kind} ${JSON.stringify(x.detail).slice(0, 260)}`) }; });
  console.log(JSON.stringify({ ...st, log: undefined }, null, 0)); console.log(st.log.join('\n'));
  await b.close();
})();

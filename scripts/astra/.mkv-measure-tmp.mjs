// scratch (removed after use): bytes and time before the first picture, Astra's Matroska reader vs Mediabunny's
import { chromium } from 'playwright';
import { serve } from '../serve.mjs';
import { astraHost } from '../../tests/fixtures/astra-host.mjs';
const dir = process.argv[2], bps = +process.argv[3], cases = JSON.parse(process.argv[4]);
const site = await serve(0, {}); const base = `http://127.0.0.1:${site.address().port}`;
const host = await astraHost({ root: dir + '/' });
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'], executablePath: process.env.CHROMIUM_PATH });
for (const [film, at, how] of cases) for (const own of [false, true]) {
  const page = await browser.newPage();
  await page.goto(`${base}/astra/lab/`);
  await page.evaluate(async (own) => {
    const { TUNING } = await import('/astra/src/engine/remux.js'); TUNING.ownMkv = own;
    const { AstraPlayer } = await import('/astra/src/engine/player.js');
    const video = Object.assign(document.createElement('video'), { muted: true, playsInline: true });
    document.body.append(video);
    window.p = new AstraPlayer(video, document.createElement('div'));
    window.errors = []; window.p.addEventListener('error', (e) => window.errors.push(e.detail.message));
  }, own);
  host.reset(); host.control.bps = 0;
  let target = at;
  if (how === 'seek') { // play from the start at full speed a moment, then pace the host and seek
    await page.evaluate((u) => window.p.load({ url: u, autoplay: true }), host.url(film));
    await page.waitForFunction(() => window.p.video.currentTime > 1, null, { timeout: 60000 });
    await page.evaluate(() => window.p.video.pause());
  }
  host.control.bps = bps;
  const b0 = host.stats.bytes, t0 = Date.now();
  if (how === 'seek') await page.evaluate((at) => { window.p.video.currentTime = at; window.p.video.play(); }, at);
  else await page.evaluate(([u, at]) => window.p.load({ url: u, autoplay: true, startTime: at }), [host.url(film), at]);
  let ms = null, bytes = null;
  for (const until = Date.now() + 90000; Date.now() < until;) {
    const s = await page.evaluate((at) => { const v = window.p.video; return v.readyState >= 2 && v.videoWidth > 0 && v.currentTime >= at - 0.05 && !v.seeking; }, target);
    if (s) { ms = Date.now() - t0; bytes = host.stats.bytes - b0; break; }
    if (process.env.TRACE && (Date.now() - t0) % 2000 < 45) console.log(Date.now() - t0, host.stats.bytes - b0, await page.evaluate(() => { const v = window.p.video, q = window.p.session?.queues || {}; const r = (b) => { try { return [...Array(b.buffered.length)].map((_, i) => [b.buffered.start(i).toFixed(2), b.buffered.end(i).toFixed(2)]).join(' '); } catch { return '?'; } }; return JSON.stringify({ t: v.currentTime, rs: v.readyState, seeking: v.seeking, v: q.video && r(q.video.buffer), a: q.audio && r(q.audio.buffer), readAt: window.p.session?.readAt, mode: window.p.mode }); }));
    await new Promise((r) => setTimeout(r, 40));
  }
  const info = await page.evaluate(() => ({ own: !!window.p.session?.packets, fallback: window.p.session?.stats?.fallback, errors: window.errors }));
  console.log(JSON.stringify(host.stats.ranges.slice(0, 30)));
  console.log(JSON.stringify({ film, at, how, reader: own ? 'astra' : 'mediabunny', ms, kB: bytes && Math.round(bytes / 1000), ...info }));
  await page.close();
}
await browser.close(); site.close(); await host.close();

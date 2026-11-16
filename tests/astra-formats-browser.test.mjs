// Kinds of file only the software decoder plays, each through a small patch to libmedia's readers
// (frontend/assets/libmedia/licenses/libmedia-modifications.txt): H.264 in an AVI with no decoder setup in its
// header, H.263 in 3GP, Windows Media Audio in an MKV. Each must show a moving picture and be heard at its own
// pitch, measured at libmedia's own sound output. The films are made by scripts/astra/fixtures.sh.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { astraHost } from './fixtures/astra-host.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (synthetic films)', timeout: 60_000 };
let site, host, browser, base;

before(async () => {
  if (live) return;
  site = await serve(0, {});
  base = `http://127.0.0.1:${site.address().port}`;
  host = await astraHost();
  browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'], ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
});
after(async () => { await browser?.close(); site?.close(); await host?.close(); });

/** Plays one film with an engine player on the lab page; returns its mode, the first error, two looks at the picture and the loudest pitch heard. */
async function play(t, name) {
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  t.after(() => page.close());
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/astra/lab/`);
  const r = await page.evaluate(async (url) => {
    const { AstraPlayer } = await import('/astra/src/engine/player.js');
    const video = Object.assign(document.createElement('video'), { playsInline: true });
    const layer = document.createElement('div');
    document.body.append(video, layer);
    const p = (window.p = new AstraPlayer(video, layer)), seen = [];
    p.addEventListener('error', (e) => seen.push(e.detail.message));
    const ready = new Promise((r) => p.addEventListener('ready', r, { once: true }));
    p.load({ url });
    await Promise.race([ready, new Promise((r) => setTimeout(r, 20_000))]);
    if (p.mode !== 'software' || seen.length) return { mode: p.mode, error: seen[0] || p.plan?.reason || '' };
    video.muted = false; await video.play().catch(() => {});
    const until = performance.now() + 10_000;
    while (!(p.session?.engine?.gainNode && video.currentTime > 1) && performance.now() < until) await new Promise((r) => setTimeout(r, 100));
    const look = () => { const c = document.createElement('canvas'); c.width = 64; c.height = 36; const g = c.getContext('2d'); g.drawImage(video, 0, 0, 64, 36); const d = g.getImageData(0, 0, 64, 36).data; let s = 0, h = 0; for (let i = 0; i < d.length; i += 4) { s += d[i] + d[i + 1] + d[i + 2]; h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) >>> 0; } return [Math.round(s / (64 * 36 * 3)), h]; };
    const first = look();
    // The loudest pitch at libmedia's own output, over a second.
    const ctx = p.session.AVPlayer.audioContext, a = ctx.createAnalyser();
    a.fftSize = 8192; p.session.engine.gainNode.connect(a);
    const bins = new Float32Array(a.frequencyBinCount), sum = new Float32Array(a.frequencyBinCount);
    for (const end = performance.now() + 1000; performance.now() < end;) { await new Promise((r) => setTimeout(r, 100)); a.getFloatFrequencyData(bins); bins.forEach((v, i) => { sum[i] += Math.pow(10, v / 20); }); }
    let peak = 1; for (let i = 2; i < sum.length; i++) if (sum[i] > sum[peak]) peak = i;
    return { mode: p.mode, error: seen[0] || '', first, second: look(), hz: Math.round(peak * ctx.sampleRate / a.fftSize), level: sum[peak], t: video.currentTime };
  }, host.url(name));
  t.diagnostic(`${name}: ${JSON.stringify(r)}`);
  return { ...r, errors };
}

for (const [name, hz, kind] of [['h264.avi', 440, 'H.264 in an AVI with no decoder setup in its header, MP3'], ['h263.3gp', 550, 'H.263 in 3GP, AAC'], ['wma.mkv', 660, 'H.264 with Windows Media Audio in an MKV']]) {
  test(`software decoder: ${kind} shows a moving picture and is heard at ${hz} Hz`, opts, async (t) => {
    const r = await play(t, name);
    if (r.mode !== 'software' && !r.error) return t.skip(`this browser does not run the software decoder (${r.mode})`);
    assert.equal(r.error, '', 'no error');
    assert.equal(r.mode, 'software');
    assert.ok(r.t > 1, `it plays on (${r.t} s)`);
    assert.ok(r.first[0] > 10 && r.second[0] > 10, 'there is a picture, not black');
    assert.notEqual(r.first[1], r.second[1], 'the picture moves');
    assert.ok(Math.abs(r.hz - hz) < 15, `the tone is heard at its pitch (${r.hz} Hz)`);
    assert.deepEqual(r.errors, []);
  });
}

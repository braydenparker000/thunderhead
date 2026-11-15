// Astra's sound and picture enhancements (frontend/astra/src/enhance/) on real films played by the
// real engine in a real browser, from the file host on another origin (tests/fixtures/astra-host.mjs).
// Sound is measured with an AnalyserNode after the chain; the picture by reading the canvas back.
// centre.mkv (5.1 AAC, a 1 kHz tone in the centre channel only, 8 s) was made with:
//   ffmpeg -f lavfi -i testsrc2=size=320x180:rate=12:duration=8 -f lavfi -i sine=frequency=1000:sample_rate=48000:duration=8
//     -filter_complex "[1]pan=5.1|FC=c0[a]" -map 0:v -map "[a]" -c:v libx264 -preset veryslow -profile:v main
//     -pix_fmt yuv420p -b:v 40k -g 24 -bf 2 -c:a aac -b:a 64k centre.mkv
// Local only: nothing here reaches the internet.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { astraHost } from './fixtures/astra-host.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (synthetic films)' };
let site, host, browser, base, h264 = false;

before(async () => {
  if (live) return;
  site = await serve(0, {});
  base = `http://127.0.0.1:${site.address().port}`;
  host = await astraHost();
  browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'], ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  const page = await browser.newPage();
  h264 = await page.evaluate(() => MediaSource.isTypeSupported('video/mp4; codecs="avc1.4d400d"'));
  await page.close();
});
after(async () => { await browser?.close(); site?.close(); await host?.close(); });

/** A page of the real site with helpers: `film(url)` plays a film through the engine (sound on) and `level(analyser)` reads dB. */
async function page(t) {
  host.reset();
  const p = await browser.newPage({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 2 });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  t.after(() => p.close());
  await p.goto(`${base}/astra/lab/`);
  await p.evaluate(() => {
    window.wait = (ms) => new Promise((r) => setTimeout(r, ms));
    window.level = (a) => { const b = new Float32Array(a.fftSize); a.getFloatTimeDomainData(b); return 10 * Math.log10(b.reduce((s, x) => s + x * x, 0) / b.length + 1e-18); };
    window.film = async (url, startTime = 0) => {
      const { AstraPlayer } = await import('/astra/src/engine/player.js');
      const video = Object.assign(document.createElement('video'), { playsInline: true });
      Object.assign(video.style, { position: 'absolute', left: '0', top: '0', width: '640px', height: '360px', objectFit: 'contain' });
      const layer = document.createElement('div');
      Object.assign(layer.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
      document.body.append(video, layer);
      const player = new AstraPlayer(video, document.createElement('div'));
      const ready = new Promise((r) => player.addEventListener('ready', r, { once: true }));
      player.load({ url, autoplay: false, startTime });
      await ready;
      await video.play();
      await new Promise((r) => { const on = () => (video.currentTime > startTime + 0.3 ? r() : setTimeout(on, 50)); on(); });
      return { video, layer, player };
    };
  });
  return { page: p, errors };
}

test('sound: a straight wire when off, boost, delay, and the film still heard after close', opts, async (t) => {
  if (!h264) return t.skip('this browser has no H.264 decoder');
  const { page: p, errors } = await page(t);
  const r = await p.evaluate(async (url) => {
    const { Sound } = await import('/astra/src/enhance/sound.js');
    const out = {};
    const { video, player } = await film(url);
    const sound = new Sound(video); sound.mode = player.mode;
    sound.set({ delay: 0.001 }); await wait(100); sound.set({ delay: 0 });
    // The level with no chain (the element's own sound, straight from its source node) and after it, read at once.
    const ctx = sound.ctx, a = ctx.createAnalyser(), raw = ctx.createAnalyser(); a.fftSize = raw.fftSize = 8192;
    sound.chain.out.connect(a); sound.source.connect(raw);
    await wait(400); out.off = level(a); out.plain = level(raw);
    sound.set({ night: true }); await wait(300); sound.set({ night: false, dialogue: 1 }); await wait(300); sound.set({ dialogue: 0 }); await wait(300);
    out.again = level(a); out.plainAgain = level(raw);
    sound.set({ boost: 2 }); await wait(600); out.boost = level(a); out.off2 = level(raw);
    sound.set({ boost: 1, delay: 0.5 });
    // A click: the film paused to silence, then played. Its arrival before and after the chain.
    const pre = ctx.createAnalyser(), post = ctx.createAnalyser(); pre.fftSize = post.fftSize = 256;
    sound.source.connect(pre); sound.chain.out.connect(post);
    video.pause(); await wait(900);
    const at = {}; const t0 = performance.now(); video.play();
    while (performance.now() - t0 < 3000 && !(at.pre && at.post)) { if (!at.pre && level(pre) > -60) at.pre = performance.now(); if (!at.post && level(post) > -60) at.post = performance.now(); await wait(4); }
    out.shift = (at.post - at.pre) / 1000;
    sound.close(); await wait(400); out.closed = level(a); out.rawClosed = level(raw); out.state = sound.state();
    return out;
  }, host.url('multi.mkv'));
  t.diagnostic(`dB: plain ${r.plain.toFixed(2)}, off ${r.off.toFixed(2)}, boost 2 ${r.boost.toFixed(2)} (raw ${r.off2.toFixed(2)}); delay 0.5 s moved the click ${r.shift.toFixed(3)} s`);
  assert.ok(Math.abs(r.off - r.plain) < 0.5, `all off sounds as with no chain (${r.off.toFixed(2)} vs ${r.plain.toFixed(2)} dB)`);
  assert.ok(Math.abs(r.again - r.plainAgain) < 0.5, 'and again after other features were on and off');
  assert.ok(Math.abs(r.boost - r.off2 - 6) < 0.5, `boost 2 is about +6 dB over the sound at the same moment (${(r.boost - r.off2).toFixed(2)})`);
  assert.ok(Math.abs(r.shift - 0.5) < 0.1, `a delay of 0.5 s moves the click by that (${r.shift})`);
  assert.ok(Math.abs(r.closed - r.rawClosed) < 0.5, `after close the film is heard as it is (${r.closed.toFixed(2)} vs ${r.rawClosed.toFixed(2)} dB)`);
  assert.equal(r.state.captured, true);
  assert.deepEqual(errors, []);
});

test('sound: 5.1 reaches the chain whole and dialogue lifts the centre; a film the page cannot read is left alone', opts, async (t) => {
  if (!h264) return t.skip('this browser has no H.264 decoder');
  const { page: p, errors } = await page(t);
  const r = await p.evaluate(async ([centre, plain]) => {
    const { Sound, canProcess } = await import('/astra/src/enhance/sound.js');
    const out = {};
    const { video, player } = await film(centre);
    const sound = new Sound(video); sound.mode = player.mode;
    sound.set({ delay: 0.001 }); await wait(100); sound.set({ delay: 0 });
    // What two speakers get: the browser's own down-mix of whatever the chain hands on.
    const ctx = sound.ctx, speakers = Object.assign(ctx.createGain(), { channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers' });
    const a = ctx.createAnalyser(); a.fftSize = 8192; sound.chain.out.connect(speakers); speakers.connect(a);
    await wait(400); out.flat = level(a);
    sound.set({ dialogue: 1 }); await wait(900); out.one = level(a); out.channels = sound.state().channels;
    sound.set({ dialogue: 2 }); await wait(400); out.two = level(a);
    player.destroy();
    // plain.mp4 plays natively from the other origin: its sound would be silence through Web Audio.
    const other = await film(plain);
    const refused = new Sound(other.video, { onReport: (why) => (out.why = why) }); refused.mode = other.player.mode;
    out.mode = other.player.mode; out.can = canProcess(other.video, other.player.mode);
    out.set = refused.set({ boost: 2 }); out.captured = refused.state().captured; out.ctx = refused.ctx;
    return out;
  }, [host.url('centre.mkv'), host.url('plain.mp4')]);
  t.diagnostic(`centre dB: flat ${r.flat.toFixed(2)}, one step ${r.one.toFixed(2)}, two ${r.two.toFixed(2)}; channels ${r.channels}`);
  assert.equal(r.channels, 6, 'the element hands Web Audio all six channels');
  assert.ok(Math.abs(r.one - r.flat - 4) < 1, `one step lifts the centre by about 4 dB (${(r.one - r.flat).toFixed(2)})`);
  assert.ok(Math.abs(r.two - r.flat - 8) < 1, `two steps by about 8 dB (${(r.two - r.flat).toFixed(2)})`);
  assert.equal(r.mode, 'native');
  assert.equal(r.can, false);
  assert.equal(r.set, false);
  assert.equal(r.captured, false, 'no source node was made');
  assert.equal(r.ctx, null, 'not even an AudioContext');
  assert.match(r.why, /host/);
  assert.deepEqual(errors, []);
});

test('picture: a canvas over the video with the film\'s colours and sharper edges; off removes it; a film it may not read turns it off', opts, async (t) => {
  if (!h264) return t.skip('this browser has no H.264 decoder');
  const { page: p, errors } = await page(t);
  const r = await p.evaluate(async (url) => {
    const { Picture } = await import('/astra/src/enhance/picture.js');
    const out = { reports: [] };
    const { video, layer } = await film(url, 5);
    const pic = new Picture(video, layer, { onReport: (why) => out.reports.push(why) });
    pic.set({ sharpen: 1 });
    // Paused on a known frame (5 s: the bars with nothing crossing them at a third of the height).
    video.pause(); video.currentTime = 5; await new Promise((r) => video.addEventListener('seeked', r, { once: true }));
    await new Promise((r) => { const on = () => (pic.canvas?.isConnected ? r() : setTimeout(on, 50)); on(); });
    await wait(200);
    const box = video.getBoundingClientRect(), cb = pic.canvas.getBoundingClientRect();
    out.box = [box.left, box.top, box.width, box.height]; out.canvasBox = [cb.left, cb.top, cb.width, cb.height];
    out.fit = getComputedStyle(pic.canvas).objectFit;
    pic.draw();
    const gl = pic.filter.gl, W = pic.canvas.width, H = pic.canvas.height, px = new Uint8Array(W * H * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    out.size = [W, H];
    const ref = Object.assign(document.createElement('canvas'), { width: W, height: H }).getContext('2d');
    ref.imageSmoothingQuality = 'low'; ref.drawImage(video, 0, 0, W, H);
    const rp = ref.getImageData(0, 0, W, H).data, y = Math.round(H / 3);
    const at = (x) => { const i = ((H - 1 - y) * W + x) * 4; return [px[i], px[i + 1], px[i + 2]]; };
    const bilinear = (x) => { const i = (y * W + x) * 4; return [rp[i], rp[i + 1], rp[i + 2]]; };
    out.bars = [25, 80, 133, 186, 240, 293].map((x) => at(Math.round((x * W) / 320)));
    const lum = (c) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
    const steepest = (get) => { let m = 0; const e = Math.round(W / 2); for (let x = e - 16; x < e + 16; x++) m = Math.max(m, Math.abs(lum(get(x + 1)) - lum(get(x)))); return m; };
    out.edge = { filter: steepest(at), bilinear: steepest(bilinear) };
    pic.set({ sharpen: 0 }); out.off = !!layer.querySelector('canvas');
    // A frame the page may not read: texImage2D throws SecurityError once.
    pic.set({ sharpen: 1, deband: true }); await wait(100);
    const proto = WebGL2RenderingContext.prototype, real = proto.texImage2D;
    proto.texImage2D = function () { proto.texImage2D = real; throw new DOMException('The video element contains cross-origin data.', 'SecurityError'); };
    video.play(); await wait(600);
    proto.texImage2D = real;
    out.refused = pic.state(); out.left = !!layer.querySelector('canvas');
    pic.close();
    return out;
  }, host.url('multi.mkv'));
  t.diagnostic(`steepest step across an edge: filter ${r.edge.filter.toFixed(1)}, bilinear ${r.edge.bilinear.toFixed(1)}; bars ${JSON.stringify(r.bars)}`);
  assert.deepEqual(r.canvasBox, r.box, 'the canvas covers the video\'s box');
  assert.equal(r.fit, 'contain', 'and fits the picture as the video does');
  assert.deepEqual(r.size, [1280, 720], 'drawn at the size the picture is shown, in device pixels');
  const bars = [[255, 0, 0], [0, 255, 0], [255, 255, 0], [0, 0, 255], [255, 0, 255], [0, 255, 255]];
  r.bars.forEach((c, i) => assert.ok(c.every((v, k) => Math.abs(v - bars[i][k]) < 40), `bar ${i} is ${bars[i]} (drawn ${c})`));
  assert.ok(r.edge.filter > r.edge.bilinear * 1.3, `an edge is steeper than the plain bilinear upscale (${r.edge.filter.toFixed(1)} vs ${r.edge.bilinear.toFixed(1)})`);
  assert.equal(r.off, false, 'off: no canvas');
  assert.equal(r.refused.on, false, 'a SecurityError turns the filter off ');
  assert.equal(r.left, false, 'and the plain video shows');
  assert.match(r.refused.reason, /does not let the page read/);
  assert.deepEqual(errors, []);
});

// Astra's picture filter beyond FSR (frontend/astra/src/enhance/): the Anime4K upscale on a real film
// played by the real engine, and HDR films uploaded as half floats and tone-mapped (BT.2390), read
// back from the canvas in a real browser, from the file host on another origin.
// hdr-patches.webm (VP9 profile 2, PQ, BT.2020, 320x180, 1 s; grey patches at 5, 20, 100, 203 and
// 1000 nits on top, BT.2020 red, green, blue at 100 nits, grey at 400 and 50 below) was made from a
// raw frame written by a short numpy script (the PQ code values of those levels, limited range) with:
//   ffmpeg -f rawvideo -pix_fmt yuv420p10le -s 320x180 -r 24 -i frame.yuv -pix_fmt yuv420p10le
//     -color_primaries bt2020 -color_trc smpte2084 -colorspace bt2020nc -color_range tv
//     -c:v libvpx-vp9 -profile:v 2 -lossless 1 hdr-patches.webm
// hdr-hlg.webm (VP9 profile 2, HLG, BT.2020, 320x180, 1 s of flat grey) was made with:
//   ffmpeg -f lavfi -i color=c=0x808080:s=320x180:r=24:d=1 -pix_fmt yuv420p10le -color_primaries bt2020
//     -color_trc arib-std-b67 -colorspace bt2020nc -color_range tv -c:v libvpx-vp9 -profile:v 2 -lossless 1 hdr-hlg.webm
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

/** A page of the real site, the video in a 640 x 360 box at 2 device pixels per CSS pixel, with helpers. */
async function page(t) {
  host.reset();
  const p = await browser.newPage({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 2 });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  t.after(() => p.close());
  await p.goto(`${base}/astra/lab/`);
  await p.evaluate(() => {
    window.wait = (ms) => new Promise((r) => setTimeout(r, ms));
    window.box = () => {
      const video = Object.assign(document.createElement('video'), { playsInline: true, muted: true });
      Object.assign(video.style, { position: 'absolute', left: '0', top: '0', width: '640px', height: '360px', objectFit: 'contain' });
      const layer = document.createElement('div');
      Object.assign(layer.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
      document.body.append(video, layer);
      return { video, layer };
    };
    // The canvas as drawn (rows bottom-up) and the element's own picture, scaled by a 2D canvas, at one row.
    window.readRow = (pic, video, y) => {
      pic.draw();
      const gl = pic.filter.gl, W = pic.canvas.width, H = pic.canvas.height, px = new Uint8Array(W * H * 4);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const ref = Object.assign(document.createElement('canvas'), { width: W, height: H }).getContext('2d');
      ref.imageSmoothingQuality = 'low'; ref.drawImage(video, 0, 0, W, H);
      const rp = ref.getImageData(0, 0, W, H).data;
      return { W, H, at: (x) => { const i = ((H - 1 - y) * W + x) * 4; return [px[i], px[i + 1], px[i + 2]]; }, plain: (x) => { const i = (y * W + x) * 4; return [rp[i], rp[i + 1], rp[i + 2]]; } };
    };
  });
  return { page: p, errors };
}

test('picture: Animation (Anime4K) draws over the video with the film\'s colours and steeper edges, and steps down to Standard first', opts, async (t) => {
  if (!h264) return t.skip('this browser has no H.264 decoder');
  const { page: p, errors } = await page(t);
  const r = await p.evaluate(async (url) => {
    const { AstraPlayer } = await import('/astra/src/engine/player.js');
    const { Picture } = await import('/astra/src/enhance/picture.js');
    const out = { reports: [] };
    const { video, layer } = box();
    const player = new AstraPlayer(video, document.createElement('div'));
    const ready = new Promise((r) => player.addEventListener('ready', r, { once: true }));
    player.load({ url, autoplay: false, startTime: 5 });
    await ready;
    const pic = new Picture(video, layer, { onReport: (why) => out.reports.push(why) });
    pic.set({ upscale: 'anime' });
    // Paused on a known frame (5 s: the bars with nothing crossing them at a third of the height).
    video.currentTime = 5; await new Promise((r) => video.addEventListener('seeked', r, { once: true }));
    await new Promise((r) => { const on = () => (pic.canvas?.isConnected ? r() : setTimeout(on, 50)); on(); });
    await wait(200);
    const vb = video.getBoundingClientRect(), cb = pic.canvas.getBoundingClientRect();
    out.box = [vb.left, vb.top, vb.width, vb.height]; out.canvasBox = [cb.left, cb.top, cb.width, cb.height];
    const t0 = performance.now(); const row = readRow(pic, video, 240); out.ms = performance.now() - t0;
    out.state = pic.state(); out.size = [row.W, row.H];
    out.bars = [25, 80, 133, 186, 240, 293].map((x) => row.at(Math.round((x * row.W) / 320)));
    const lum = (c) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
    const steepest = (get) => { let m = 0; const e = Math.round(row.W / 2); for (let x = e - 16; x < e + 16; x++) m = Math.max(m, Math.abs(lum(get(x + 1)) - lum(get(x)))); return m; };
    out.edge = { filter: steepest(row.at), bilinear: steepest(row.plain) };
    // Frames dropping: the first step is Standard, everything else kept.
    pic.stepDown(); out.stepped = pic.state(); pic.draw(); out.after = pic.state();
    pic.stepDown(); out.second = pic.state();
    pic.close(); player.destroy();
    return out;
  }, host.url('multi.mkv'));
  t.diagnostic(`one Anime4K frame, 320x180 to ${r.size.join('x')}, ${r.ms.toFixed(0)} ms here (software GL); steepest step: Anime4K ${r.edge.filter.toFixed(1)}, bilinear ${r.edge.bilinear.toFixed(1)}; bars ${JSON.stringify(r.bars)}`);
  assert.equal(r.state.drawn, 'anime', 'Anime4K drew the picture');
  assert.deepEqual(r.canvasBox, r.box, 'the canvas covers the video\'s box');
  assert.deepEqual(r.size, [1280, 720], 'at the size the picture is shown, in device pixels');
  const bars = [[255, 0, 0], [0, 255, 0], [255, 255, 0], [0, 0, 255], [255, 0, 255], [0, 255, 255]];
  r.bars.forEach((c, i) => assert.ok(c.every((v, k) => Math.abs(v - bars[i][k]) < 40), `bar ${i} is ${bars[i]} (drawn ${c})`));
  assert.ok(r.edge.filter > r.edge.bilinear * 1.3, `an edge is steeper than the plain bilinear upscale (${r.edge.filter.toFixed(1)} vs ${r.edge.bilinear.toFixed(1)})`);
  assert.equal(r.stepped.on, true, 'stepping down keeps the filter on');
  assert.equal(r.stepped.fallback, 'slow');
  assert.equal(r.stepped.level, 0, 'nothing else was given up');
  assert.equal(r.after.drawn, 'standard', 'and the next frame is drawn by Standard (FSR)');
  assert.equal(r.second.level >= 2, true, 'the next step is the usual ladder');
  assert.deepEqual(r.reports, []);
  assert.deepEqual(errors, []);
});

test('picture: an HDR film is tone-mapped close to the browser\'s own picture, without clipping its highlights', opts, async (t) => {
  const { page: p, errors } = await page(t);
  const r = await p.evaluate(async (url) => {
    const { Picture } = await import('/astra/src/enhance/picture.js');
    const out = { reports: [] };
    const { video, layer } = box();
    video.crossOrigin = 'anonymous'; video.src = url;
    await new Promise((ok, no) => { video.onloadeddata = ok; video.onerror = () => no(Error('this browser cannot play the HDR clip')); }).catch((e) => (out.skip = e.message));
    if (out.skip) return out;
    video.currentTime = 0.5; await new Promise((r) => video.addEventListener('seeked', r, { once: true }));
    const pic = new Picture(video, layer, { onReport: (why) => out.reports.push(why), hdr: true });
    out.half = !pic.set({ sharpen: 0.35 }) ? 'refused' : 'drawn';
    await new Promise((r) => { const on = () => (pic.canvas?.isConnected || !pic.on ? r() : setTimeout(on, 50)); on(); });
    if (!pic.on) { out.state = pic.state(); return out; }
    const top = readRow(pic, video, 180), bottom = readRow(pic, video, 540);
    const xs = [32, 96, 160, 224, 288].map((x) => (x * top.W) / 320);
    out.greys = xs.map((x) => top.at(x)); out.plainGreys = xs.map((x) => top.plain(x));
    out.colours = xs.map((x) => bottom.at(x)); out.plainColours = xs.map((x) => bottom.plain(x));
    out.state = pic.state(); pic.close();
    return out;
  }, host.url('hdr-patches.webm'));
  if (r.skip) return t.skip(r.skip);
  t.diagnostic(`5/20/100/203/1000 nits: filter ${r.greys?.map((c) => c[0]).join('/')}, browser ${r.plainGreys?.map((c) => c[0]).join('/')}; colours filter ${JSON.stringify(r.colours)} browser ${JSON.stringify(r.plainColours)}`);
  assert.deepEqual(r.reports, [], 'not refused: this browser draws half floats');
  assert.equal(r.state.on, true);
  r.greys.forEach((c, i) => assert.ok(Math.max(...c) - Math.min(...c) <= 1, `patch ${i} stays grey (${c})`));
  const want = [29, 63, 136, 188, 255]; // the BT.2390 curve's values for these patches (tests/astra-enhance.test.mjs)
  r.greys.forEach((c, i) => assert.ok(Math.abs(c[0] - want[i]) <= 3, `patch ${i}: ${c[0]}, the curve says ${want[i]}`));
  r.greys.forEach((c, i) => assert.ok(Math.abs(c[0] - r.plainGreys[i][0]) <= 4, `patch ${i} is close to the browser's own picture (${c[0]} vs ${r.plainGreys[i][0]})`));
  assert.ok(r.greys[3][0] < 200 && r.greys[4][0] > 245, 'reference white has headroom and 1000 nits is still brighter: nothing clipped at 203');
  assert.deepEqual(errors, []);
});

test('picture: an HLG film keeps the plain picture, and the Picture section says why; a PQ film is still filtered', opts, async (t) => {
  const { page: p, errors } = await page(t);
  const r = await p.evaluate(async (urls) => {
    const { AstraPlayer } = await import('/astra/src/engine/player.js');
    const { PictureControl } = await import('/astra/src/player/picture-menu.js');
    const out = {};
    for (const [name, url] of Object.entries(urls)) {
      // The real engine and the real Picture section, on a stand-in for the player screen, with Sharpen on.
      const { video, layer } = box();
      const engine = new AstraPlayer(video, document.createElement('div')), notices = [];
      const screen = { video, pictureLayer: layer, engine, prefs: { sharpen: 0.35 }, ready: false, notice: (n) => notices.push(n), menus: { modalName: '', renderModal() {} } };
      const control = new PictureControl(screen);
      const ready = new Promise((ok) => engine.addEventListener('ready', () => { screen.ready = true; ok(); }, { once: true }));
      engine.load({ url, autoplay: false });
      await Promise.race([ready, wait(15000)]);
      if (!screen.ready) { out.skip = `the engine did not open ${name}`; return out; }
      video.currentTime = 0.5; await new Promise((ok) => video.addEventListener('seeked', ok, { once: true }));
      for (let i = 0; i < 60 && !document.querySelector('canvas.astra-picture') && !control.picture?.state().reason; i++) await wait(50);
      await wait(200);
      out[name] = { transfer: control.transfer, hdr: control.hdr, state: control.picture.state(), canvas: !!document.querySelector('canvas.astra-picture'),
        status: control.body().querySelector('.ap-picture-status')?.textContent || '', notices };
      control.close(); engine.destroy(); video.remove(); layer.remove();
    }
    return out;
  }, { hlg: host.url('hdr-hlg.webm'), pq: host.url('hdr-patches.webm') });
  if (r.skip) return t.skip(r.skip);
  t.diagnostic(`HLG: transfer ${r.hlg.transfer}, "${r.hlg.status}"; PQ: transfer ${r.pq.transfer}, drawn ${r.pq.state.drawn}`);
  assert.deepEqual([r.hlg.hdr, r.hlg.transfer], [true, 'hlg'], 'the engine knows the film is HDR, and HLG');
  assert.equal(r.hlg.canvas, false, 'no filter canvas over an HLG film');
  assert.equal(r.hlg.state.on, false);
  assert.match(r.hlg.status, /HLG.*plain picture/, 'the Picture section says why');
  assert.deepEqual(r.hlg.notices, [], 'in the section, not as a notice');
  assert.deepEqual([r.pq.hdr, r.pq.transfer], [true, 'pq']);
  assert.equal(r.pq.canvas, true, 'a PQ film is drawn through the filter as before');
  assert.deepEqual([r.pq.state.on, r.pq.state.reason, r.pq.status], [true, '', '']);
  assert.deepEqual(errors, []);
});

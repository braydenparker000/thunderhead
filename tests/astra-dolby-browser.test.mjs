// Dolby Vision profile 5 colours corrected by Astra's picture filter (frontend/astra/src/enhance/dolby.js),
// read back from the canvas in a real browser, the film on the file host's other origin. No HEVC decoder is
// needed: the fixtures carry IPTPQc2 planes in VP9 profile 2, which both test browsers decode.
// dolby-patches.webm (flagged BT.2020 PQ, limited range, as the browser takes a real profile 5 stream) and
// dolby-untagged.webm (no colour fields) were made with:
//   node scripts/astra/dolby-patches.mjs
//   node scripts/astra/dolby-patches.mjs tests/fixtures/astra/dolby-untagged.webm --untagged
// Top row: grey at 5, 20, 100, 203, 1000 nits; bottom row: skin, sky, BT.709 green, BT.2020 red, BT.709 blue.
// Local only: nothing here reaches the internet.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { astraHost } from './fixtures/astra-host.mjs';
import { eetf, SHOWN_PEAK } from '../frontend/astra/src/enhance/tonemap.js';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (synthetic films)' };
let site, host, browser, base;

before(async () => {
  if (live) return;
  site = await serve(0, {});
  base = `http://127.0.0.1:${site.address().port}`;
  host = await astraHost();
  browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'], ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
});
after(async () => { await browser?.close(); site?.close(); await host?.close(); });

// What each colour patch should show, worked out here from the light it was made from: BT.709 light (BT.2020
// red brought into BT.709, its negative channels clipped as the filter clips them), max(R, G, B) through the
// BT.2390 curve, the sRGB curve, 8 bits.
const enc = (l) => (l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055);
const shown = (rgb) => { const c = rgb.map((v) => Math.max(0, v)), m = Math.max(...c), k = eetf(m) / m; return c.map((v) => Math.round(255 * enc(Math.min(1, (v * k) / SHOWN_PEAK)))); };
const RED2020 = [1.6605, -0.1246, -0.0182].map((x) => x * 100); // BT.2087's BT.2020 -> BT.709, first column
const COLOURS = { skin: [80, 55, 42], sky: [35, 55, 85], green709: [0, 100, 0], red2020: RED2020 };
const GREYS = [29, 63, 136, 188, 255];
const xs = [32, 96, 160, 224, 288];

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
      const video = Object.assign(document.createElement('video'), { playsInline: true, muted: true, crossOrigin: 'anonymous' });
      Object.assign(video.style, { position: 'absolute', left: '0', top: '0', width: '640px', height: '360px', objectFit: 'contain' });
      const layer = document.createElement('div');
      Object.assign(layer.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
      document.body.append(video, layer);
      return { video, layer };
    };
    // Both rows of patches, as the filter drew them (canvas rows bottom-up) and as the element shows them (a 2D canvas).
    window.patches = (pic, video, xs) => {
      pic.draw();
      const gl = pic.filter.gl, W = pic.canvas.width, H = pic.canvas.height, px = new Uint8Array(W * H * 4);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const ref = Object.assign(document.createElement('canvas'), { width: W, height: H }).getContext('2d');
      ref.drawImage(video, 0, 0, W, H);
      const rp = ref.getImageData(0, 0, W, H).data, at = (a, y, flip) => xs.map((x) => { const i = ((flip ? H - 1 - y : y) * W + Math.round((x * W) / 320)) * 4; return [a[i], a[i + 1], a[i + 2]]; });
      return { filter: [at(px, H / 4, true), at(px, (3 * H) / 4, true)], plain: [at(rp, H / 4), at(rp, (3 * H) / 4)] };
    };
  });
  return { page: p, errors };
}

/** Plays a fixture through Picture with only the Dolby Vision correction on, and reads the patches. */
async function corrected(p, url, xs) {
  return p.evaluate(async ([url, xs]) => {
    const { Picture } = await import('/astra/src/enhance/picture.js');
    const { video, layer } = box();
    video.src = url;
    const ok = await new Promise((r) => { video.onloadeddata = () => r(true); video.onerror = () => r(false); });
    if (!ok) return { skip: 'this browser cannot play VP9 profile 2' };
    video.currentTime = 0.5; await new Promise((r) => video.addEventListener('seeked', r, { once: true }));
    const reports = [], pic = new Picture(video, layer, { onReport: (why) => reports.push(why) });
    pic.dolby = true; // as the Picture section sets it for a profile 5 film
    const on = pic.set({});
    for (let i = 0; i < 60 && !pic.canvas?.isConnected && !reports.length; i++) await wait(50);
    const out = { on, reports, state: pic.state(), colorSpace: pic.colorSpace, ...patches(pic, video, xs) };
    pic.close(); video.remove(); layer.remove();
    return out;
  }, [url, xs]);
}

const off = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
// A colour's error as light: the largest channel's miss, as a share of the patch's brightest channel. In 8-bit
// steps a channel near 0 looks far off for a trace of light (the sRGB curve is steep there).
const dec = (e) => (e <= 0.04045 ? e / 12.92 : ((e + 0.055) / 1.055) ** 2.4), lin = (c) => c.map((v) => dec(v / 255));
const miss = (a, b) => { const x = lin(a), y = lin(b); return Math.max(...x.map((v, i) => Math.abs(v - y[i]))) / Math.max(...y); };

test('dolby: a profile 5 film\'s colours come out as the same colours through the ordinary PQ path, and wrong without the correction', opts, async (t) => {
  const { page: p, errors } = await page(t);
  const r = await corrected(p, host.url('dolby-patches.webm'), xs);
  if (r.skip) return t.skip(r.skip);
  const want = Object.values(COLOURS).map(shown);
  t.diagnostic(`frame ${JSON.stringify(r.colorSpace)}; greys on ${r.filter[0].map((c) => c[0])}, off ${r.plain[0].map((c) => c.join('/'))}`);
  t.diagnostic(`colours on ${r.filter[1].map((c) => c.join('/'))}, off ${r.plain[1].map((c) => c.join('/'))}, want ${want.map((c) => c.join('/'))} (blue, clipped by the browser, last)`);
  assert.deepEqual([r.on, r.reports, r.state.dolby, r.state.on], [true, [], true, true], 'the filter runs for the correction alone');
  r.filter[0].forEach((c, i) => assert.ok(off(c, [GREYS[i], GREYS[i], GREYS[i]]) <= 4, `grey ${i}: ${c}, BT.2390 says ${GREYS[i]}`));
  // Chrome's own HDR step (its PQ curve and gamut matrix) is not quite the textbook one: measured, its R'G'B' comes
  // back up to 0.02 off, so a colour may miss by a few per cent of its light (BT.709 green gains a trace of red).
  want.forEach((w, i) => assert.ok(miss(r.filter[1][i], w) <= 0.08, `colour ${i}: ${r.filter[1][i]}, should be ${w}`));
  // Without the correction (the browser's own picture) the same patches are far off: the correction is what fixed them.
  assert.ok(want.filter((w, i) => off(r.plain[1][i], w) > 40).length >= 3, 'the plain picture\'s colours are wrong');
  // (Its greys stay grey: a grey is I alone, at the PQ code of its light, which the browser reads as a grey's Y'.)
  assert.deepEqual(errors, []);
});

test('dolby: a profile 5 film the browser reads with no colour fields (BT.601, 8 bits, no HDR) is corrected too, a little less finely', opts, async (t) => {
  const { page: p, errors } = await page(t);
  const r = await corrected(p, host.url('dolby-untagged.webm'), xs);
  if (r.skip) return t.skip(r.skip);
  const want = Object.values(COLOURS).map(shown);
  t.diagnostic(`frame ${JSON.stringify(r.colorSpace)}; greys ${r.filter[0].map((c) => c[0])}; colours ${r.filter[1].map((c) => c.join('/'))}, want ${want.map((c) => c.join('/'))}`);
  assert.deepEqual([r.on, r.reports, r.state.dolby], [true, [], true]);
  r.filter[0].forEach((c, i) => assert.ok(off(c, [GREYS[i], GREYS[i], GREYS[i]]) <= 6, `grey ${i}: ${c}, BT.2390 says ${GREYS[i]}`));
  // BT.2020 red is clipped by BT.601's matrix (dolby.js); the colours inside BT.709 come back.
  want.slice(0, 3).forEach((w, i) => assert.ok(miss(r.filter[1][i], w) <= 0.08, `colour ${i}: ${r.filter[1][i]}, should be ${w}`));
  assert.deepEqual(errors, []);
});

test('dolby: the Picture section corrects a profile 5 film with nothing else on, says so, and its switch turns it off', opts, async (t) => {
  const { page: p, errors } = await page(t);
  const r = await p.evaluate(async (url) => {
    const { AstraPlayer } = await import('/astra/src/engine/player.js');
    const { PictureControl } = await import('/astra/src/player/picture-menu.js');
    const { video, layer } = box();
    const engine = new AstraPlayer(video, document.createElement('div'));
    const screen = { video, pictureLayer: layer, engine, prefs: { sharpen: 0, deband: false, upscale: 'standard' }, ready: false, notice() {}, menus: { modalName: '', renderModal() {} } };
    // A WebM has no Dolby Vision record: the probe's fact is put in before the section reads it (the record's
    // parsing has its own tests in astra-dolby.test.mjs).
    const ready = new Promise((ok) => engine.addEventListener('ready', () => { engine.info.video[0].dolbyVision = { profile: 5, level: 6, compatibility: 0 }; screen.ready = true; ok(); }, { once: true }));
    const control = new PictureControl(screen);
    engine.load({ url, autoplay: false });
    await Promise.race([ready, wait(15000)]);
    if (!screen.ready) return { skip: 'the engine did not open the clip' };
    video.currentTime = 0.5; await new Promise((ok) => video.addEventListener('seeked', ok, { once: true }));
    for (let i = 0; i < 60 && !document.querySelector('canvas.astra-picture'); i++) await wait(50);
    const look = () => { const b = control.body(), s = b.querySelector('[aria-label="Correct Dolby Vision colours"]'); return { canvas: !!document.querySelector('canvas.astra-picture'), checked: s?.getAttribute('aria-checked'), note: s?.closest('.ap-pb-group').querySelector('.ap-pb-note')?.textContent, status: b.querySelector('.ap-picture-status')?.textContent || '' }; };
    const on = look();
    control.change({ dolbyFix: false });
    const offNow = look();
    control.close(); engine.destroy(); video.remove(); layer.remove();
    return { on, off: offNow };
  }, host.url('dolby-patches.webm'));
  if (r.skip) return t.skip(r.skip);
  t.diagnostic(JSON.stringify(r));
  assert.deepEqual(r.on, { canvas: true, checked: 'true', note: 'Dolby Vision colours are being corrected.', status: '' });
  assert.deepEqual([r.off.canvas, r.off.checked], [false, 'false'], 'off: the plain picture');
  assert.match(r.off.note, /purple and green/);
  assert.deepEqual(errors, []);
});

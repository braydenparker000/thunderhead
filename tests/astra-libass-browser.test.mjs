// Astra's libass layer (src/subtitles/libass.js, JASSUB vendored in vendor/jassub/) on the real site
// page, its CSP and all, over a playing fixture film: tests/fixtures/astra/signs.ass given whole is
// drawn where its \pos puts it and only while a line is on screen; the film's own font is used; the
// delay moves it; destroy() ends the worker and leaves no canvas; and a start whose WebAssembly cannot
// be fetched resolves false without a page error, so the caller keeps Astra's own renderer.
// The film is made by scripts/astra/fixtures.sh. Local only: nothing here reaches the internet.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { astraHost } from './fixtures/astra-host.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (synthetic films)', timeout: 60_000 };
const ASS = await readFile(new URL('./fixtures/astra/signs.ass', import.meta.url), 'utf8');
const SIGN = [0.6, 0.1, 0.9, 0.4]; // around the sign's \\pos(480,90) of 640×360
let site, host, browser, base;

before(async () => {
  if (live) return;
  site = await serve(0, {});
  base = `http://127.0.0.1:${site.address().port}`;
  host = await astraHost();
  browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'], ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
});
after(async () => { await browser?.close(); site?.close(); await host?.close(); });

/** The Astra page with a playing film under a subtitle layer; `start(fonts?)` makes window.libass and starts it. */
async function page(t) {
  const page = await browser.newPage({ viewport: { width: 844, height: 390 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  t.after(() => page.close());
  await page.goto(`${base}/astra/`);
  const film = await page.evaluate(async (urls) => {
    const box = document.createElement('div');
    Object.assign(box.style, { position: 'fixed', inset: '0', zIndex: '9999' });
    const video = Object.assign(document.createElement('video'), { muted: true, playsInline: true, crossOrigin: 'anonymous' });
    Object.assign(video.style, { position: 'absolute', inset: '0', width: '100%', height: '100%' });
    const layer = document.createElement('div');
    Object.assign(layer.style, { position: 'absolute', inset: '0' });
    box.append(video, layer);
    document.body.append(box);
    window.film = { video, layer };
    // The film with the script inside it when this browser plays Matroska as it is, else the plain MP4.
    for (const url of urls) {
      video.src = url;
      try { await video.play(); return url; } catch {}
    }
    return null;
  }, [host.url('anime.mkv'), host.url('plain.mp4')]);
  assert.ok(film, 'a fixture film plays');
  const start = (fonts = []) => page.evaluate(async ([ass, fonts]) => {
    const { LibassLayer } = await import('/astra/src/subtitles/libass.js');
    const data = await Promise.all(fonts.map(async (f) => ({ name: f, data: new Uint8Array(await (await fetch(f)).arrayBuffer()) })));
    window.libass?.destroy();
    window.libass = new LibassLayer(window.film.video, window.film.layer);
    return window.libass.start({ header: ass, fonts: data });
  }, [ASS, fonts]);
  /**
   * Pauses at `at` s and reads the layer's canvas: lit pixels, their centre (0..1 of the picture), lit
   * pixels in each box ([x0, y0, x1, y1] as fractions), and the first box's alpha mask.
   */
  const look = (at, boxes = []) => page.evaluate(async ([at, boxes]) => {
    const { video } = window.film, canvas = window.libass.canvas;
    video.pause();
    if (Math.abs(video.currentTime - at) > 0.01) { video.currentTime = at; await new Promise((r) => video.addEventListener('seeked', r, { once: true })); }
    await new Promise((r) => setTimeout(r, 300)); // the worker draws asynchronously
    const W = canvas.clientWidth, H = canvas.clientHeight, out = new OffscreenCanvas(W, H), g = out.getContext('2d');
    g.drawImage(canvas, 0, 0, W, H);
    const d = g.getImageData(0, 0, W, H).data, lit = (x, y) => d[(y * W + x) * 4 + 3] > 0;
    let n = 0, sx = 0, sy = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (lit(x, y)) { n++; sx += x; sy += y; }
    const inside = boxes.map(([x0, y0, x1, y1]) => {
      let count = 0; const mask = [];
      for (let y = Math.floor(y0 * H); y < y1 * H; y++) for (let x = Math.floor(x0 * W); x < x1 * W; x++) { const on = lit(x, y); count += on; mask.push(on ? 1 : 0); }
      return { count, mask: mask.join('') };
    });
    return { n, x: n ? sx / n / W : null, y: n ? sy / n / H : null, lit: inside.map((b) => b.count), mask: inside[0]?.mask };
  }, [at, boxes]);
  return { page, errors, film, start, look };
}

test('libass draws the signs where the script puts them, and nothing when no line is on screen', opts, async (t) => {
  const p = await page(t);
  t.diagnostic(`film: ${p.film.split('/').pop()}`);
  assert.equal(await p.start(), true);
  assert.equal(await p.page.evaluate(() => window.film.layer.querySelectorAll('canvas').length), 1, 'one canvas, in the layer');
  // At 3 s: the dialogue at the bottom and the rotated sign at \pos(480,90) of 640×360, i.e. (0.75, 0.25).
  const [sign, dialogue, empty] = (await p.look(3, [SIGN, [0.2, 0.8, 0.8, 1], [0, 0, 0.4, 0.5]])).lit;
  assert.ok(sign > 200, `the sign is drawn around its \\pos (${sign} pixels)`);
  assert.ok(dialogue > 200, `the dialogue under it at the bottom (${dialogue} pixels)`);
  assert.equal(empty, 0, 'nothing in the empty top left');
  // At 7.5 s the \move sign is part way from x=120 to x=520 (of 640): about 0.5.
  const moving = await p.look(7.5);
  assert.ok(Math.abs(moving.x - 0.5) < 0.08 && Math.abs(moving.y - 0.5) < 0.08, `the moving sign is mid-way (${moving.x}, ${moving.y})`);
  // Between lines (9.5 s) the canvas is clear.
  assert.equal((await p.look(9.5)).n, 0, 'nothing drawn between lines');
  // A delay of 5 s: at 8 s the line of 3 s shows, at 3 s nothing does.
  await p.page.evaluate(() => window.libass.setDelay(5));
  assert.ok((await p.look(8, [SIGN])).lit[0] > 200, 'the delayed sign shows 5 s later');
  assert.equal((await p.look(3)).n, 0, 'and not at its own time');
  await p.page.evaluate(() => window.libass.setDelay(0));
  // Playing: frames are asked of libass while a line shows, at most one (to clear) between lines, none hidden.
  const asked = (from, ms) => p.page.evaluate(async ([from, ms]) => {
    const { video } = window.film, jassub = window.libass.jassub, render = jassub.manualRender;
    let n = 0;
    jassub.manualRender = function (...a) { n++; return render.apply(this, a); };
    video.currentTime = from; await video.play();
    await new Promise((r) => setTimeout(r, ms));
    video.pause(); jassub.manualRender = render;
    return n;
  }, [from, ms]);
  assert.ok(await asked(2.5, 500) > 3, 'frames follow the picture while a line shows');
  assert.ok(await asked(9.15, 500) <= 2, 'between lines libass is left alone');
  await p.page.evaluate(() => window.libass.setVisible(false));
  assert.equal(await p.page.evaluate(() => getComputedStyle(window.libass.canvas).display), 'none');
  assert.equal(await asked(2.5, 400), 0, 'hidden, no frame is asked for');
  assert.deepEqual(p.errors, []);
});

test('the film\'s own font is used for the style that names it', opts, async (t) => {
  const p = await page(t);
  // The Sign style names Inter (Bold); without it libass falls back to Liberation Sans.
  assert.equal(await p.start(), true);
  const fallback = await p.look(3, [SIGN]);
  assert.equal(await p.start(['/astra/fonts/inter-700.woff2']), true);
  const inter = await p.look(3, [SIGN]);
  let differ = 0;
  for (let i = 0; i < inter.mask.length; i++) differ += inter.mask[i] !== fallback.mask[i];
  t.diagnostic(`${differ} of ${inter.lit[0]} pixels differ`);
  assert.ok(inter.lit[0] > 200 && differ > 0.2 * inter.lit[0], `the sign is drawn in another font (${differ} of ${inter.lit[0]} pixels differ)`);
  assert.deepEqual(p.errors, []);
});

test('destroy() ends the worker and leaves no canvas; a start that cannot load libass resolves false', opts, async (t) => {
  const p = await page(t);
  assert.equal(await p.start(), true);
  const ended = await p.page.evaluate(() => {
    let terminated = 0;
    const terminate = Worker.prototype.terminate;
    Worker.prototype.terminate = function () { terminated++; return terminate.call(this); };
    window.libass.destroy();
    window.libass.destroy(); // twice is harmless
    Worker.prototype.terminate = terminate;
    return { terminated, canvases: document.querySelectorAll('canvas').length };
  });
  assert.ok(ended.terminated >= 1, 'the worker was ended');
  assert.equal(ended.canvases, 0, 'no canvas left');
  await p.page.route('**/vendor/jassub/wasm/*.wasm', (route) => route.fulfill({ status: 404, body: '' }));
  const failed = await p.page.evaluate(async (ass) => {
    const { LibassLayer } = await import('/astra/src/subtitles/libass.js');
    const layer = new LibassLayer(window.film.video, window.film.layer);
    const t0 = performance.now();
    const ok = await layer.start({ header: ass });
    layer.addEvents(['Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,After a failed start']); // dropped, no error
    layer.setDelay(1); layer.setVisible(true); layer.destroy();
    return { ok, ms: performance.now() - t0, canvases: document.querySelectorAll('canvas').length };
  }, ASS);
  assert.equal(failed.ok, false);
  assert.ok(failed.ms < 5000, `it fails at once (${Math.round(failed.ms)} ms)`);
  assert.equal(failed.canvases, 0);
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual(p.errors, []);
});

test('the renderer hands an ASS track to libass and draws its text again when libass cannot start', opts, async (t) => {
  const p = await page(t);
  const run = () => p.page.evaluate(async (ass) => {
    const { SubtitleRenderer } = await import('/astra/src/subtitles/renderer.js');
    const { parseAss } = await import('/astra/src/subtitles/ass.js');
    const { video, layer } = window.film;
    video.pause(); video.currentTime = 3; await new Promise((r) => video.addEventListener('seeked', r, { once: true }));
    const r = new SubtitleRenderer(layer, video);
    r.setCues(parseAss(ass));
    const text = () => layer.querySelectorAll('.astra-sub').length;
    const before = text();
    const libass = r.useLibass({ header: ass });
    const ok = await libass.started;
    await new Promise((res) => setTimeout(res, 100));
    const out = { before, ok, after: text(), canvases: layer.querySelectorAll('canvas').length };
    r.setCues(parseAss(ass)); // a track switch ends libass: the text is Astra's again
    out.switched = text(); out.left = layer.querySelectorAll('canvas').length;
    r.destroy();
    return out;
  }, ASS);
  assert.deepEqual(await run(), { before: 2, ok: true, after: 0, canvases: 1, switched: 2, left: 0 });
  await p.page.route('**/vendor/jassub/wasm/*.wasm', (route) => route.fulfill({ status: 404, body: '' }));
  assert.deepEqual(await run(), { before: 2, ok: false, after: 2, canvases: 0, switched: 2, left: 0 });
  assert.deepEqual(p.errors, []);
});

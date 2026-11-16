// The editor's view at its best (2026-11-16): zoomed out, once the photo rests, its full resolution is drawn over the
// editing copy at the screen's own size, so Sharpening shows as an export makes it (app/zoom.js); on a screen that shows
// Display P3 the photo is drawn in its colours, while what is kept or measured stays sRGB (app/session.js `wideScreen`);
// a board's window that moves takes the photo there by a transform alone (app/flip.js); and a gesture's log says what ran
// in its worst gap (app/moved.js). The photos are JPEGs drawn by the test, on a software GPU.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { until } from './fixtures/waits.mjs';

const opts = { skip: Boolean(process.env.SITE_URL) && 'local only (a software GPU)', timeout: 300_000 };
let server, browser, base;
before(async () => {
  if (opts.skip) return;
  server = await serve(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const exe = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
  browser = await chromium.launch({ ...exe, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader'] });
});
after(async () => { await browser?.close(); server?.close(); });

/** A page of the editor with one made-up photo open on the Edit board; `wide` makes its screen a Display P3 one. */
const opened = async (wide = false) => {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true, serviceWorkers: 'block' });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (wide) await (await context.newCDPSession(page)).send('Emulation.setEmulatedMedia', { features: [{ name: 'color-gamut', value: 'p3' }] });
  await page.goto(`${base}/lab/editor/?readback`, { waitUntil: 'load' });
  await page.waitForSelector('#stage header');
  await page.evaluate(async () => {
    const c = new OffscreenCanvas(1200, 800), g = c.getContext('2d');
    for (let y = 0; y < 800; y += 4) for (let x = 0; x < 1200; x += 4) { g.fillStyle = `hsl(${(x * 7 + y * 3) % 360} 40% ${30 + ((x ^ y) & 12) * 3}%)`; g.fillRect(x, y, 4, 4); }
    g.fillStyle = 'rgb(255, 0, 0)'; g.fillRect(500, 300, 200, 200);   // pure sRGB red
    const store = await import('/lab/editor/app/store.js'), p = await import('/lab/editor/app/session.js');
    await store.add([new File([await c.convertToBlob({ type: 'image/jpeg', quality: 0.95 })], 'IMG_0061.jpg', { type: 'image/jpeg', lastModified: 1_700_000_000_000 })], () => {});
    await p.open(store.photos()[0].id); document.dispatchEvent(new CustomEvent('editor:open', { detail: 'Edit' }));
  });
  await until(() => page.evaluate(async () => { const p = await import('/lab/editor/app/session.js'); return p.ready && !!p.whole() && !p.busy(); }), { timeout: 120_000, message: 'the photo opens' });
  return { context, page, errors };
};
/** The full-resolution layer over the fitted photo, once it shows: its size and how much fine detail it holds, and the fitted canvas's. */
const layers = (page) => page.evaluate(async () => {
  const p = await import('/lab/editor/app/session.js'), still = [...document.querySelectorAll('canvas.zl')].find((c) => c.style.display === 'block');
  const detail = (/** @type {HTMLCanvasElement} */ c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, w = c.width; let s = 0, n = 0; for (let i = 4 * (w + 1); i < d.length - 4 * (w + 1); i += 4) { s += Math.abs(2 * d[i + 1] - d[i - 3] - d[i + 5]); n++; } return s / n; };
  return still ? { w: still.width, h: still.height, shown: Math.round(still.getBoundingClientRect().width * devicePixelRatio), detail: detail(still), fitted: detail(p.canvas) } : null;
});

test('zoomed out, once the photo rests its full resolution is drawn at the screen\'s size, Sharpening and all; an edit shows the copy until it rests', opts, async () => {
  const { context, page, errors } = await opened();
  await page.evaluate(async () => (await import('/lab/editor/app/adjust.js')).setValues({ Sharpening: 100 }, 'Sharpening', 'Sharpening', '100'));
  let l = null;
  await until(async () => (l = await layers(page)) !== null, { timeout: 120_000, message: 'the full-resolution layer shows over the fitted photo' });
  assert.ok(Math.abs(l.w - l.shown) <= 1, `at the screen's own size (${l.w} for ${l.shown})`);
  assert.ok(l.detail > l.fitted * 1.1, `sharper than the editing copy, as an export is (${l.detail.toFixed(2)} against ${l.fitted.toFixed(2)})`);
  // an edit: the layer is of the photo as it was, so the copy shows until the edit rests, then the layer is made again
  const gone = await page.evaluate(async () => { const p = await import('/lab/editor/app/session.js'), s0 = p.stamp(); (await import('/lab/editor/app/adjust.js')).setValues({ Exposure: 0.5 }, 'Exposure', 'Exposure', '+0.5'); while (p.stamp() === s0) await new Promise((r) => setTimeout(r, 5)); await new Promise((r) => setTimeout(r)); return ![...document.querySelectorAll('canvas.zl')].some((c) => c.style.display === 'block'); });
  assert.ok(gone, 'hidden while the edit is drawn');
  await until(async () => (await layers(page)) !== null, { timeout: 120_000, message: 'drawn again once the edit rests' });
  assert.deepEqual(errors, []);
  await context.close();
});

test('on a Display P3 screen the photo is drawn in P3\'s colours; the histogram\'s pixels stay sRGB', opts, async () => {
  const { context, page, errors } = await opened(true);
  const r = await page.evaluate(async () => {
    const p = await import('/lab/editor/app/session.js'), c = p.canvas, g = c.getContext('2d', { colorSpace: 'display-p3' });
    const at = (/** @type {Uint8ClampedArray} */ d, /** @type {number} */ w, /** @type {number} */ x, /** @type {number} */ y) => [...d.subarray((y * w + x) * 4, (y * w + x) * 4 + 3)];
    const sx = Math.round((600 / 1200) * c.width), sy = Math.round((400 / 800) * c.height), im = await p.pixels();
    return { wide: p.wideScreen, space: g.getContextAttributes().colorSpace, red: at(g.getImageData(0, 0, c.width, c.height, { colorSpace: 'display-p3' }).data, c.width, sx, sy), kept: at(im.data, im.width, Math.round(im.width / 2), Math.round(im.height / 2)) };
  });
  assert.equal(r.wide, true, 'the screen is told apart');
  assert.equal(r.space, 'display-p3');
  // sRGB's red in P3's numbers is about (234, 51, 35): drawn as sRGB's numbers it would read (255, 0, 0) and look too strong
  assert.ok(Math.abs(r.red[0] - 234) <= 6 && Math.abs(r.red[1] - 51) <= 8 && Math.abs(r.red[2] - 35) <= 8, `sRGB's red in P3's numbers (${r.red})`);
  assert.ok(r.kept[0] >= 248 && r.kept[1] <= 8 && r.kept[2] <= 8, `the histogram's pixels are sRGB's (${r.kept})`);
  assert.deepEqual(errors, []);
  await context.close();
});

test('the photo goes to another board\'s window by its transform alone, and lands on its fitted place', opts, async () => {
  const { context, page, errors } = await opened();
  const r = await page.evaluate(async () => {
    const p = await import('/lab/editor/app/session.js'), wrap = /** @type {HTMLElement} */ (p.canvas.parentElement), home = /** @type {HTMLElement} */ (wrap.parentElement);
    const box = () => { const b = wrap.getBoundingClientRect(); return [b.left, b.top, b.width, b.height].map(Math.round); }, was = box();
    document.dispatchEvent(new CustomEvent('editor:open', { detail: 'Masks' }));   // its window sits 18 px higher than Edit's
    let seen = null;   // the first frame that moved it: what animated, and what the layer eased
    for (let i = 0; i < 60 && !seen; i++) { await new Promise((r) => requestAnimationFrame(r)); const a = wrap.getAnimations(); if (a.length || String(box()) !== String(was)) seen = { anims: a.map((x) => Object.keys(/** @type {KeyframeEffect} */ (x.effect).getKeyframes()[0]).filter((k) => !['offset', 'easing', 'composite', 'computedOffset'].includes(k))), layer: home.style.transition }; }
    await new Promise((r) => setTimeout(r, 450));
    const { fitted } = await import('/lab/editor/app/zoom.js'), f = fitted(), hb = home.getBoundingClientRect(), k = (document.getElementById('frame') || home).getBoundingClientRect().width / 412;
    return { was, seen, now: box(), want: [hb.left + f.left * k, hb.top + f.top * k, f.width * k, f.height * k].map(Math.round), left: wrap.getAnimations().length };
  });
  assert.ok(r.seen, 'the window moved, so the photo did');
  assert.ok(r.seen.anims.length === 0 || r.seen.anims.every((k) => String(k) === 'transform'), `only its transform is animated (${JSON.stringify(r.seen)})`);
  assert.ok(!/left|top|width|height/.test(r.seen.layer), `the layer's own box is not eased (${r.seen.layer})`);
  assert.equal(r.left, 0, 'the glide is over');
  assert.ok(r.now.every((v, i) => Math.abs(v - r.want[i]) <= 1), `it lands on its fitted place (${r.now} against ${r.want})`);
  assert.deepEqual(errors, []);
  await context.close();
});

test('a gesture\'s log says what ran in its worst gap', opts, async () => {
  const page = await browser.newPage({ serviceWorkers: 'block' });
  await page.goto(`${base}/lab/editor/?readback`, { waitUntil: 'load' });
  const r = await page.evaluate(async () => {
    const { moved } = await import('/lab/editor/app/moved.js'), { kept } = await import('/lab/editor/app/timings.js');
    let n = 0, held = false;
    // a dozen frames, one held up 400 ms by a tile of the still canvas
    moved(() => { n++; if (n === 6 && !held) { held = true; performance.mark('th:tile'); const t = performance.now(); while (performance.now() - t < 400); } return n <= 12; }, false);
    for (let i = 0; i < 300 && !kept().some((x) => x.kind === 'move'); i++) await new Promise((r) => setTimeout(r, 20));
    return kept().filter((x) => x.kind === 'move').at(-1);
  });
  assert.ok(r, 'the gesture was noted');
  assert.ok(r.worst >= 390, `its worst gap is the held frame (${r.worst} ms)`);
  assert.match(String(r.ran), /\btile\b/, `and it says a tile ran then (${r.ran})`);
  await page.close();
});

// The small pictures the editor makes off screen (frontend/lab/engine/gpu-aux.js `thumbTarget`, session.js `picture` up
// to 320 px): the Looks and Profile tiles and the zoom's map. They are drawn by the frame's own pass into a small
// texture of their own; on 2026-11-27 that texture was made with buffer flags, so the pass could not write it and every
// tile came back empty and clear. Here a tile is made of the known photo and set against the fitted frame.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

const opts = { skip: Boolean(process.env.SITE_URL) && 'local only (a software GPU)', timeout: 180_000 };
let server, browser, base;
before(async () => {
  if (opts.skip) return;
  server = await serve(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const exe = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
  browser = await chromium.launch({ ...exe, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader'] });
});
after(async () => { await browser?.close(); server?.close(); });

test('a small tile is the photo as the frame shows it, drawn with no GPU error, and follows an edit', opts, async () => {
  const page = await browser.newPage({ serviceWorkers: 'block' });
  await page.goto(`${base}/lab/engine/?readback`, { waitUntil: 'load' });
  await page.waitForSelector('html[data-bench=ready]');
  const r = await page.evaluate(async () => {
    const { known } = await import('/lab/engine/known.js'), { engine } = await import('/lab/engine/gpu.js');
    const eng = await engine(document.createElement('canvas'), known(720), true), device = eng.keep[1];
    const mean = (/** @type {ImageData} */ im) => { let s = 0, a = 0; for (let i = 0; i < im.data.length; i += 4) { s += im.data[i] + im.data[i + 1] + im.data[i + 2]; a += im.data[i + 3]; } const n = im.data.length / 4; return { rgb: s / n / 3, alpha: a / n }; };
    await eng.render(0, 1, {});
    const frame = mean(await eng.snapshot());
    device.pushErrorScope('validation');
    await eng.render(0, 1, { screen: false, thumbW: 160, draft: true });
    const err = await device.popErrorScope(), im = await eng.readThumb(), tile = mean(im);
    await eng.render(1, 1, { screen: false, thumbW: 160, draft: true });
    const lit = mean(await eng.readThumb());
    eng.dispose();
    return { frame, tile, lit, size: [im.width, im.height], err: err ? err.message.slice(0, 300) : null };
  });
  assert.equal(r.err, null, 'the tile is drawn with no GPU error');
  assert.deepEqual(r.size, [160, 160]);
  assert.equal(r.tile.alpha, 255, 'every pixel of the tile is drawn (not left clear)');
  assert.ok(Math.abs(r.tile.rgb - r.frame.rgb) < 3, `the tile is as bright as the frame (${r.tile.rgb.toFixed(1)} against ${r.frame.rgb.toFixed(1)})`);
  assert.ok(r.lit.rgb > r.tile.rgb + 15, `a stop of Exposure brightens the tile (${r.lit.rgb.toFixed(1)} against ${r.tile.rgb.toFixed(1)})`);
});

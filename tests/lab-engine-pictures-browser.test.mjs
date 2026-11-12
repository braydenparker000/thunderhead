// The engine's pictures, checked on every change (engine/raw/ROADMAP.md stage 1; frontend/lab/engine/bench.js,
// known.js). The test bench on /lab/engine/ develops a made-up photo whose every colour is known, on the GPU,
// every way the editor does (demosaic, its Faster mode, sharpening, noise reduction, a plain frame, the same with
// strong colours cut off the old way, an edited frame) and compares
// the result with the reference numbers kept beside it (bench-ref.json, made on this same software GPU). A change
// that alters a picture fails here until the reference is made again on purpose (node engine/raw/checks/ref.cjs),
// so the difference is seen and stated, never slipped in. The bench's own tolerance for a phone is wider.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (a software GPU)', timeout: 240_000 };
/** How far a run on CI's GPU may sit from the reference: one step of the numbers' own rounding (0.01 dB, 0.0001),
 * for the same software GPU on another processor. Measured: nudging one constant of the demosaic (how far a site's
 * own colour follows the new green, 0.5 to 0.4) moves colour by 0.04 dB, and this catches it. */
const TIGHT = { db: 0.011, grid: 0.00011 };
/** How far the colour table may sit from developing each pixel itself, for each frame the test below draws: levels
 * of 255 on average, then the share of pixels off by more than 1 and by more than 3. A tenth above what was
 * measured (0.25, 4.5 %, 0.16 % for the plain frame). The known photo is the worst there is for this: its made-up
 * camera sees many colours no screen shows, and those are the ones still read from the table (wgsl.js `fit`). */
const LIMIT = { plain: [0.28, 0.05, 0.0018], bright: [0.55, 0.08, 0.0483], strong: [0.6, 0.097, 0.0229], toned: [0.33, 0.05, 0.0016] };
let server, browser, base;

before(async () => {
  if (live) return;
  server = await serve(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const exe = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
  browser = await chromium.launch({ ...exe, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader'] });
});
after(async () => { await browser?.close(); server?.close(); });

test('the known photo develops to the reference numbers', opts, async () => {
  const page = await browser.newPage({ viewport: { width: 412, height: 915 }, serviceWorkers: 'block' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/lab/engine/?readback`, { waitUntil: 'load' });
  await page.waitForSelector('html[data-bench=ready]');
  await page.click('#bcheck');
  await page.waitForFunction(() => /^(Done|Stopped)/.test(document.getElementById('bnow').textContent), null, { timeout: 200_000 });
  assert.match(await page.textContent('#bnow'), /^Done/);
  const run = await page.evaluate(() => window.__bench);
  const ref = JSON.parse(readFileSync(new URL('../frontend/lab/engine/bench-ref.json', import.meta.url), 'utf8')).shots;
  assert.deepEqual(Object.keys(run.shots), ['demosaic', 'faster', 'fringed', 'sharpened', 'denoised', 'frame', 'cut', 'edited']);
  for (const [name, v] of Object.entries(run.verdict)) {
    assert.equal(v.same, true, `${name} is the reference's picture`);
    assert.ok((v.db ?? 0) <= TIGHT.db && v.grid <= TIGHT.grid, `${name}: off by ${v.db} dB and ${v.grid}; if the change was meant, make the reference again`);
  }
  // The numbers mean something: the demosaic is true to the scene, sharpening wins detail back against the scene
  // before the lens, and an edit changes the frame.
  assert.ok(ref.demosaic.psnr > 34 && ref.demosaic.green > 40, 'the demosaic');
  assert.ok(ref.faster.psnr < ref.demosaic.psnr - 0.2 && ref.faster.psnr > 33, 'Faster is the first look alone: a little less true, still a fair picture');
  assert.ok(ref.fringed.psnr > ref.demosaic.psnr - 2.5 && ref.fringed.colour > ref.demosaic.colour - 1, 'through a lens that fringes by a pixel, the picture is nearly as true');
  assert.ok(ref.sharpened.psnr > 29, 'sharpening');
  assert.ok(ref.denoised.psnr > 33, 'noise reduction at ISO 6400');
  assert.ok(ref.frame.grid.some((g, i) => Math.abs(g - ref.edited.grid[i]) > 0.02), 'the edited frame differs from the plain one');
  assert.ok(ref.frame.grid.some((g, i) => Math.abs(g - ref.cut.grid[i]) > 0.02), 'easing strong colours in differs from cutting them off (the made-up camera has many)');
  const text = await page.textContent('#bout');
  assert.equal((text.match(/SAME/g) || []).length, 8);
  assert.doesNotMatch(text, /DIFFERENT/);
  assert.equal(await page.isEnabled('#bcopy'), true);
  // The run is kept on this phone and shown the next time the page opens.
  await page.reload({ waitUntil: 'load' });
  assert.match(await page.textContent('#bout'), /^The last run on this phone:[\s\S]*demosaic/);
  assert.deepEqual(errors, []);
  await page.close();
});

test('the colour table gives what developing each pixel itself gives', opts, async () => {
  // The frame reads its colours from a table, between its points; `exact` develops every pixel itself. The two
  // must agree, most of all where the picture meets the edge of the screen's range: highlights blown to white and
  // strong colours. (Measured before the cut-off and the encoding left the table: 4 % of a photo a stop over was
  // off by more than 3 levels of 255, its blown highlights tinted. A few pixels in ten thousand still differ, where
  // a strong colour is eased in at the edge: that easing is in the table.)
  const page = await browser.newPage({ viewport: { width: 412, height: 915 }, serviceWorkers: 'block' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/lab/engine/?readback`, { waitUntil: 'load' });
  await page.waitForSelector('html[data-bench=ready]');
  const r = await page.evaluate(async () => {
    const { known } = await import('/lab/engine/known.js'), { engine } = await import('/lab/engine/gpu.js');
    const eng = await engine(document.createElement('canvas'), known(480), true), out = {};
    for (const [name, ev, more] of [['plain', 0.25, {}], ['bright', 1.5, {}], ['strong', 0.25, { saturation: 0.4, vibrance: 0.3 }], ['toned', 0.6, { highlights: -0.5, shadows: 0.5, whites: 0.2, blacks: -0.1 }]]) {
      await eng.render(ev, 1, { ...more, dither: false, exact: true }); const a = (await eng.snapshot()).data;
      await eng.render(ev, 1, { ...more, dither: false }); const b = (await eng.snapshot()).data;
      let over1 = 0, over3 = 0, sum = 0; const n = a.length / 4;
      for (let i = 0; i < n; i++) { const d = Math.max(Math.abs(a[i * 4] - b[i * 4]), Math.abs(a[i * 4 + 1] - b[i * 4 + 1]), Math.abs(a[i * 4 + 2] - b[i * 4 + 2])); sum += d; if (d > 1) over1++; if (d > 3) over3++; }
      out[name] = { mean: sum / n, over1: over1 / n, over3: over3 / n };
    }
    eng.dispose();
    return out;
  });
  assert.deepEqual(Object.keys(r), Object.keys(LIMIT));
  for (const [name, v] of Object.entries(r)) assert.ok(v.mean < LIMIT[name][0] && v.over1 < LIMIT[name][1] && v.over3 < LIMIT[name][2], `${name}: off by ${v.mean.toFixed(3)} levels on average, ${(100 * v.over1).toFixed(2)} % of pixels by more than 1 and ${(100 * v.over3).toFixed(3)} % by more than 3`);
  assert.deepEqual(errors, []);
  await page.close();
});

test('a picture that is off is told apart, and a missing reference is said', opts, async () => {
  const page = await browser.newPage({ serviceWorkers: 'block' });
  await page.goto(`${base}/lab/engine/?readback`, { waitUntil: 'load' });
  const out = await page.evaluate(async () => {
    const { judge, NEAR } = await import('/lab/engine/bench.js');
    const ref = { a: { psnr: 35, green: 40, colour: 33, grid: [0.5, 0.5] }, f: { grid: [0.2, 0.8] } };
    return { NEAR, v: judge({ a: { psnr: 35.1, green: 40, colour: 33, grid: [0.502, 0.5] }, f: { grid: [0.2, 0.83] }, b: { psnr: 30.2, green: 40, colour: 33, grid: [0.5, 0.5] }, x: { grid: [0] } }, { ...ref, b: ref.a }) };
  });
  assert.deepEqual(out.v.a, { same: true, db: 0.1, grid: 0.002 });
  assert.deepEqual(out.v.f, { same: false, db: 0, grid: 0.03 });
  assert.equal(out.v.b.same, false);
  assert.deepEqual(out.v.x, { same: false, why: 'no reference' });
  await page.close();
});

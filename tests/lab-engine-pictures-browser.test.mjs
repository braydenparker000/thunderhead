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
  assert.deepEqual(Object.keys(run.shots), ['demosaic', 'faster', 'sharpened', 'denoised', 'frame', 'cut', 'edited']);
  for (const [name, v] of Object.entries(run.verdict)) {
    assert.equal(v.same, true, `${name} is the reference's picture`);
    assert.ok((v.db ?? 0) <= TIGHT.db && v.grid <= TIGHT.grid, `${name}: off by ${v.db} dB and ${v.grid}; if the change was meant, make the reference again`);
  }
  // The numbers mean something: the demosaic is true to the scene, sharpening wins detail back against the scene
  // before the lens, and an edit changes the frame.
  assert.ok(ref.demosaic.psnr > 34 && ref.demosaic.green > 40, 'the demosaic');
  assert.ok(ref.faster.psnr < ref.demosaic.psnr - 0.2 && ref.faster.psnr > 33, 'Faster is the first look alone: a little less true, still a fair picture');
  assert.ok(ref.sharpened.psnr > 29, 'sharpening');
  assert.ok(ref.denoised.psnr > 33, 'noise reduction at ISO 6400');
  assert.ok(ref.frame.grid.some((g, i) => Math.abs(g - ref.edited.grid[i]) > 0.02), 'the edited frame differs from the plain one');
  assert.ok(ref.frame.grid.some((g, i) => Math.abs(g - ref.cut.grid[i]) > 0.02), 'easing strong colours in differs from cutting them off (the made-up camera has many)');
  const text = await page.textContent('#bout');
  assert.equal((text.match(/SAME/g) || []).length, 7);
  assert.doesNotMatch(text, /DIFFERENT/);
  assert.equal(await page.isEnabled('#bcopy'), true);
  // The run is kept on this phone and shown the next time the page opens.
  await page.reload({ waitUntil: 'load' });
  assert.match(await page.textContent('#bout'), /^The last run on this phone:[\s\S]*demosaic/);
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

// Stacking for noise in the new editor at /lab/editor/ (frontend/lab/editor/app/stack.js, engine/stack.js;
// engine/raw/ROADMAP.md stage 8), end to end on a real RAF: the Library's sheet stacks the frames it is showing
// into a new photo, kept as sensor data, which opens like any RAF. The frames here are the public X-E5 sample
// three times over (tests/photos-engine.test.mjs fetches it; never committed), so the stack must come out as the
// one frame does: what averaging gains is held by tests/lab-engine-stack.test.mjs. Skipped where the sample is not.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

const RAF = join(tmpdir(), 'th-photos-engine-sample', 'xe5-8509.raf');
const opts = { skip: process.env.SITE_URL ? 'local only (a software GPU)' : !existsSync(RAF) && 'the sample RAF is not on this machine', timeout: 420_000 };
let server, browser, base, dir;
before(async () => {
  if (opts.skip) return;
  dir = mkdtempSync(join(tmpdir(), 'th-stack-'));   // the one sample under three names: three frames of a scene nothing moved in
  for (const n of ['DSCF0001.RAF', 'DSCF0002.RAF', 'DSCF0003.RAF']) copyFileSync(RAF, join(dir, n));
  server = await serve(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const exe = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
  browser = await chromium.launch({ ...exe, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader'] });
});
after(async () => { await browser?.close(); server?.close(); if (dir) rmSync(dir, { recursive: true, force: true }); });

test('three frames are stacked into one photo that opens, and looks, like a RAF', opts, async () => {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true, serviceWorkers: 'block' });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/lab/editor/?readback`, { waitUntil: 'load' });
  await page.waitForSelector('#stage header');
  await page.getByRole('button', { name: 'Import' }).click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByText('Choose photos').click()]);
  await chooser.setFiles(['DSCF0001.RAF', 'DSCF0002.RAF', 'DSCF0003.RAF'].map((name) => join(dir, name)));
  await page.waitForFunction(() => /Done · 3 photos copied/.test(document.querySelector('#stage')?.textContent ?? ''), null, { timeout: 120_000 });
  await page.getByText('Stack the photos shown for noise').click();
  await page.getByText('Stack 3 frames? Tap again').click();
  await page.waitForFunction(() => /Done · DSCF000\d ×3 is in the Library/.test(document.querySelector('#stage')?.textContent ?? ''), null, { timeout: 240_000 });
  const r = await page.evaluate(async () => {
    const store = await import('/lab/editor/app/store.js'), photo = await import('/lab/editor/app/session.js');
    const stack = store.photos().find((p) => p.kind === 'stack'), frame = store.photos().find((p) => !p.kind), out = { count: store.photos().length, name: stack.name, mb: Math.round(stack.size / 1e6), tile: store.urlNow(stack.id).startsWith('blob:'), shot: stack.shot?.iso };
    const look = async (id) => { await photo.open(id, true); return { px: (await photo.pixels()).data, status: photo.current().status, noise: photo.value('Noise'), line: photo.kindLine(), size: photo.shape() }; };
    const a = await look(stack.id), b = await look(frame.id);
    let sum = 0, most = 0; for (let i = 0; i < a.px.length; i++) if (i % 4 < 3) { const d = Math.abs(a.px[i] - b.px[i]); sum += d; most = Math.max(most, d); }
    return { ...out, stack: { status: a.status, noise: a.noise, line: a.line, size: a.size }, frame: { noise: b.noise, line: b.line, size: b.size }, off: sum / (a.px.length * 0.75), most };
  });
  assert.deepEqual([r.count, r.tile], [4, true], 'the frames stay, and the stack stands beside them with a tile');
  assert.match(r.name, /^DSCF000\d ×3$/);
  assert.ok(r.mb > 70 && r.mb < 90, `the sensor's data at 16 bits (${r.mb} MB)`);
  assert.equal(r.stack.status, '');
  assert.deepEqual(r.stack.size, r.frame.size);
  assert.equal(r.stack.line, r.frame.line, 'its line says how the frames were shot');
  assert.ok(r.off < 0.6 && r.most <= 3, `three frames alike average to the frame itself (off by ${r.off.toFixed(3)} levels on average, ${r.most} at most)`);
  assert.deepEqual(errors, []);
  await context.close();
});

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
  assert.deepEqual(Object.keys(run.shots), ['demosaic', 'faster', 'fringed', 'sharpened', 'denoised', 'network', 'networkNoisy', 'frame', 'cut', 'edited']);
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
  // The network (neural.js) against the usual way, on a chart that is hard on it (it was trained on photographs): truer
  // overall and in colour on a clean picture, and at ISO 6400 truer than the demosaic with noise reduction after it.
  assert.ok(ref.network.psnr > ref.demosaic.psnr + 1 && ref.network.colour > ref.demosaic.colour + 1, 'the network on a clean picture');
  assert.ok(ref.networkNoisy.psnr > ref.denoised.psnr + 1 && ref.networkNoisy.colour > ref.denoised.colour + 1, 'the network at ISO 6400');
  assert.ok(ref.frame.grid.some((g, i) => Math.abs(g - ref.edited.grid[i]) > 0.02), 'the edited frame differs from the plain one');
  assert.ok(ref.frame.grid.some((g, i) => Math.abs(g - ref.cut.grid[i]) > 0.02), 'easing strong colours in differs from cutting them off (the made-up camera has many)');
  const text = await page.textContent('#bout');
  assert.equal((text.match(/SAME/g) || []).length, 10);
  assert.doesNotMatch(text, /DIFFERENT/);
  assert.equal(await page.isEnabled('#bcopy'), true);
  // The run is kept on this phone and shown the next time the page opens.
  await page.reload({ waitUntil: 'load' });
  assert.match(await page.textContent('#bout'), /^The last run on this phone:[\s\S]*demosaic/);
  assert.deepEqual(errors, []);
  await page.close();
});

test('a full-size view and an export by the network: the same photo, a little apart from the usual way', { ...opts, timeout: 420_000 }, async () => {
  // full.js `view(..., best)` puts the network where the demosaic stands, with no noise reduction after it (it took
  // the noise out itself); export.js `develop(..., best)` makes a file that way and says so. The known photo is
  // small enough for a software GPU: a real one is forty megapixels.
  const page = await browser.newPage({ viewport: { width: 412, height: 915 }, serviceWorkers: 'block' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/lab/engine/?readback`, { waitUntil: 'load' });
  await page.waitForSelector('html[data-bench=ready]');
  const r = await page.evaluate(async () => {
    const { known } = await import('/lab/engine/known.js'), { engine } = await import('/lab/engine/gpu.js'), { full } = await import('/lab/engine/full.js'), { develop } = await import('/lab/engine/export.js'), files = await import('/lab/engine/files.js');
    const k = known(480, 3200), eng = await engine(document.createElement('canvas'), k, true);
    eng.setProfile(null); await eng.render(0.25, 1, { sharpen: 0.4, noise: 0.5, colorNoise: 0.25, fit: false });
    const big = await full(eng, k, k.mosaic.slice());
    const shot = async (/** @type {boolean} */ best) => { const v = await big.view(240, 240, null, true, false, best), at = await v.region(120, 120, 240, 240), im = await v.read(), net = v.net; v.dispose(); return { net, at: [at.cw, at.ch], data: im.data }; };
    const usual = await shot(false), net = await shot(true);
    let sum = 0, most = 0, light = 0;
    for (let i = 0; i < usual.data.length; i += 4) for (let c = 0; c < 3; c++) { const d = Math.abs(usual.data[i + c] - net.data[i + c]); sum += d; most = Math.max(most, d); light += net.data[i + c]; }
    const n = (usual.data.length / 4) * 3, clock = {};
    const [file] = await develop(big, [{ long: 240, open: (w, h) => files.png(w, h, null) }], undefined, clock, true, { ops: true });
    const bm = await createImageBitmap(file.blob), N = await import('/lab/engine/neural.js'), proved = (await N.compile(eng.gpu.device)).off;
    big.dispose(); eng.dispose();
    return { proved, limit: N.PROOF, nets: [usual.net, net.net], at: net.at, mean: sum / n, most, light: light / n, clock: { net: clock.net, gpu: clock.gpu > 0, steps: Object.keys(clock.split || {}), ops: (clock.ops || []).length }, file: [file.width, file.height, bm.width, bm.height, file.blob.type] };
  });
  // before a GPU uses the network it must give a known grey slope back (neural.js `proof`): a driver that gets it wrong is not used
  assert.ok(r.proved >= 0 && r.proved < r.limit / 4, `the network proved itself on this GPU (off by ${r.proved}, at most ${r.limit})`);
  assert.deepEqual(r.nets, [false, true], 'the view says which way it was made');
  assert.deepEqual(r.at, [240, 240]);
  assert.ok(r.light > 20, `the network's view is a picture (mean ${r.light.toFixed(1)} of 255)`);
  assert.ok(r.mean > 0.05 && r.mean < 6, `the two ways show the same photo, a little apart (${r.mean.toFixed(2)} levels on average, ${r.most} at most)`);
  assert.deepEqual(r.clock, { net: 1, gpu: true, steps: ['demosaic', 'noise', 'sharpen', 'warp', 'colour'], ops: 13 });   // and, asked, one of the network's windows timed a pass at a time
  assert.deepEqual(r.file, [240, 240, 240, 240, 'image/png']);
  assert.deepEqual(errors, []);
  await page.close();
});

test('an edit that pushes strong colours past the screen\'s edge brings them back to it, never to black', opts, async () => {
  // Whites, Contrast and Auto strengthen colour, and a strong yellow or green then lies past what a screen shows.
  // wgsl.js `fit` takes its strength down to the edge. It used to hand tanh an argument too large for a GPU,
  // which made the colour no number at all: black where every pixel is developed, olive through the table. In a
  // JPEG, whose colours all start on or inside the edge, that was every colour an edit pushed past it.
  const page = await browser.newPage({ viewport: { width: 412, height: 915 }, serviceWorkers: 'block' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/lab/engine/?readback`, { waitUntil: 'load' });
  await page.waitForSelector('html[data-bench=ready]');
  const r = await page.evaluate(async () => {
    const { still } = await import('/lab/engine/picture.js'), { engine } = await import('/lab/engine/gpu.js');
    const cols = ['#e0d020', '#d02020', '#20a040', '#2040d0', '#808080', '#f0e060', '#ffd000', '#c0c020'], W = cols.length * 120, c = new OffscreenCanvas(W, 480), g = c.getContext('2d');
    cols.forEach((col, i) => { g.fillStyle = col; g.fillRect(i * 120, 0, 120, 480); });
    const eng = await engine(document.createElement('canvas'), await still(await c.convertToBlob({ type: 'image/png' })), true), out = {};
    eng.setProfile(null);
    const shot = async (contrast, more) => { await eng.render(0, contrast, { ...more, dither: false }); const im = await eng.snapshot(); return cols.map((_, i) => [...im.data.subarray((80 * im.width + Math.floor((i * 120 + 60) / 3)) * 4, (80 * im.width + Math.floor((i * 120 + 60) / 3)) * 4 + 3)]); };
    out.plain = await shot(1, {});
    for (const [name, contrast, more] of [['whites', 1, { whites: 0.37 }], ['whitesFull', 1, { whites: 1 }], ['contrast', 1.3, {}]]) out[name] = { table: await shot(contrast, more), exact: await shot(contrast, { ...more, exact: true }) };
    eng.dispose();
    return out;
  });
  for (const name of ['whites', 'whitesFull', 'contrast']) for (const way of ['table', 'exact']) r[name][way].forEach((px, i) => {
    const was = r.plain[i];
    assert.ok(Math.max(...px) >= 0.75 * Math.max(...was), `${name}, ${way}: the patch that was ${was} came out ${px}`);
  });
  // a strong yellow under Whites is a brighter yellow: red and green up, blue still low
  const [yr, yg, yb] = r.whites.table[0];
  assert.ok(yr > 230 && yg > 215 && yb < 40, `the yellow under Whites +37 is ${r.whites.table[0]}`);
  r.whites.table.forEach((px, i) => px.forEach((v, k) => assert.ok(Math.abs(v - r.whites.exact[i][k]) <= 12, `the table and each pixel itself agree on patch ${i}: ${px} against ${r.whites.exact[i]}`)));
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

test('Color Chrome darkens strong colours and leaves greys and pale ones; Chrome Blue the blues; Grain size makes the grain coarser', opts, async () => {
  // grade.js `chrome`: Oklab's lightness lowered by up to 7 % (about 0.3 stops) on strong colours, by how strong they
  // are; Chrome for every hue but the blues, Chrome Blue for those. grain: specks larger than at the start, run smoothly
  // into each other. At 0 (and Grain size at its start) the picture is the one without them, to the last value.
  const page = await browser.newPage({ viewport: { width: 412, height: 915 }, serviceWorkers: 'block' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/lab/engine/?readback`, { waitUntil: 'load' });
  await page.waitForSelector('html[data-bench=ready]');
  const r = await page.evaluate(async () => {
    const { still } = await import('/lab/engine/picture.js'), { engine } = await import('/lab/engine/gpu.js'), { known } = await import('/lab/engine/known.js');
    const picture = async (/** @type {string[]} */ cols) => { const c = new OffscreenCanvas(cols.length * 60, 120), g = c.getContext('2d'); cols.forEach((col, i) => { g.fillStyle = col; g.fillRect(i * 60, 0, 60, 120); }); return still(await c.convertToBlob({ type: 'image/png' })); };
    const cols = ['#d02020', '#20a040', '#2040d0', '#5a96dc', '#808080', '#c8b8a8'], eng = await engine(document.createElement('canvas'), await picture(cols), true), out = {};
    eng.setProfile(null);
    const shot = async (more) => { await eng.render(0, 1, { ...more, dither: false }); const im = await eng.snapshot(), cw = im.width / cols.length, o = (i) => (Math.floor(im.height / 2) * im.width + Math.floor(i * cw + cw / 2)) * 4; return cols.map((_, i) => [...im.data.subarray(o(i), o(i) + 3)]); };
    for (const [name, more] of [['plain', {}], ['chrome', { chrome: 1 }], ['weak', { chrome: 0.5 }], ['blue', { chromeBlue: 1 }]]) out[name] = await shot(more);
    eng.dispose();
    // the known photo, with grain and the banding guard on: at 0 and at its start each is no change at all
    const k = await engine(document.createElement('canvas'), known(480), true), bytes = async (more) => { await k.render(0.25, 1.1, { saturation: 0.3, grain: 0.5, ...more }); return [...(await k.snapshot()).data]; };
    k.setProfile(null);
    const without = await bytes({}), at0 = await bytes({ chrome: 0, chromeBlue: 0, grainSize: 1 });
    out.same = without.length > 0 && without.every((v, i) => v === at0[i]);
    k.dispose();
    // grain on a flat grey: how alike a pixel is to the ones 1 and 2 along, and how strong it is
    const flat = await engine(document.createElement('canvas'), await picture(Array(8).fill('#777777')), true);
    flat.setProfile(null);
    out.grain = {};
    for (const [name, size] of [['start', 1], ['large', 2 ** (35 / 30)], ['most', 2 ** (75 / 30)]]) {
      await flat.render(0, 1, { grain: 0.5, grainSize: size, dither: false });
      const im = await flat.snapshot(), w = im.width, h = im.height, v = Array.from({ length: w * h }, (_, i) => im.data[i * 4 + 1]), m = v.reduce((a, b) => a + b, 0) / v.length, d = v.map((x) => x - m), sd = d.reduce((a, b) => a + b * b, 0) / d.length;
      const along = (lag) => { let s = 0, n = 0; for (let y = 0; y < h; y++) for (let x = 0; x + lag < w; x++) { s += d[y * w + x] * d[y * w + x + lag]; n++; } return s / n / sd; };
      out.grain[name] = { sd: Math.sqrt(sd), ac1: along(1), ac2: along(2) };
    }
    flat.dispose();
    return out;
  });
  const lin = (c) => ((c / 255) <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4), Y = (px) => 0.2126 * lin(px[0]) + 0.7152 * lin(px[1]) + 0.0722 * lin(px[2]);
  const stops = (a, b) => Math.log2(Y(b) / Y(a)), near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 1);
  const [red, green, blue, sky, grey, pale] = [0, 1, 2, 3, 4, 5];
  for (const i of [red, green]) {
    const s = stops(r.plain[i], r.chrome[i]), w = stops(r.plain[i], r.weak[i]);
    assert.ok(s < -0.15 && s > -0.5, `Chrome 100 darkens patch ${i} (${r.plain[i]} to ${r.chrome[i]}) by ${s.toFixed(2)} stops`);
    assert.ok(w < -0.05 && w > s, `Chrome 50 by less (${w.toFixed(2)} stops)`);
  }
  for (const i of [blue, sky, grey, pale]) assert.ok(near(r.plain[i], r.chrome[i]), `Chrome leaves patch ${i} as it was: ${r.plain[i]}, ${r.chrome[i]}`);
  for (const i of [blue, sky]) assert.ok(stops(r.plain[i], r.blue[i]) < -0.1, `Chrome Blue darkens patch ${i}: ${r.plain[i]} to ${r.blue[i]}`);
  for (const i of [red, green, grey, pale]) assert.ok(near(r.plain[i], r.blue[i]), `Chrome Blue leaves patch ${i}: ${r.plain[i]}, ${r.blue[i]}`);
  assert.equal(r.same, true, 'both at 0 and Grain size at its start: the bytes of a render without them');
  const g = r.grain;
  assert.ok(Math.abs(g.start.ac1) < 0.05 && Math.abs(g.start.ac2) < 0.05, `at its start each speck is its own: ${g.start.ac1.toFixed(3)}, ${g.start.ac2.toFixed(3)}`);
  assert.ok(g.large.ac1 > g.start.ac1 + 0.1 && g.most.ac2 > 0.25 && g.most.ac1 > g.large.ac1, `coarser with size: ${JSON.stringify(g)}`);
  for (const k of ['large', 'most']) assert.ok(Math.abs(g[k].sd / g.start.sd - 1) < 0.25, `and about as strong (${g[k].sd.toFixed(2)} against ${g.start.sd.toFixed(2)})`);
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

test('at full size a turn of Sharpening or Noise starts from the demosaiced rectangle kept aside, and makes the same picture as from the sensor', { ...opts, timeout: 300_000 }, async () => {
  // full.js: noise reduction and sharpening work on the demosaiced rectangle in place, so each turn of either used
  // to demosaic the rectangle again (most of the work at 100 %). It is kept aside now and copied back; moving
  // the rectangle, or a retouch spot (the geometry), makes it again from the sensor.
  const page = await browser.newPage({ viewport: { width: 412, height: 915 }, serviceWorkers: 'block' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/lab/engine/?readback`, { waitUntil: 'load' });
  await page.waitForSelector('html[data-bench=ready]');
  const r = await page.evaluate(async () => {
    const { known } = await import('/lab/engine/known.js'), { engine } = await import('/lab/engine/gpu.js'), { full } = await import('/lab/engine/full.js');
    const k = known(480, 3200), eng = await engine(document.createElement('canvas'), k, true);
    eng.setProfile(null);
    const big = await full(eng, k, k.mosaic.slice()), v = await big.view(240, 240, null, true);
    const shot = async (/** @type {number} */ sharpen, /** @type {number} */ noise, x = 120) => { await eng.render(0.25, 1, { sharpen, noise, colorNoise: 0.25, fit: false }); await v.region(x, 120, 240, 240); return [...(await v.read()).data]; };
    const same = (/** @type {number[]} */ a, /** @type {number[]} */ b) => a.every((x, i) => x === b[i]);
    const a = await shot(0.4, 0.5), first = { ...v.stats };
    const sharper = await shot(0.9, 0.5), cleaner = await shot(0.4, 1), back = await shot(0.4, 0.5), turned = { ...v.stats };
    const moved = await shot(0.4, 0.5, 60), after = { ...v.stats };
    // the same settings on a view made new: from the sensor, never from a copy
    const v2 = await big.view(240, 240, null, true); await v2.region(120, 120, 240, 240); const fresh = [...(await v2.read()).data];
    eng.setGeometry({ distortion: 0, vignetting: 0, crop: null, spots: [] }); await shot(0.4, 0.5, 60); const bent = { ...v.stats };
    // the network is compiled behind the photo only where it will be used (meta.net, the owner's setting), a moment after
    // (only that it was begun is checked: compiling it on a software GPU is the network test's minutes, not this one's)
    const N = await import('/lab/engine/neural.js'), warm = [N.begun(eng.gpu.device)];
    const big2 = await full(eng, { ...k, meta: { ...k.meta, net: true } }, k.mosaic.slice());
    warm.push(N.begun(eng.gpu.device)); await new Promise((res) => setTimeout(res, 1800)); warm.push(N.begun(eng.gpu.device));
    v.dispose(); v2.dispose(); big.dispose(); big2.dispose(); eng.dispose();
    return { first, turned, after, bent, warm, differs: [!same(a, sharper), !same(a, cleaner), !same(a, moved)], back: same(a, back), fresh: same(a, fresh) };
  });
  assert.deepEqual(r.first, { demosaic: 1, kept: 0 });
  assert.equal(r.turned.demosaic, 1, 'three turns of Sharpening and Noise: the sensor is not gone back to');
  assert.ok(r.turned.kept >= 3, `each started from the copy (${r.turned.kept})`);
  assert.deepEqual(r.differs, [true, true, true], 'Sharpening, Noise and the place each change the picture');
  assert.ok(r.back, 'back at the first settings the picture is the first one, to the last value');
  assert.ok(r.fresh, 'and it is what a view made new draws from the sensor');
  assert.equal(r.after.demosaic, 2, 'another rectangle is made from the sensor');
  assert.equal(r.bent.demosaic, 3, 'and so is the same one once the geometry (a retouch spot) changed');
  assert.deepEqual(r.warm, [false, false, true], 'the network: not asked for without the setting, nor at once, but behind the photo a moment later');
  assert.deepEqual(errors, []);
  await page.close();
});

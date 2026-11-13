// The grain the network's last pass puts back (frontend/lab/engine/neural.js `place`): a share of what the network
// took from each site, returned as brightness only. On the known photo with a sensor's noise laid on it, made three
// ways by the network: with no grain put back, with all of it, and with all of it but only where light stands far
// above its noise. And one window timed a pass at a time (`bench`), each of the network's passes also the other
// ways there are (net-tune.js), which must agree, prove themselves and make the same picture. A software GPU: local only.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

const opts = { skip: process.env.SITE_URL ? 'local only (a software GPU)' : false, timeout: 600_000 };
let server, browser, base;
before(async () => {
  if (opts.skip) return;
  server = await serve(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const exe = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
  browser = await chromium.launch({ ...exe, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader'] });
});
after(async () => { await browser?.close(); server?.close(); });

test('grain put back is brightness only, is the site\'s own, and stays out of the shadows', opts, async () => {
  const page = await browser.newPage({ viewport: { width: 412, height: 915 }, serviceWorkers: 'block' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/lab/engine/?readback`, { waitUntil: 'load' });
  await page.waitForSelector('html[data-bench=ready]');
  const r = await page.evaluate(async () => {
    const { known, CAMERA } = await import('/lab/engine/known.js'), { engine } = await import('/lab/engine/gpu.js'), N = await import('/lab/engine/neural.js');
    const n = 240, k = known(n, 3200), eng = await engine(document.createElement('canvas'), k, true), device = eng.gpu.device;
    const tex = device.createTexture({ size: [n, n], format: 'r16uint', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    device.queue.writeTexture({ texture: tex }, k.mosaic, { bytesPerRow: n * 2 }, [n, n]);
    const phase = /** @type {number[]} */ (N.phaseOf(k.meta)), net = await N.demosaicer(device, tex, { phase, black: CAMERA.black, white: CAMERA.white, wb: CAMERA.wb, noise: k.meta.noise }, n, n);
    const made = async (/** @type {number} */ keep, /** @type {number} */ quiet, by = net, on = device) => {
      const enc = on.createCommandEncoder(), read = on.createBuffer({ size: n * n * 8, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      by.run(enc, 0, 0, n, n, null, 1, keep, quiet); enc.copyBufferToBuffer(by.out, 0, read, 0, n * n * 8); on.queue.submit([enc.finish()]);
      await read.mapAsync(GPUMapMode.READ);
      const u = new Uint32Array(read.getMappedRange().slice(0)), f = new Float32Array(n * n * 3);
      for (let i = 0; i < n * n; i++) { f[i * 3] = (u[i * 2] & 65535) / 65535; f[i * 3 + 1] = (u[i * 2] >>> 16) / 65535; f[i * 3 + 2] = (u[i * 2 + 1] & 65535) / 65535; }
      read.destroy();
      return f;
    };
    const net2kind = (/** @type {GPUDevice} */ d) => (d.features.has('shader-f16') ? 'f16' : 'f32');
    const none = await made(0, 0), all = await made(1, 0), lit = await made(1, 40);
    // which colour each site holds, read from the truth: the mosaic's value is nearest that colour's
    const LAY = '101121212010101121121101010212121101', at = (/** @type {number} */ x, /** @type {number} */ y) => +LAY[((y + phase[1]) % 6) * 6 + ((x + phase[0]) % 6)];
    const span = CAMERA.white - CAMERA.black;
    let hue = 0, off0 = 0, off1 = 0, sites = 0, moved = 0; const by = [];   // each site's light, and how far its green moved with all the grain and with the lit places' alone
    for (let y = 40; y < n - 40; y++) for (let x = 40; x < n - 40; x++) {
      const i = (y * n + x) * 3, a = none.subarray(i, i + 3), b = all.subarray(i, i + 3), c = lit.subarray(i, i + 3);
      const raw = (k.mosaic[y * n + x] - CAMERA.black) / span, ch = at(x, y);
      if (raw >= 0.9 || Math.min(a[0], a[1], a[2]) < 0.02 || Math.max(b[0], b[1], b[2]) > 0.98) continue;
      const f = b.map((v, j) => v / a[j]);   // brightness only: every colour moved by the same factor
      hue = Math.max(hue, Math.abs(f[0] - f[1]), Math.abs(f[2] - f[1]));
      off0 += Math.abs(raw - a[ch]); off1 += Math.abs(raw - b[ch]); moved += Math.abs(b[1] - a[1]); sites++;
      by.push([0.25 * a[0] * CAMERA.wb[0] / CAMERA.wb[1] + 0.5 * a[1] + 0.25 * a[2] * CAMERA.wb[2] / CAMERA.wb[1], Math.abs(b[1] - a[1]), Math.abs(c[1] - a[1])]);
    }
    by.sort((p, q) => p[0] - q[0]);
    const fifth = Math.floor(by.length / 5), share = (/** @type {number[][]} */ part) => part.reduce((t, p) => t + p[2], 0) / part.reduce((t, p) => t + p[1], 0);
    // one window a pass at a time, each waited for, and each of the network's own also the other way (net-tune.js): the phone's own numbers
    const ops = await net.bench(0, 0), T = await import('/lab/engine/net-tune.js'), picked = T.chosen(net2kind(device), 11);
    net.destroy(); tex.destroy(); eng.dispose();
    return { ops, picked, none: Array.from(none, (v) => Math.round(v * 65535)), sites, hue, off0: off0 / sites, off1: off1 / sites, moved: moved / sites, dark: share(by.slice(0, fifth)), bright: share(by.slice(-fifth)), light: [by[fifth][0], by[by.length - fifth][0]] };
  });
  console.log(JSON.stringify({ ...r, none: r.none.length }));
  assert.ok(r.sites > 10_000, 'enough of the picture is looked at');
  assert.ok(r.moved > 1e-4, 'grain is put back');
  assert.ok(r.hue < 0.02, `every colour moves by the same factor (${r.hue})`);
  assert.ok(r.off1 < r.off0 * 0.5, `each site comes back towards its own value (${r.off1} from ${r.off0})`);
  assert.ok(r.dark < 0.7 * r.bright, `the darkest fifth is given less of it than the lightest (${r.dark} and ${r.bright} of all of it)`);
  assert.ok(r.bright > 0.5, `the lightest fifth keeps most of it (${r.bright})`);
  assert.ok(r.ops.ms.length === 13 && r.ops.ms.every((ms) => ms >= 0 && ms < 600_000), `cut, the network's eleven passes and place are timed apart (${r.ops.ms.map(Math.round)})`);
  // the other ways: none for the first and last pass; for the nine between, reading in place agrees with the exported pass,
  // and so does the 3 × 3 passes' second way
  const [inPlace, wider] = r.ops.alt;
  assert.ok(inPlace.length === 11 && inPlace[0] === -1 && inPlace[10] === -1 && inPlace.slice(1, 10).every((ms) => ms >= 0), `each of the nine passes agrees read in place (${inPlace.map(Math.round)})`);
  assert.deepEqual(wider.map((ms) => (ms >= 0 ? 'agrees' : ms)), [-1, 'agrees', -1, -1, 'agrees', -1, -1, 'agrees', -1, -1, -1], `the 3 × 3 passes agree sixteen outputs at a time (${wider.map(Math.round)})`);
  assert.deepEqual(r.picked, r.ops.way, 'what was clearly faster here is kept as this phone\'s choice');
  assert.ok(r.ops.way.length === 11 && r.ops.way.every((w, j) => w === 0 || (w === 1 ? inPlace : wider)[j] < 0.85 * r.ops.ms[j + 1]), `a way is chosen only where clearly faster (${r.ops.way})`);
  await page.close();
  // Every pass another way, as a phone that found them all faster would run it (read in place; and the 3 × 3 passes
  // sixteen outputs at a time): a page that opens with that choice kept compiles and proves the network so, and makes
  // the same picture.
  let second = page;
  for (const way of [[0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0], [0, 2, 1, 1, 2, 1, 1, 2, 1, 1, 0]]) {
    second = await browser.newPage({ viewport: { width: 412, height: 915 }, serviceWorkers: 'block' });
    second.on('pageerror', (e) => errors.push(e.message));
    await second.goto(`${base}/lab/engine/?readback`, { waitUntil: 'load' });
    await second.waitForSelector('html[data-bench=ready]');
    const o = await second.evaluate(async ([none, way]) => {
      const { known, CAMERA } = await import('/lab/engine/known.js'), { engine } = await import('/lab/engine/gpu.js'), N = await import('/lab/engine/neural.js'), T = await import('/lab/engine/net-tune.js');
      const n = 240, k = known(n, 3200), eng = await engine(document.createElement('canvas'), k, true), device = eng.gpu.device, kind = device.features.has('shader-f16') ? 'f16' : 'f32';
      T.choose(kind, way);
      const tex = device.createTexture({ size: [n, n], format: 'r16uint', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
      device.queue.writeTexture({ texture: tex }, k.mosaic, { bytesPerRow: n * 2 }, [n, n]);
      const net = await N.demosaicer(device, tex, { phase: /** @type {number[]} */ (N.phaseOf(k.meta)), black: CAMERA.black, white: CAMERA.white, wb: CAMERA.wb, noise: k.meta.noise }, n, n), c = await N.compile(device);
      const enc = device.createCommandEncoder(), read = device.createBuffer({ size: n * n * 8, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      net.run(enc, 0, 0, n, n, null, 1, 0, 0); enc.copyBufferToBuffer(net.out, 0, read, 0, n * n * 8); device.queue.submit([enc.finish()]);
      await read.mapAsync(GPUMapMode.READ);
      const u = new Uint32Array(read.getMappedRange());
      let apart = 0; for (let i = 0; i < n * n; i++) apart = Math.max(apart, Math.abs((u[i * 2] & 65535) - none[i * 3]), Math.abs((u[i * 2] >>> 16) - none[i * 3 + 1]), Math.abs((u[i * 2 + 1] & 65535) - none[i * 3 + 2]));
      // a choice that cannot be right (a way that is not there, another kind of network, too few passes) is not used; all as exported is forgotten
      const zero = new Array(11).fill(0), odd = [[0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 1], 'x'].map((w) => { localStorage.setItem('th.net.tune', JSON.stringify({ v: 1, kind, way: w })); return T.chosen(kind, 11).join(''); });
      T.choose(kind, way); const wrongKind = T.chosen('f64', 11).join('');
      T.choose(kind, zero);
      read.destroy(); net.destroy(); tex.destroy(); eng.dispose();
      return { way: c.way, groups: c.g.ops.map((op) => op.groups[2]), proved: c.off, limit: N.PROOF, apart: apart / 65535, odd, wrongKind, left: localStorage.getItem('th.net.tune') };
    }, [r.none, way]);
    console.log(JSON.stringify(o));
    assert.deepEqual(o.way, way);
    assert.equal(o.groups[4], way[4] === 2 ? 9 : 18, 'sixteen outputs at a time: half the dispatches');
    assert.ok(o.proved >= 0 && o.proved < o.limit / 4 && o.apart < 0.004, `with every pass another way the network proves itself and makes the same picture (off by ${o.proved}, apart by ${o.apart})`);
    assert.deepEqual([o.odd, o.wrongKind, o.left], [['00000000000', '00000000000', '00000000000'], '00000000000', null]);
    if (way[1] === 1) await second.close();
  }
  await second.close();
});

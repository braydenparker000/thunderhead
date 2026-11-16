// The network on the CPU beside the GPU (frontend/lab/engine/net-cpu.js, AUDIT.md P.3): a window whose layers the
// CPU's cores made is the network's own picture (the GPU's raw values to within rounding, and its finished pixels
// the same but for a step of 65535 where a value sat on a rounding's edge), and an export that hands pieces to the CPU makes the same file as one made on the GPU alone, to within a
// level of rounding. How much faster that is is the phone's to say: here the GPU is software.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

const opts = { skip: Boolean(process.env.SITE_URL) && 'local only (a software GPU)', timeout: 600_000 };
let server, browser, base;
before(async () => {
  if (opts.skip) return;
  server = await serve(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const exe = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
  browser = await chromium.launch({ ...exe, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader'] });
});
after(async () => { await browser?.close(); server?.close(); });

const engine = async () => {
  const page = await browser.newPage({ serviceWorkers: 'block' }), errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${base}/lab/engine/?readback`, { waitUntil: 'load' });
  await page.waitForSelector('html[data-bench=ready]');
  return { page, errors };
};

test('a window made on the CPU is the network\'s own: its raw values within rounding, its pixels the same', opts, async () => {
  const { page, errors } = await engine();
  const r = await page.evaluate(async () => {
    const { engine } = await import('/lab/engine/gpu.js'), { phaseOf } = await import('/lab/engine/demosaic.js'), { demosaicer: network } = await import('/lab/engine/neural.js');
    const { CAMERA, known } = await import('/lab/engine/known.js'), { noiseAt } = await import('/lab/engine/noise.js'), { crew, helper } = await import('/lab/engine/net-cpu.js');
    const N = 1056, k = known(N, 3200, true), eng = await engine(document.createElement('canvas'), known(48), true), device = eng.gpu.device;
    const tex = device.createTexture({ size: [N, N], format: 'r16uint', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    device.queue.writeTexture({ texture: tex }, k.mosaic, { bytesPerRow: N * 2 }, [N, N]);
    const net = await network(device, tex, { phase: phaseOf(k.meta), black: CAMERA.black, white: CAMERA.white, wb: CAMERA.wb, iso: 3200, noise: noiseAt(3200), fringe: k.fringe }, 990, 990);
    const g = net.parts.g, R = [30, 30, 960, 960];
    const read = async (buf, bytes) => { const b = device.createBuffer({ size: bytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }), enc = device.createCommandEncoder(); enc.copyBufferToBuffer(buf, 0, b, 0, bytes); device.queue.submit([enc.finish()]); await b.mapAsync(GPUMapMode.READ); const out = b.getMappedRange().slice(0); b.destroy(); return out; };
    { const enc = device.createCommandEncoder(); net.run(enc, ...R, null, 1, 0.3, 2); device.queue.submit([enc.finish()]); }
    const gpuPx = new Uint32Array(await read(net.out, R[2] * R[3] * 8)), gpuRaw = g.kind === 'f32' ? new Float32Array(await read(net.parts.bufs[g.output], 3 * N * N * 4)) : null;
    const team = await crew(3), run = team.run; let raw = null; team.run = async (...a) => (raw = await run(...a));
    const fin = await helper(device, net, team)(...R, null, 1, 0.3, 2);
    { const z = device.createCommandEncoder(); z.clearBuffer(net.parts.bufs[g.output]); z.clearBuffer(net.out); fin(z); device.queue.submit([z.finish()]); }
    const cpuPx = new Uint32Array(await read(net.out, R[2] * R[3] * 8)); team.end();
    let most = 0, differ = 0;
    if (gpuRaw) for (let c = 0; c < 3; c++) for (let y = 60; y < 960; y++) for (let x = 60; x < 960; x++) { const i = c * N * N + y * N + x, d = Math.abs(gpuRaw[i] - raw[i]); if (d > 0) differ++; most = Math.max(most, d); }
    let px = 0, step = 0; for (let i = 0; i < gpuPx.length; i++) if (gpuPx[i] !== cpuPx[i]) { px++; for (const sh of i % 2 ? [0] : [0, 16]) step = Math.max(step, Math.abs(((gpuPx[i] >>> sh) & 65535) - ((cpuPx[i] >>> sh) & 65535))); }
    eng.dispose();
    return { kind: g.kind, most, differ, px, step, words: gpuPx.length, lit: gpuPx.filter((v) => (v & 65535) > 2000).length };
  });
  assert.ok(r.lit > r.words / 4, 'the window is a picture');
  if (r.kind === 'f32') {
    assert.ok(r.differ > 0, 'made apart: the CPU\'s sums are its own, not the GPU\'s copied');
    assert.ok(r.most < 1e-5, `the raw values agree within rounding (${r.most})`);
  }
  assert.ok(r.step <= 2 && r.px <= r.words * 0.01, `the finished pixels are the same but for rounding: ${r.px} of ${r.words} apart, by ${r.step} of 65535 at most (a level of 255 is 257)`);
  assert.deepEqual(errors, []);
});

test('an export that hands pieces to the CPU makes the same file as the GPU alone, within a level', opts, async () => {
  const { page, errors } = await engine();
  const r = await page.evaluate(async () => {
    const { known } = await import('/lab/engine/known.js'), { engine } = await import('/lab/engine/gpu.js'), { full } = await import('/lab/engine/full.js'), { develop } = await import('/lab/engine/export.js'), files = await import('/lab/engine/files.js');
    const k = known(1104, 1600, true), eng = await engine(document.createElement('canvas'), k, true);
    eng.setProfile(null); await eng.render(0.25, 1, { sharpen: 0.4, noise: 0.5, colorNoise: 0.25, fit: false });
    const big = await full(eng, k, k.mosaic.slice()), out = {};
    for (const cpu of [false, 'always']) {
      const clock = {}, [f] = await develop(big, [{ long: 1104, open: (w, h) => files.png(w, h, null) }], undefined, clock, true, { cpu });
      const bm = await createImageBitmap(f.blob), c = new OffscreenCanvas(bm.width, bm.height), g = c.getContext('2d'); g.drawImage(bm, 0, 0);
      out[String(cpu)] = { pieces: clock.cpu || 0, cores: clock.helpers, data: g.getImageData(0, 0, bm.width, bm.height).data };
    }
    const a = out.false.data, b = out.always.data; let differ = 0, most = 0, lit = 0;
    for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); if (d) differ++; most = Math.max(most, d); lit += a[i]; }
    big.dispose(); eng.dispose();
    return { alone: out.false.pieces, helped: out.always.pieces, cores: out.always.cores, differ, most, n: a.length, mean: lit / a.length };
  });
  assert.equal(r.alone, 0, 'with the CPU kept out, the GPU made every piece');
  assert.ok(r.helped >= 1 && r.cores >= 1, `with it in, the CPU made pieces (${r.helped}, on ${r.cores} cores)`);
  assert.ok(r.mean > 20, 'the file is a picture');
  assert.ok(r.most <= 1 && r.differ <= r.n * 1e-3, `the same file within a level of rounding (${r.differ} of ${r.n} values, ${r.most} at most)`);
  assert.deepEqual(errors, []);
});

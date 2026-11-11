// The engine's own demosaic (WGSL, in headless Chromium with a software GPU) run on a harness mosaic:
//   node engine.cjs <crop.bin> [module path]      BASE: the site as served (node scripts/serve.mjs), default http://127.0.0.1:8080
// Reads <crop>.remade.f32 (score.mjs writes it), writes <crop>.gpu.f32 (w*h*3 floats, 0..1 of the sensor's range).
// With ISO=<iso> it reads <crop>.iso<iso>.f32 (noisy.mjs) instead and, with NOISE and COLOUR (the sliders, 0..100), runs the
// engine's noise reduction after the demosaic; it then writes <crop>.iso<iso>.n<NOISE>c<COLOUR>.f32. SHARP=<Sharpening>,
// <Radius>,<Detail> (the plate's numbers) runs the engine's sharpening last and adds .s<...> to the name.
const { chromium } = require('playwright'); const fs = require('fs');
(async () => {
  const bin = process.argv[2], mod = process.argv[3] || '/lab/engine/demosaic.js', j = JSON.parse(fs.readFileSync(bin + '.json')), K = +(process.env.K || 6), w = j.w / K, h = j.h / K;
  const E = process.env, ISO = +(E.ISO || 0), NOISE = +(E.NOISE || 0), COLOUR = +(E.COLOUR || 0), SHARP = E.SHARP ? E.SHARP.split(',').map(Number) : null, FRINGE = +(E.FRINGE || 0);   // FRINGE=<px>: tell the demosaic red was recorded that far to the right of green and blue that far to the left (fringe.mjs lays such a mosaic)   // SHARP=<Sharpening>,<Radius>,<Detail> as the plate shows them
  const m = new Float32Array(fs.readFileSync(bin.replace(/\.bin$/, ISO ? `.iso${ISO}.f32` : '.remade.f32')).buffer.slice(0)), { black, white, cfa, wb } = j.meta;
  const u16 = Array.from(m, (v) => Math.max(0, Math.min(65535, Math.round(v * (white - black) + black))));
  const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader'] }), p = await b.newPage(); p.on('console', (x) => console.log('page:', x.text().slice(0, 300)));
  await p.goto((process.env.BASE || 'http://127.0.0.1:8080') + '/lab/engine/' + (process.env.QUERY || '')); await p.waitForTimeout(1500);
  const out = await p.evaluate(async ({ u16, w, h, black, white, cfa, mod, wb, ISO, NOISE, COLOUR, SHARP, FRINGE }) => {
    const D = await import(mod), device = await (await navigator.gpu.requestAdapter()).requestDevice();
    const make = device.createBuffer.bind(device); device.createBuffer = (o) => make({ ...o, usage: o.usage & GPUBufferUsage.MAP_READ ? o.usage : o.usage | GPUBufferUsage.COPY_SRC });   // so the result can be read back
    device.addEventListener('uncapturederror', (e) => console.log('gpu error', e.error.message));
    const tex = device.createTexture({ size: [w, h], format: 'r16uint', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    device.queue.writeTexture({ texture: tex }, new Uint16Array(u16), { bytesPerRow: w * 2 }, [w, h]);
    const t0 = performance.now(), dm = await D.demosaicer(device, tex, { phase: D.phaseOf({ cfa, cfaWidth: 6 }), black, white, wb, fringe: FRINGE ? { centre: [-1e6, h / 2], reach: 1e12, table: Float32Array.from({ length: 64 }, (_, i) => [FRINGE / 1e6, -FRINGE / 1e6, 0, 0][i % 4]) } : null }, w, h), enc = device.createCommandEncoder();
    dm.run(enc, 0, 0, w, h, null);
    if (ISO && (NOISE || COLOUR)) { const N = await import('/lab/engine/denoise.js'), P = await import('/lab/engine/noise.js'), dn = await N.denoiser(device, dm.out); dn.run(enc, w, h, P.noiseAt(ISO), 2.5 * NOISE / 100, 4 * COLOUR / 100); }   // the sliders as gpu.js scales them
    if (SHARP) { const X = await import('/lab/engine/deconv.js'), sh = await X.sharpener(device, dm.out); sh.run(enc, w, h, wb, SHARP[0] / 40, SHARP[1], SHARP[2] / 100); }
    const read = device.createBuffer({ size: w * h * 8, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }); enc.copyBufferToBuffer(dm.out, 0, read, 0, w * h * 8); device.queue.submit([enc.finish()]);
    await read.mapAsync(GPUMapMode.READ); const u = new Uint32Array(read.getMappedRange().slice(0)); console.log('demosaic ms', Math.round(performance.now() - t0));
    return Array.from(u);
  }, { u16, w, h, black, white, cfa, mod, wb, ISO, NOISE, COLOUR, SHARP, FRINGE });
  const f = new Float32Array(w * h * 3); for (let i = 0; i < w * h; i++) { f[i * 3] = (out[i * 2] & 65535) / 65535; f[i * 3 + 1] = (out[i * 2] >>> 16) / 65535; f[i * 3 + 2] = (out[i * 2 + 1] & 65535) / 65535; }
  fs.writeFileSync(bin.replace(/\.bin$/, (ISO ? `.iso${ISO}.n${NOISE}c${COLOUR}` : '.gpu') + (SHARP ? `.s${SHARP.join('-')}` : '') + '.f32'), Buffer.from(f.buffer)); console.log('wrote', w, h); await b.close();
})();

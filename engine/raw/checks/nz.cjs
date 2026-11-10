// Noise reduction check. A clean low-ISO photo's sensor data gets the X-E5's own ISO noise added (noise.js),
// and each setting's 100 % crop is compared with the clean one.   node nz.cjs <raf> [iso] [u v]
const { chromium } = require('playwright');
const S = __dirname, [file, iso = '6400', u = '0.62', v = '0.6'] = process.argv.slice(2), tag = process.env.TAG || 'a';
(async () => {
  const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader'] });
  const p = await (await b.newContext({ serviceWorkers: 'block', acceptDownloads: true })).newPage();
  p.on('pageerror', (e) => console.log('ERR', e.message)); p.on('console', (m) => { if (/error/i.test(m.type())) console.log('LOG', m.text().slice(0, 500)); });
  const saves = []; p.on('download', (d) => saves.push(d.saveAs(`${S}/out/${d.suggestedFilename()}`)));
  await p.goto((process.env.BASE || 'http://127.0.0.1:8080') + '/lab/engine/'); await p.waitForTimeout(4000);
  await p.evaluate(() => { const i = document.createElement('input'); i.type = 'file'; i.id = 'mine'; document.body.append(i); });
  await p.setInputFiles('#mine', file);
  const out = await p.evaluate(async ({ iso, u, v, tag }) => {
    const buf = await document.querySelector('#mine').files[0].arrayBuffer();
    const w = new Worker('/lab/engine/decode-worker.js', { type: 'module' }); let mosaic = null, first = null;
    const r = await new Promise((res) => { w.onmessage = (m) => { if (m.data.mosaic) { mosaic = m.data.mosaic; res(first); } else if (m.data.error) res(m.data); else if (m.data.proxy) first = m.data; }; w.postMessage({ buf, full: true, tag: 1 }, [buf]); });
    w.terminate(); if (r.error) return { error: r.error };
    const { engine } = await import('/lab/engine/gpu.js'), { full } = await import('/lab/engine/full.js'), { noiseAt } = await import('/lab/engine/noise.js'), errs = [];
    const W = r.meta.fullWidth, H = r.meta.fullHeight, span = r.meta.white - r.meta.black, n = noiseAt(iso), cfa = r.meta.cfa;
    const noisy = new Uint16Array(mosaic.length); let seed = 12345; const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return ((seed >>> 0) + 0.5) / 4294967296; };
    for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, i++) { const c = +cfa[(y % 6) * 6 + (x % 6)], val = Math.max(0, (mosaic[i] - r.meta.black) / span), g = Math.sqrt(-2 * Math.log(rnd())) * Math.cos(6.283185307 * rnd()); noisy[i] = Math.max(0, Math.min(65535, Math.round((val + g * Math.sqrt(n.a[c] * val + n.b[c])) * span + r.meta.black))); }
    const save = async (im, name) => { const oc = new OffscreenCanvas(im.width, im.height); oc.getContext('2d').putImageData(im, 0, 0); const a = document.createElement('a'); a.href = URL.createObjectURL(await oc.convertToBlob({ type: 'image/png' })); a.download = name; document.body.append(a); a.click(); a.remove(); await new Promise((q) => setTimeout(q, 300)); };
    const crop = async (meta, data, more, name) => {
      const c = document.createElement('canvas'), eng = await engine(c, { ...r, meta }, true);
      eng.gpu.device.addEventListener('uncapturederror', (e) => errs.push(String(e.error?.message).slice(0, 400)));
      await eng.render(0.25, 1, { sharpen: 0, ...more });
      const f = await full(eng, { ...r, meta }, data), view = await f.view(768, 512, document.createElement('canvas'), true);
      await view.region(u * f.width - 384, v * f.height - 256, 768, 512); const im = await view.read();
      if (name) await save(im, name); f.dispose(); eng.dispose(); return im;
    };
    const psnr = (a, b) => { let s = 0; for (let i = 0; i < a.data.length; i += 4) for (let k = 0; k < 3; k++) s += (a.data[i + k] - b.data[i + k]) ** 2; return +(10 * Math.log10(65025 / (s / (a.data.length * 0.75)))).toFixed(2); };
    const clean = await crop(r.meta, mosaic, {}, `nz-${tag}-clean.png`), hot = { ...r.meta, iso }, res = {};
    res['clean, default colour NR at its real ISO, against clean'] = psnr(await crop(r.meta, mosaic, { colorNoise: 0.25 }), clean);
    res['clean, colour 100 + brightness 100 at its real ISO'] = psnr(await crop(r.meta, mosaic, { colorNoise: 1, noise: 1 }), clean);
    for (const [name, more] of [['off', {}], ['colour 25', { colorNoise: 0.25 }], ['colour 50', { colorNoise: 0.5 }], ['colour 100', { colorNoise: 1 }], ['colour 25, brightness 25', { colorNoise: 0.25, noise: 0.25 }], ['colour 25, brightness 50', { colorNoise: 0.25, noise: 0.5 }], ['colour 50, brightness 100', { colorNoise: 0.5, noise: 1 }]])
      res[`ISO ${iso} noise, ${name}`] = psnr(await crop(hot, noisy, more, /off|brightness 50/.test(name) ? `nz-${tag}-${name.replace(/[ ,]+/g, '-')}.png` : ''), clean);
    return { res, errs };
  }, { iso: +iso, u: +u, v: +v, tag });
  for (const [k, val] of Object.entries(out.res || {})) console.log(String(val).padStart(6), 'dB ', k);
  console.log(out.error || '', 'gpu errors:', JSON.stringify(out.errs)); await p.waitForTimeout(1500); await Promise.all(saves);
  await b.close();
})();

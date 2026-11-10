// Full resolution check: node fr.cjs <raf> [u v] [w h]   (u, v: the crop's centre, 0..1 across the upright photo)
// Compares the demosaic averaged 3 × 3 with the editing copy, and saves the crop and the camera JPEG's same crop.
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
const S = __dirname, [file, u = '0.5', v = '0.5', cw = '768', ch = '512'] = process.argv.slice(2);
const more = JSON.parse(process.env.MORE || '{}'), tag = process.env.TAG || path.basename(file).slice(0, 12);
(async () => {
  const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader'] });
  const p = await (await b.newContext({ serviceWorkers: 'block' })).newPage();
  p.on('pageerror', e => console.log('ERR', e.message)); p.on('console', m => { if (/error|warn/i.test(m.type())) console.log('LOG', m.text().slice(0, 600)); });
  await p.goto((process.env.BASE || 'http://127.0.0.1:8080') + '/lab/engine/'); await p.waitForTimeout(4000);
  await p.evaluate(() => { const i = document.createElement('input'); i.type = 'file'; i.id = 'mine'; document.body.append(i); });
  await p.setInputFiles('#mine', file);
  const out = await p.evaluate(async ({ u, v, cw, ch, more }) => {
    const file = document.querySelector('#mine').files[0], buf = await file.arrayBuffer(), bust = '?' + Date.now();
    const w = new Worker('/lab/engine/decode-worker.js', { type: 'module' }); let pre = null, mosaic = null;
    const r = await new Promise((res) => { w.onmessage = (m) => { if (m.data.preview) pre = m.data; else if (m.data.mosaic) { mosaic = m.data.mosaic; res(first); } else if (m.data.error) res(m.data); else first = m.data; }; let first = null; w.postMessage({ buf, full: true }, [buf]); });
    w.terminate(); if (r.error) return { error: r.error };
    const { engine } = await import('/lab/engine/gpu.js'), { full } = await import('/lab/engine/full.js');
    const errs = []; const c = document.createElement('canvas'), eng = await engine(c, r, true);
    eng.gpu.device.addEventListener('uncapturederror', (e) => errs.push(String(e.error?.message).slice(0, 500)));
    await eng.render(0.25, 1, more);
    const prox = await eng.snapshot();
    const t0 = performance.now(), f = await full(eng, r, mosaic), t1 = performance.now();
    if (!f) return { error: 'no full', meta: r.meta };
    const vc = document.createElement('canvas'), view = await f.view(cw, ch, vc, true), t2 = performance.now();
    const at = await view.region(u * f.width - cw / 2, v * f.height - ch / 2, cw, ch), t3 = performance.now();
    await eng.render(0.25, 1, more);   // a render after: the view follows it
    const img = await view.read();
    // the crop averaged 3 × 3 against the editing copy, tried at shifts of a proxy pixel
    const X0 = Math.ceil(at.X / 3), Y0 = Math.ceil(at.Y / 3), nx = Math.floor((at.X + at.cw) / 3) - X0, ny = Math.floor((at.Y + at.ch) / 3) - Y0, diffs = {};
    const avg = new Float32Array(nx * ny * 3);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) for (let k = 0; k < 3; k++) {
      let s = 0; for (let b = 0; b < 3; b++) for (let a = 0; a < 3; a++) s += img.data[(((Y0 + j) * 3 - at.Y + b) * at.cw + (X0 + i) * 3 - at.X + a) * 4 + k];
      avg[(j * nx + i) * 3 + k] = s / 9;
    }
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const s = [0, 0, 0], sg = [0, 0, 0]; let n = 0;
      for (let j = 2; j < ny - 2; j++) for (let i = 2; i < nx - 2; i++) { n++; for (let k = 0; k < 3; k++) { const d = avg[(j * nx + i) * 3 + k] - prox.data[((Y0 + j + dy) * prox.width + X0 + i + dx) * 4 + k]; s[k] += Math.abs(d); sg[k] += d; } }
      diffs[`${dx},${dy}`] = s.map((x) => +(x / n).toFixed(2)).join(' ') + (dx || dy ? '' : '  signed ' + sg.map((x) => +(x / n).toFixed(2)).join(' '));
    }
    const png = (id) => { const k = document.createElement('canvas'); k.width = id.width; k.height = id.height; k.getContext('2d').putImageData(id, 0, 0); return k.toDataURL('image/png'); };
    let jpg = null;
    if (pre) { const bm = await createImageBitmap(pre.preview), k = document.createElement('canvas'); k.width = at.cw; k.height = at.ch; const sx = bm.width / f.width; k.getContext('2d').drawImage(bm, at.X * sx, at.Y * sx, at.cw * sx, at.ch * sx, 0, 0, at.cw, at.ch); jpg = k.toDataURL('image/png'); }
    const pc = new ImageData(nx, ny); for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) for (let k = 0; k < 4; k++) pc.data[(j * nx + i) * 4 + k] = prox.data[((Y0 + j) * prox.width + X0 + i) * 4 + k];
    f.dispose(); eng.dispose();
    return { meta: { o: r.meta.orientation, full: [r.meta.fullWidth, r.meta.fullHeight], proxy: [r.width, r.height], cfa: r.meta.cfa, black: r.meta.black, white: r.meta.white }, size: [f.width, f.height], at, ms: { upload: t1 - t0, view: t2 - t1, region: t3 - t2 }, diffs, errs, crop: png(img), jpg, prox: png(pc) };
  }, { u: +u, v: +v, cw: +cw, ch: +ch, more });
  for (const k of ['crop', 'jpg', 'prox']) if (out[k]) { fs.writeFileSync(`${S}/shots/fr-${tag}-${k}.png`, Buffer.from(out[k].split(',')[1], 'base64')); delete out[k]; }
  console.log(JSON.stringify(out, null, 1));
  await b.close();
})();

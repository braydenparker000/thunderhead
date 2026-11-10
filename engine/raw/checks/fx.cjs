// What a render option does to the picture, measured: node fx.cjs <raf> '<json name → options>'
const { chromium } = require('playwright');
const S = __dirname, file = process.argv[2], sets = JSON.parse(process.argv[3]), tag = process.env.TAG || 'a';
(async () => {
  const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader'] });
  const p = await (await b.newContext({ serviceWorkers: 'block', acceptDownloads: true })).newPage();
  p.on('pageerror', (e) => console.log('ERR', e.message)); p.on('console', (m) => { if (/error/i.test(m.type())) console.log('LOG', m.text().slice(0, 400)); });
  const saves = []; p.on('download', (d) => saves.push(d.saveAs(`${S}/out/${d.suggestedFilename()}`)));
  await p.goto((process.env.BASE || 'http://127.0.0.1:8080') + '/lab/engine/'); await p.waitForTimeout(4000);
  await p.evaluate(() => { const i = document.createElement('input'); i.type = 'file'; i.id = 'mine'; document.body.append(i); });
  await p.setInputFiles('#mine', file);
  const out = await p.evaluate(async ({ sets, tag }) => {
    const buf = await document.querySelector('#mine').files[0].arrayBuffer();
    const w = new Worker('/lab/engine/decode-worker.js', { type: 'module' });
    const r = await new Promise((res) => { w.onmessage = (m) => { if (m.data.proxy || m.data.error) res(m.data); }; w.postMessage(buf, [buf]); });
    w.terminate(); if (r.error) return { error: r.error };
    const { engine } = await import('/lab/engine/gpu.js'), errs = [], c = document.createElement('canvas'), eng = await engine(c, r, true);
    eng.gpu.device.addEventListener('uncapturederror', (e) => errs.push(String(e.error?.message).slice(0, 400)));
    const blur = (L, w, h, r) => { const t = new Float32Array(w * h), o = new Float32Array(w * h); for (let y = 0; y < h; y++) { let s = 0; for (let x = -r; x <= r; x++) s += L[y * w + Math.max(0, Math.min(w - 1, x))]; for (let x = 0; x < w; x++) { t[y * w + x] = s / (2 * r + 1); s += L[y * w + Math.min(w - 1, x + r + 1)] - L[y * w + Math.max(0, x - r)]; } } for (let x = 0; x < w; x++) { let s = 0; for (let y = -r; y <= r; y++) s += t[Math.max(0, Math.min(h - 1, y)) * w + x]; for (let y = 0; y < h; y++) { o[y * w + x] = s / (2 * r + 1); s += t[Math.min(h - 1, y + r + 1) * w + x] - t[Math.max(0, y - r) * w + x]; } } return o; };
    const measure = (im) => { const w = im.width >> 1, h = im.height >> 1, L = new Float32Array(w * h); let sat = 0, mean = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * 2 * im.width + x * 2) * 4, R = im.data[i], G = im.data[i + 1], B = im.data[i + 2]; L[y * w + x] = 0.3 * R + 0.6 * G + 0.1 * B; mean += L[y * w + x]; sat += Math.max(R, G, B) - Math.min(R, G, B); }
      const sd = (r) => { const bl = blur(L, w, h, r); let s = 0; for (let i = 0; i < L.length; i++) s += (L[i] - bl[i]) ** 2; return Math.sqrt(s / L.length); };
      let rgb = [0, 0, 0], corner = 0, mid = 0, nc = 0, nm = 0; for (let y = 0; y < im.height; y += 4) for (let x = 0; x < im.width; x += 4) { const i = (y * im.width + x) * 4; rgb[0] += im.data[i]; rgb[1] += im.data[i + 1]; rgb[2] += im.data[i + 2]; const dx = x / im.width - 0.5, dy = y / im.height - 0.5, r = Math.hypot(dx, dy), v = im.data[i + 1]; if (r > 0.6) { corner += v; nc++; } else if (r < 0.2) { mid += v; nm++; } } const k = (im.width / 4) * (im.height / 4);
      return { mean: +(mean / L.length).toFixed(1), fine: +sd(2).toFixed(2), broad: +sd(40).toFixed(2), sat: +(sat / L.length).toFixed(1), rgb: rgb.map((v) => Math.round(v / k)).join(','), cornerOverMiddle: +(corner / nc / (mid / nm)).toFixed(3) }; };
    const res = {};
    const G = await import('/lab/engine/grade.js');
    for (const [name, m0] of Object.entries(sets)) {
      const more = { ...m0, mixer: m0.values ? G.mixerRows(m0.values) : null, grade: m0.values ? G.gradeRows(m0.values) : null, curve: m0.curves ? G.curveRows(m0.curves) : null };
      await eng.render(0.25, 1, more); const im = await eng.snapshot(); res[name] = measure(im);
      const oc = new OffscreenCanvas(im.width, im.height); oc.getContext('2d').putImageData(im, 0, 0); const sm = new OffscreenCanvas(644, Math.round(644 * im.height / im.width)); sm.getContext('2d').drawImage(oc, 0, 0, sm.width, sm.height);
      const a = document.createElement('a'); a.href = URL.createObjectURL(await sm.convertToBlob({ type: 'image/png' })); a.download = `fx-${tag}-${name}.png`; document.body.append(a); a.click(); a.remove(); await new Promise((q) => setTimeout(q, 300));
    }
    return { res, errs };
  }, { sets, tag });
  for (const [k, v] of Object.entries(out.res || {})) console.log(k.padEnd(12), JSON.stringify(v));
  console.log(out.error || '', 'gpu errors:', JSON.stringify(out.errs)); await p.waitForTimeout(1500); await Promise.all(saves);
  await b.close();
})();

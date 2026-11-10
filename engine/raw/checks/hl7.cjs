// Retouching, measured on the engine page: node hl7.cjs <raf> [u v] [r]   (the spot's centre across and down the picture, 0..1; its radius as a share of the width)
// For Clone and Heal: what changed in the editing copy inside and outside the spot, how near a clone is to its source,
// and whether the sensor's own pixels (a 100 % view, averaged 3 × 3) show the same retouch.
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
const S = __dirname, [file, u = '0.5', v = '0.5', rad = '0.03'] = process.argv.slice(2), tag = process.env.TAG || 'a', GEO = JSON.parse(process.env.GEO || '{}');
(async () => {
  const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader'] });
  const p = await (await b.newContext({ serviceWorkers: 'block' })).newPage();
  p.on('pageerror', (e) => console.log('ERR', e.message)); p.on('console', (m) => { if (/error|warn/i.test(m.type())) console.log('LOG', m.text().slice(0, 700)); });
  await p.goto((process.env.BASE || 'http://127.0.0.1:8080') + '/lab/engine/'); await p.waitForTimeout(4000);
  await p.evaluate(() => { const i = document.createElement('input'); i.type = 'file'; i.id = 'mine'; document.body.append(i); });
  await p.setInputFiles('#mine', file);
  const out = await p.evaluate(async ({ u, v, rad, GEO }) => {
    const buf = await document.querySelector('#mine').files[0].arrayBuffer();
    const w = new Worker('/lab/engine/decode-worker.js', { type: 'module' }); let mosaic = null;
    const r = await new Promise((res) => { let first = null; w.onmessage = (m) => { if (m.data.preview) return; if (m.data.mosaic) { mosaic = m.data.mosaic; res(first); } else if (m.data.error) res(m.data); else first = m.data; }; w.postMessage({ buf, full: true }, [buf]); });
    w.terminate(); if (r.error) return { error: r.error };
    const { engine } = await import('/lab/engine/gpu.js'), { full } = await import('/lab/engine/full.js');
    const errs = [], c = document.createElement('canvas'), eng = await engine(c, r, true);
    eng.gpu.device.addEventListener('uncapturederror', (e) => errs.push(String(e.error?.message).slice(0, 600)));
    eng.setGeometry({ ...GEO }); await eng.render(0.25, 1, {}); const A = await eng.snapshot(), W = A.width, H = A.height;
    const f = await full(eng, r, mosaic), CW = 480, CH = 360, vc = document.createElement('canvas'), view = await f.view(CW, CH, vc, true);
    const png = (id) => { const k = document.createElement('canvas'); k.width = id.width; k.height = id.height; k.getContext('2d').putImageData(id, 0, 0); return k.toDataURL('image/png'); };
    const cut = (im, x0, y0, w2, h2) => { const o = new ImageData(w2, h2); for (let y = 0; y < h2; y++) for (let x = 0; x < w2; x++) for (let k = 0; k < 4; k++) o.data[(y * w2 + x) * 4 + k] = im.data[((y0 + y) * im.width + x0 + x) * 4 + k]; return o; };
    const res = {}, pics = {};
    const q = eng.maskPoint(u, v), e2 = eng.maskPoint(u + rad, v), rm = Math.hypot(e2[0] - q[0], e2[1] - q[1]);
    const src = eng.healSource({ x: q[0], y: q[1], r: rm }, true), ss = eng.shownPoint(src[0], src[1]);
    for (const tool of ['Clone', 'Heal']) {
      eng.setGeometry({ ...GEO, spots: [{ x: q[0], y: q[1], r: rm, sx: src[0], sy: src[1], tool, feather: tool === 'Clone' ? 0.15 : 0.5, opacity: 1 }] });
      await eng.render(0.25, 1, {}); const B = await eng.snapshot(); res[tool + ' rows'] = Array.from(eng.gpu.geo().spots.subarray(0, 24)).map((x) => +x.toFixed(3)).join(' ');
      const cx = u * W, cy = v * H, R = rad * W, ox = (ss[0] - u) * W, oy = (ss[1] - v) * H; let inside = 0, ni = 0, outside = 0, no = 0, like = 0, was = 0, nl = 0;
      for (let y = Math.max(0, Math.floor(cy - 2.2 * R)); y < Math.min(H, cy + 2.2 * R); y++) for (let x = Math.max(0, Math.floor(cx - 2.2 * R)); x < Math.min(W, cx + 2.2 * R); x++) {
        const t = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / R, i = (y * W + x) * 4, d = (Math.abs(B.data[i] - A.data[i]) + Math.abs(B.data[i + 1] - A.data[i + 1]) + Math.abs(B.data[i + 2] - A.data[i + 2])) / 3;
        if (t < 0.7) { inside += d; ni++; const j = (Math.round(y + oy) * W + Math.round(x + ox)) * 4; if (j >= 0 && j + 2 < A.data.length) { like += (Math.abs(B.data[i] - A.data[j]) + Math.abs(B.data[i + 1] - A.data[j + 1]) + Math.abs(B.data[i + 2] - A.data[j + 2])) / 3; was += (Math.abs(A.data[i] - A.data[j]) + Math.abs(A.data[i + 1] - A.data[j + 1]) + Math.abs(A.data[i + 2] - A.data[j + 2])) / 3; nl++; } }
        else if (t > 1.05) { outside += d; no++; }
      }
      // the sensor's own pixels over the spot, averaged 3 × 3, against the editing copy
      const at = await view.region(cx * 3 - CW / 2, cy * 3 - CH / 2, CW, CH); await eng.render(0.25, 1, {}); const img = await view.read();
      const X0 = Math.ceil(at.X / 3), Y0 = Math.ceil(at.Y / 3), nx = Math.floor((at.X + at.cw) / 3) - X0, ny = Math.floor((at.Y + at.ch) / 3) - Y0; let all = 0, na = 0, spot = 0, ns = 0;
      for (let j = 2; j < ny - 2; j++) for (let i = 2; i < nx - 2; i++) { let d = 0; for (let k = 0; k < 3; k++) { let s = 0; for (let b2 = 0; b2 < 3; b2++) for (let a2 = 0; a2 < 3; a2++) s += img.data[(((Y0 + j) * 3 - at.Y + b2) * at.cw + (X0 + i) * 3 - at.X + a2) * 4 + k]; d += Math.abs(s / 9 - B.data[((Y0 + j) * W + X0 + i) * 4 + k]) / 3; }
        all += d; na++; if (Math.hypot(X0 + i + 0.5 - cx, Y0 + j + 0.5 - cy) < R) { spot += d; ns++; } }
      res[tool] = { 'changed inside': +(inside / ni).toFixed(2), 'changed outside': +(outside / no).toFixed(3), 'now like its source': +(like / nl).toFixed(2), 'was like its source': +(was / nl).toFixed(2), '100 % against the editing copy, everywhere': +(all / na).toFixed(2), 'and in the spot': +(spot / (ns || 1)).toFixed(2), view: [at.cw, at.ch] };
      const x0 = Math.max(0, Math.round(cx - 3.5 * R)), y0 = Math.max(0, Math.round(cy - 3.5 * R)), w2 = Math.min(W - x0, Math.round(7 * R)), h2 = Math.min(H - y0, Math.round(7 * R));
      pics[tool] = png(cut(B, x0, y0, w2, h2)); pics.before = png(cut(A, x0, y0, w2, h2)); pics[tool + '100'] = png(img);
    }
    f.dispose(); eng.dispose();
    return { res, errs, size: [W, H], spot: [u, v, rad], source: ss.map((x) => +x.toFixed(4)), pics };
  }, { u: +u, v: +v, rad: +rad, GEO });
  for (const [k, d] of Object.entries(out.pics || {})) fs.writeFileSync(`${S}/shots/hl7-${tag}-${k}.png`, Buffer.from(d.split(',')[1], 'base64')); delete out.pics;
  console.log(JSON.stringify(out, null, 1));
  await b.close();
})();

// Masks, measured on the engine page: node mk6.cjs <raf>. Each case renders and reports the mean colour of the
// picture's left and right halves, top and bottom halves, and middle and rim, against no masks.
const { chromium } = require('playwright');
const S = __dirname, file = process.argv[2], tag = process.env.TAG || 'a';
(async () => {
  const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader'] });
  const p = await (await b.newContext({ serviceWorkers: 'block', acceptDownloads: true })).newPage();
  p.on('pageerror', (e) => console.log('ERR', e.message)); p.on('console', (m) => { if (/error/i.test(m.type())) console.log('LOG', m.text().slice(0, 400)); });
  const saves = []; p.on('download', (d) => saves.push(d.saveAs(`${S}/out/${d.suggestedFilename()}`)));
  await p.goto((process.env.BASE || 'http://127.0.0.1:8080') + '/lab/engine/'); await p.waitForTimeout(4000);
  await p.evaluate(() => { const i = document.createElement('input'); i.type = 'file'; i.id = 'mine'; document.body.append(i); });
  await p.setInputFiles('#mine', file);
  const out = await p.evaluate(async ({ tag }) => {
    const buf = await document.querySelector('#mine').files[0].arrayBuffer();
    const w = new Worker('/lab/engine/decode-worker.js', { type: 'module' });
    const r = await new Promise((res) => { w.onmessage = (m) => { if (m.data.proxy || m.data.error) res(m.data); }; w.postMessage(buf, [buf]); });
    w.terminate(); if (r.error) return { error: r.error };
    const { engine } = await import('/lab/engine/gpu.js'), errs = [], c = document.createElement('canvas'), eng = await engine(c, r, true);
    eng.gpu.device.addEventListener('uncapturederror', (e) => errs.push(String(e.error?.message).slice(0, 400)));
    const zones = (im) => { const { width: W, height: H, data: d } = im, z = { left: [0, 0], right: [0, 0], top: [0, 0], bottom: [0, 0], middle: [0, 0], rim: [0, 0], red: [0, 0], sat: [0, 0] };
      for (let y = 0; y < H; y += 3) for (let x = 0; x < W; x += 3) { const i = (y * W + x) * 4, l = (d[i] + d[i + 1] + d[i + 2]) / 3, add = (k, v = l) => { z[k][0] += v; z[k][1]++; };
        add(x < W / 2 ? 'left' : 'right'); add(y < H / 2 ? 'top' : 'bottom'); const rr = Math.hypot((x / W - 0.5) * 2, (y / H - 0.5) * 2); if (rr < 0.4) add('middle'); else if (rr > 0.9) add('rim'); add('red', d[i] - d[i + 2]); add('sat', Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2])); }
      return Object.fromEntries(Object.entries(z).map(([k, [s, n]]) => [k, +(s / n).toFixed(1)])); };
    const asp = c.height / c.width || 0.667, P = (u, v) => eng.maskPoint(u, v);
    const lin = (u0, v0, u1, v1) => [...P(u0, v0), ...P(u1, v1)];
    const sky = eng.toneAt(0.5, 0.08, 0.25), roof = eng.toneAt(0.7, 0.55, 0.25);
    const cases = {
      none: null,
      'linear top −2 EV': [{ kind: 'Linear', n: 1, vals: { Exposure: -2, Feather: 100 }, invert: false, a: lin(0.5, 0.25, 0.5, 0.75) }],
      'linear left +2 EV': [{ kind: 'Linear', n: 1, vals: { Exposure: 2 }, invert: false, a: lin(0.4, 0.5, 0.6, 0.5) }],
      'radial middle +2 EV': [{ kind: 'Radial', n: 1, vals: { Exposure: 2 }, invert: false, a: [...P(0.5, 0.5), 0.2, 0.2] }],
      'radial inverted −2 EV': [{ kind: 'Radial', n: 1, vals: { Exposure: -2 }, invert: true, a: [...P(0.5, 0.5), 0.2, 0.2] }],
      'colour of the sky, saturation −100': [{ kind: 'Color', n: 1, vals: { Saturation: -100 }, invert: false, pick: sky.slice(1) }],
      'brightness of the sky −2 EV': [{ kind: 'Luminance', n: 1, vals: { Exposure: -2 }, invert: false, pick: [sky[0]] }],
      'whole: temp +100': [{ kind: 'Linear', n: 1, vals: { Temp: 100 }, invert: false, a: lin(0.5, 3, 0.5, 4) }],
      'whole: contrast +100': [{ kind: 'Linear', n: 1, vals: { Contrast: 100 }, invert: false, a: lin(0.5, 3, 0.5, 4) }],
      'whole: hue +50': [{ kind: 'Linear', n: 1, vals: { Hue: 50 }, invert: false, a: lin(0.5, 3, 0.5, 4) }],
      'whole: half amount of −2 EV': [{ kind: 'Linear', n: 1, vals: { Exposure: -2, Amount: 50 }, invert: false, a: lin(0.5, 3, 0.5, 4) }],
      'shown in red': [{ kind: 'Radial', n: 1, vals: {}, invert: false, a: [...P(0.5, 0.5), 0.2, 0.2] }],
      'brush: a short stroke +2 EV': [{ kind: 'Brush', n: 1, vals: { Exposure: 2 }, invert: false, strokes: [{ id: 1, r: 0.06, feather: 0.5, flow: 0.6, erase: false, pts: [...P(0.2, 0.5), ...P(0.4, 0.5)] }] }],
      'brush: the stroke grown +2 EV': [{ kind: 'Brush', n: 1, vals: { Exposure: 2 }, invert: false, strokes: [{ id: 1, r: 0.06, feather: 0.5, flow: 0.6, erase: false, pts: [...P(0.2, 0.5), ...P(0.4, 0.5), ...P(0.6, 0.5), ...P(0.8, 0.5)] }] }],
      'brush: then partly rubbed out': [{ kind: 'Brush', n: 1, vals: { Exposure: 2 }, invert: false, strokes: [{ id: 1, r: 0.06, feather: 0.5, flow: 0.6, erase: false, pts: [...P(0.2, 0.5), ...P(0.4, 0.5), ...P(0.6, 0.5), ...P(0.8, 0.5)] }, { id: 2, r: 0.1, feather: 0.2, flow: 1, erase: true, pts: [...P(0.75, 0.3), ...P(0.75, 0.7)] }] }],
      'brush: the same, laid from nothing': [{ kind: 'Linear', n: 1, vals: {}, invert: false, a: lin(0.5, 3, 0.5, 4) }, { kind: 'Brush', n: 1, vals: { Exposure: 2 }, invert: false, strokes: [{ id: 7, r: 0.06, feather: 0.5, flow: 0.6, erase: false, pts: [...P(0.2, 0.5), ...P(0.4, 0.5), ...P(0.6, 0.5), ...P(0.8, 0.5)] }, { id: 8, r: 0.1, feather: 0.2, flow: 1, erase: true, pts: [...P(0.75, 0.3), ...P(0.75, 0.7)] }] }],
      'two brushes, the second in red': [{ kind: 'Brush', n: 1, vals: { Exposure: -2 }, invert: false, strokes: [{ id: 3, r: 0.1, feather: 0.5, flow: 1, erase: false, pts: [...P(0.2, 0.2), ...P(0.8, 0.2)] }] }, { kind: 'Brush', n: 2, vals: {}, invert: false, strokes: [{ id: 4, r: 0.05, feather: 0.8, flow: 0.3, erase: false, pts: [...P(0.3, 0.8), ...P(0.5, 0.7), ...P(0.7, 0.8)] }] }],
    };
    const res = {};
    for (const [name, masks] of Object.entries(cases)) {
      await eng.render(0.25, 1, { masks, showMaskNo: name === 'shown in red' ? 0 : /second in red/.test(name) ? 1 : -1, baseEv: 0.25 }); const im = await eng.snapshot(); res[name] = zones(im);
      if (/linear top|radial inverted|colour of the sky|brightness|red|rubbed|from nothing/.test(name)) { const oc = new OffscreenCanvas(im.width, im.height); oc.getContext('2d').putImageData(im, 0, 0); const sm = new OffscreenCanvas(644, Math.round(644 * im.height / im.width)); sm.getContext('2d').drawImage(oc, 0, 0, sm.width, sm.height);
        const a = document.createElement('a'); a.href = URL.createObjectURL(await sm.convertToBlob({ type: 'image/png' })); a.download = `mk6-${tag}-${name.replace(/[^a-z0-9]+/gi, '-')}.png`; document.body.append(a); a.click(); a.remove(); await new Promise((q) => setTimeout(q, 300)); }
    }
    return { res, errs, sky, roof, size: [c.width, c.height] };
  }, { tag });
  for (const [k, v] of Object.entries(out.res || {})) console.log(k.padEnd(36), JSON.stringify(v));
  console.log(out.error || '', 'sky', JSON.stringify(out.sky), 'roof', JSON.stringify(out.roof), 'size', out.size, 'gpu errors:', JSON.stringify(out.errs)); await p.waitForTimeout(1500); await Promise.all(saves);
  await b.close();
})();

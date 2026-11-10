// The brightness spread of each sample at rest: node at.cjs  (DIR, FILES)
const { chromium } = require('playwright'); const fs = require('fs');
const S = __dirname;
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext()).newPage(); p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto((process.env.BASE || 'http://127.0.0.1:8080') + '/lab/engine/'); await p.waitForTimeout(4000); await p.evaluate(() => { const i = document.createElement('input'); i.type = 'file'; i.id = 'mine'; document.body.append(i); });
  const rows = [];
  for (const dir of (process.env.DIR || 'raf,raf2').split(',')) for (const f of fs.readdirSync(S + '/' + dir)) {
    if (process.env.FILES && !process.env.FILES.split(',').some(x => f.includes(x))) continue;
    if (dir === 'raf' && /Compressed-Raw|Uncompressed/.test(f) && !/Lossless/.test(f)) continue;
    await p.setInputFiles('#mine', S + '/' + dir + '/' + f);
    const out = await p.evaluate(async () => {
      const file = document.querySelector('#mine').files[0], buf = await file.arrayBuffer();
      const w = new Worker('/lab/engine/decode-worker.js', { type: 'module' }); let pre = {};
      const r = await new Promise((res) => { w.onmessage = (m) => { if (m.data.preview) pre = m.data; else res(m.data); }; w.postMessage(buf, [buf]); });
      w.terminate(); if (r.error) return { error: r.error };
      const A = await import('/lab/engine/auto.js?' + Date.now()), { cameraToProPhoto } = await import('/lab/engine/dcp.js');
      const prof = { cm1: r.meta.xyzToCamD65, cm2: null, fm1: null, fm2: null, t1: 6504, t2: 6504 };
      const conv = cameraToProPhoto(prof, [1 / r.meta.wb[0], 1, 1 / r.meta.wb[2]]), ev = 0.25 + Math.log2((pre.dr || 100) / 100);
      const t0 = performance.now(), q = A.spread(r, conv.matrix.flat ? conv.matrix.flat() : conv.matrix, ev, [0.001, 0.01, 0.05, 0.25, 0.5, 0.75, 0.95, 0.99, 0.999]), ms = performance.now() - t0;
      const mm = conv.matrix.flat ? conv.matrix.flat() : conv.matrix; return { q, ms, dr: pre.dr || 100, auto: A.autoTone(r, mm, ev) };
    });
    rows.push({ f, ...out });
    console.log(f.slice(0, 26).padEnd(27), out.error || (out.q.map(v => v.toFixed(2).padStart(6)).join(' ') + `  DR${out.dr} ${out.ms.toFixed(0)}ms` + (out.auto ? '  ' + JSON.stringify(out.auto) : '')));
  }
  fs.writeFileSync(S + '/at.json', JSON.stringify(rows));
  await b.close();
})();

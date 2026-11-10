// Auto white balance against the camera's own: node awb.cjs  (FILES = comma list under raf/)
const { chromium } = require('playwright'); const fs = require('fs');
const S = __dirname;
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext()).newPage(); p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto((process.env.BASE || 'http://127.0.0.1:8080') + '/lab/engine/'); await p.waitForTimeout(4000); await p.evaluate(() => { const i = document.createElement('input'); i.type = 'file'; i.id = 'mine'; document.body.append(i); });
  const files = (process.env.FILES || fs.readdirSync(S + '/' + (process.env.DIR || 'raf')).join(',')).split(',');
  for (const f of files) {
    await p.setInputFiles('#mine', S + '/' + (process.env.DIR || 'raf') + '/' + f);
    const out = await p.evaluate(async (powers) => {
      const file = document.querySelector('#mine').files[0], buf = await file.arrayBuffer();
      const w = new Worker('/lab/engine/decode-worker.js', { type: 'module' });
      const r = await new Promise((res) => { w.onmessage = (m) => { if (!m.data.preview) res(m.data); }; w.postMessage(buf, [buf]); });
      w.terminate(); if (r.error) return r.error;
      const { neutralAuto, neutralAt } = await import('/lab/engine/white.js'), { whiteOf } = await import('/lab/engine/dcp.js');
      const prof = { cm1: r.meta.xyzToCamD65, cm2: null, fm1: null, fm2: null, t1: 6504, t2: 6504 };
      const shot = whiteOf(prof, [1 / r.meta.wb[0], 1, 1 / r.meta.wb[2]]), line = [`shot ${Math.round(shot.kelvin)} K ${shot.tint.toFixed(0)}`];
      const mired = (k) => 1e6 / k; let sum = [];
      for (const [bl, top, rad] of powers) { const t0 = performance.now(), n = neutralAuto(r, bl, top, rad), ms = performance.now() - t0, a = n && whiteOf(prof, n); line.push(`b${bl} t${top} r${rad}: ${a ? Math.round(a.kelvin) + ' K ' + a.tint.toFixed(0) + ' d' + (mired(a.kelvin) - mired(shot.kelvin)).toFixed(0) : 'none'} (${ms.toFixed(0)} ms)`); }
      return line.join(' · ');
    }, (process.env.P || '4:0.001:3').split(',').map((v) => v.split(':').map(Number)));
    console.log(f.slice(0, 34).padEnd(35), out);
  }
  await b.close();
})();

// Table vs exact maths, and what blown highlights do when exposure comes down.
const { chromium } = require('playwright');
const S = __dirname;
(async () => {
  const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader'] });
  const errs = [];
  const files = (process.env.FILES || 'raf/DSCF0021.RAF,raf/Fuji-X-H2-Lossless-Compressed-Raw.RAF').split(',');
  const profiles = (process.env.PROFILES || 'Adobe Standard,PROVIA,CLASSIC CHROME,Velvia,CLASSIC Neg').split(',');
  for (const file of files) {
    const p = await b.newPage({ viewport: { width: 412, height: 900 }, serviceWorkers: 'block' });
    p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
    if (process.env.VAR) { const [n, tet] = process.env.VAR.split(',');
      await p.route('**/lab/engine/wgsl.js', async (r) => { const res = await r.fetch(); let t = await res.text(); t = t.replace('export const N = 65;', `export const N = ${n};`).replace('const TET = true;', `const TET = ${tet};`); await r.fulfill({ response: res, body: t }); }); }
    await p.goto((process.env.BASE || 'http://127.0.0.1:8080') + '/lab/engine/?readback');
    await p.setInputFiles('#profiles', S + '/xe5-profiles.zip'); await p.waitForTimeout(1200);
    await p.setInputFiles('#file', S + '/' + file);
    for (let i = 0; i < 40; i++) { await p.waitForTimeout(1500); if (await p.evaluate(() => !!window.__check)) break; }
    for (const want of profiles) {
      const v = await p.evaluate((w) => [...document.querySelectorAll('#profile option')].find(o => o.textContent.includes(w))?.value, want);
      if (v === undefined) { console.log('no profile', want); continue; }
      await p.evaluate(() => { window.__check = null; });
      await p.selectOption('#profile', v);
      for (let i = 0; i < 20; i++) { await p.waitForTimeout(800); if (await p.evaluate(() => !!window.__check)) break; }
      const r = await p.evaluate(async () => {
        const { gap } = await import('/lab/engine/compare.js'); const eng = window.__engine, out = [];
        for (const [ev, ct, more] of [[0.25, 1, {}], [0.25, 1, { saturation: 0.5 }], [0.25, 1, { saturation: 1 }], [0.25, 1, { vibrance: 1 }], [0.25, 1, { saturation: -0.5 }], [0.25, 1, { vibrance: -1 }]]) {
          await eng.render(ev, ct, { ...more, screen: false, dither: false }); const a = await eng.snapshot();
          const t = performance.now(); await eng.render(ev, ct, { ...more, screen: false, exact: true, dither: false }); const ms = performance.now() - t; const e = await eng.snapshot();
          const g = gap(a, e, 5); out.push(`ev ${ev} ct ${ct}${' ' + JSON.stringify(more)}: mean ${g.mean.toFixed(3)} p99 ${g.p99.toFixed(2)} max ${g.max.toFixed(2)} (exact ${Math.round(ms)} ms)`);
        }
        return out;
      });
      console.log(file.split('/')[1].slice(0, 12), want.padEnd(15), '\n   ' + r.join('\n   '));
    }
    if (process.env.SHOTS) for (const ev of [0, -2.5]) {
      await p.evaluate((e) => { const s = document.getElementById('ev'); s.value = String(e); s.dispatchEvent(new Event('input')); }, ev);
      await p.waitForTimeout(2500);
      await p.locator('#view').screenshot({ path: `${S}/shots/hl-${file.split('/')[1].slice(0, 8)}-${ev}.png` });
    }
    await p.close();
  }
  console.log('errors', JSON.stringify(errs.slice(0, 3)));
  await b.close();
})();

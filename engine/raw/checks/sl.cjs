// The test page's sliders: move each, check the picture and its read-out change, then that zero restores the picture.
const { chromium } = require('playwright');
const S = __dirname;
(async () => {
  const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader'] });
  const errs = [];
  const p = await b.newPage({ viewport: { width: 412, height: 900 }, serviceWorkers: 'block' });
  p.on('pageerror', e => errs.push(e.message)); p.on('console', m => /error|warning/.test(m.type()) && errs.push(m.text().slice(0, 300)));
  await p.goto((process.env.BASE || 'http://127.0.0.1:8080') + '/lab/engine/?readback');
  await p.setInputFiles('#profiles', S + '/xe5-profiles.zip'); await p.waitForTimeout(1500);
  await p.setInputFiles('#file', S + '/' + (process.env.FILE || 'raf/DSCF0021.RAF'));
  for (let i = 0; i < 60; i++) { await p.waitForTimeout(1500); if (await p.evaluate(() => !!window.__check)) break; }
  const mean = () => p.evaluate(async () => { const d = (await window.__engine.snapshot()).data; let s = 0, n = 0; for (let i = 0; i < d.length; i += 4004) { s += d[i] + d[i + 1] + d[i + 2]; n += 3; } return +(s / n).toFixed(2); });
  const set = async (id, v) => { await p.evaluate(([id, v]) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }, [id, String(v)]); await p.waitForTimeout(2500); };
  const base = await mean(); console.log('base', base);
  for (const id of (process.env.IDS || 'ct,hi,sh,wh,bl').split(',')) {
    const out = [];
    for (const v of [100, -100, 0]) { await set(id, v); out.push(`${v}: ${await mean()} [${await p.evaluate((id) => document.getElementById(id + 'v')?.textContent, id)}]`); }
    console.log(id, out.join('  '));
  }
  console.log('back to base:', base === await mean(), 'errors:', JSON.stringify(errs));
  await p.screenshot({ path: S + '/shots/sl.png', fullPage: true });
  await b.close();
})();

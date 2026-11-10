const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader'] });
  const errs = [];
  for (const file of ['raf/DSCF0021.RAF', 'raf/Fuji-X-H2-Lossless-Compressed-Raw.RAF']) {
    const p = await b.newPage({ viewport: { width: 412, height: 900 } });
    p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
    await p.goto((process.env.BASE || 'http://127.0.0.1:8080') + '/lab/engine/?readback');
    await p.setInputFiles('#profiles', 'xe5-profiles.zip'); await p.waitForTimeout(1200);
    await p.setInputFiles('#file', file);
    for (let i = 0; i < 40; i++) { await p.waitForTimeout(1500); if (await p.evaluate(() => !!window.__check)) break; }
    for (const want of ['Adobe Standard', 'PROVIA', 'CLASSIC CHROME', 'Velvia']) {
      const v = await p.evaluate((w) => [...document.querySelectorAll('#profile option')].find(o => o.textContent.includes(w))?.value, want);
      await p.evaluate(() => { window.__check = null; });
      await p.selectOption('#profile', v);
      for (let i = 0; i < 20; i++) { await p.waitForTimeout(800); if (await p.evaluate(() => !!window.__check)) break; }
      const c = await p.evaluate(() => window.__check);
      console.log(file.split('/')[1], want.padEnd(15), c && `EV ${c.ev.toFixed(2)}  dE ${c.mean.toFixed(2)}  p90 ${c.p90.toFixed(2)}  n ${c.n}`);
    }
    await p.close();
  }
  console.log('errors', JSON.stringify(errs.slice(0, 3)));
  await b.close();
})();

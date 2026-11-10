const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader'] });
  const p = await b.newPage({ viewport: { width: 412, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
  await p.goto((process.env.BASE || 'http://127.0.0.1:8080') + '/lab/engine/?readback');
  await p.setInputFiles('#file', 'raf/DSCF0021.RAF');
  for (let i = 0; i < 30; i++) { await p.waitForTimeout(2000); const t = await p.evaluate(() => document.getElementById('stats').innerText); if (i % 5 === 0 || /Ready|Couldn|WebGPU|adapter/.test(t)) console.log(i, t.replace(/\n/g, ' | ')); if (/Ready|Couldn|WebGPU|adapter/.test(t)) break; }
  await p.fill('#ev', '0.7'); await p.dispatchEvent('#ev', 'input'); await p.waitForTimeout(1500);
  console.log((await p.evaluate(() => document.getElementById('stats').innerText)).replace(/\n/g, ' | '));
  await p.screenshot({ path: 'shots/engine.png', fullPage: true });
  console.log('errors', JSON.stringify(errs));
  await b.close();
})();

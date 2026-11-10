const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader'] });
  const ctx = await b.newContext({ serviceWorkers: 'block' }); const p = await ctx.newPage(); const logs = [];
  p.on('console', (m) => logs.push(m.type() + ': ' + m.text())); p.on('pageerror', (e) => logs.push('ERR ' + e.message));
  await p.goto((process.env.BASE || 'http://127.0.0.1:8080') + '/lab/engine/?readback'); await p.waitForTimeout(4000);
  await p.setInputFiles('#file', __dirname + '/raf/DSCF0021.RAF'); await p.waitForTimeout(15000);
  console.log((await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 420));
  console.log(logs.filter((l) => !/deprecated|willReadFrequently/.test(l)).slice(0, 6).join('\n'));
  await b.close();
})();

const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader'] });
  const p = await (await b.newContext()).newPage(); const logs = []; p.on('console', m => logs.push(m.text())); p.on('pageerror', e => logs.push(e.message));
  if (!process.env.FRESH) { await p.goto((process.env.BASE || 'http://127.0.0.1:8080') + '/'); await p.waitForTimeout(4000); }
  if (!process.env.FRESH) console.log('sw', await p.evaluate(async () => !!(await navigator.serviceWorker.getRegistration('/'))?.active));
  await p.goto((process.env.BASE || 'http://127.0.0.1:8080') + '/lab/engine/index.html?readback'); await p.waitForTimeout(8000);
  console.log('isolated', await p.evaluate(() => crossOriginIsolated));
  await p.setInputFiles('#file', process.argv[2]);
  for (let i = 0; i < 60; i++) { await p.waitForTimeout(1000); if (/Decode/.test(await p.evaluate(() => document.querySelector('#stats').textContent))) break; }
  console.log(await p.evaluate(() => [...document.querySelectorAll('#stats dt')].map(d => d.textContent + ': ' + d.nextElementSibling.textContent).filter(t => /Decode|Threads/.test(t))), logs.filter(l => !/deprecated/.test(l)).slice(0, 4));
  await b.close();
})();

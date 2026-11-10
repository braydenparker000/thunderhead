// The stage timer on the engine test page: click it, print what it wrote, and check the picture is left as it was.
const { chromium } = require('playwright');
const S = __dirname;
(async () => {
  const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader'] });
  const errs = [], file = process.env.FILE || 'raf/DSCF0021.RAF';
  const p = await b.newPage({ viewport: { width: 412, height: 900 }, serviceWorkers: 'block' });
  p.on('pageerror', e => errs.push(e.message)); p.on('console', m => /error|warning/.test(m.type()) && errs.push(m.text().slice(0, 300)));
  await p.goto((process.env.BASE || 'http://127.0.0.1:8080') + '/lab/engine/?readback');
  console.log('button disabled before a photo:', await p.evaluate(() => document.querySelector('#time').disabled));
  await p.setInputFiles('#profiles', S + '/xe5-profiles.zip'); await p.waitForTimeout(1500);
  await p.setInputFiles('#file', S + '/' + file);
  for (let i = 0; i < 60; i++) { await p.waitForTimeout(1500); if (await p.evaluate(() => !!window.__check)) break; }
  const sum = () => p.evaluate(async () => { const d = (await window.__engine.snapshot()).data; let s = 0; for (let i = 0; i < d.length; i += 4001) s += d[i]; return s; });
  const before = await sum();
  await p.click('#time');
  for (let i = 0; i < 120; i++) { await p.waitForTimeout(1500); if (await p.evaluate(() => /Saturation \+50/.test(document.querySelector('#stats').textContent))) break; }
  await p.waitForTimeout(3000);
  console.log(await p.evaluate(() => [...document.querySelectorAll('#stats dt')].filter(d => /Timed|Frame/.test(d.textContent)).map(d => d.textContent + ' = ' + d.nextSibling.textContent).join('\n')));
  console.log('picture as before:', before === await sum(), 'errors:', JSON.stringify(errs));
  await p.screenshot({ path: S + '/shots/tm.png', fullPage: true });
  await b.close();
})();

// The engine page's own readout for a RAF: node st.cjs   (FILE from the environment)
const { chromium } = require('playwright');
const S = __dirname, E = process.env, FILE = E.FILE || 'raf/DSCF0021.RAF', BASE = E.BASE || 'http://127.0.0.1:8080';
(async () => {
  const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader'] });
  const p = await (await b.newContext({ viewport: { width: 384, height: 780 } })).newPage(); p.on('pageerror', (e) => console.log('ERR', e.message));
  await p.goto(BASE + '/'); await p.waitForTimeout(2500);
  await p.goto(BASE + '/lab/engine/?readback'); await p.waitForTimeout(4000);
  await p.setInputFiles('#file', S + '/' + FILE);
  await p.waitForFunction(() => /To developed image/.test(document.querySelector('#stats')?.innerText || ''), null, { timeout: 120000 });
  console.log(await p.evaluate(() => document.querySelector('#stats').innerText));
  await b.close();
})();

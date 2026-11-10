const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader'] });
  const p = await b.newPage({ viewport: { width: 412, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => (m.type() === 'error' || m.type() === 'warning') && errs.push(m.text()));
  await p.goto((process.env.BASE || 'http://127.0.0.1:8080') + '/lab/engine/?readback');
  await p.setInputFiles('#profiles', 'xe5-profiles.zip');
  await p.waitForTimeout(1500);
  await p.setInputFiles('#file', process.argv[2] || 'raf/DSCF0021.RAF');
  for (let i = 0; i < 40; i++) { await p.waitForTimeout(1500); const t = await p.evaluate(() => document.getElementById('stats').innerText); if (/Ready|Couldn/.test(t) && /Frame/.test(t)) break; }
  const opts = await p.evaluate(() => [...document.querySelectorAll('#profile option')].map(o => o.value + ':' + o.textContent));
  console.log(opts.join(' | '));
  for (const want of ['Adobe Standard', 'CLASSIC CHROME', 'CLASSIC Neg', 'Velvia']) {
    const v = await p.evaluate((w) => [...document.querySelectorAll('#profile option')].find(o => o.textContent.includes(w))?.value, want);
    if (v === undefined) { console.log('missing', want); continue; }
    await p.selectOption('#profile', v); await p.waitForTimeout(2500);
    await p.locator('#view').screenshot({ path: `shots/prof-${want.replace(/ /g, '_')}.png` });
    console.log(want, await p.evaluate(() => document.getElementById('which').textContent + ' · ' + document.getElementById('kelvin').textContent));
  }
  await p.locator('#preview').screenshot({ path: 'shots/prof-camera-jpeg.png' }).catch(() => {});
  console.log((await p.evaluate(() => document.getElementById('stats').innerText)).replace(/\n/g, ' | '));
  console.log('errors', JSON.stringify(errs.slice(0, 5)));
  await b.close();
})();

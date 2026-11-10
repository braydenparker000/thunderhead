// Adobe Color in the engine page: does it list, render, and how does it differ from Adobe Standard; highlights before/after.
const { chromium } = require('playwright');
const S = __dirname;
(async () => {
  const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader'] });
  const errs = [];
  const file = process.env.FILE || 'raf/Fuji-X-H2-Uncompressed-Raw.RAF';
  const p = await b.newPage({ viewport: { width: 412, height: 900 }, serviceWorkers: 'block' });
  p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
  await p.goto((process.env.BASE || 'http://127.0.0.1:8080') + '/lab/engine/?readback');
  await p.setInputFiles('#profiles', S + '/xe5-profiles.zip'); await p.waitForTimeout(1500);
  await p.setInputFiles('#file', S + '/' + file);
  for (let i = 0; i < 60; i++) { await p.waitForTimeout(1500); if (await p.evaluate(() => !!window.__check)) break; }
  console.log('options', await p.evaluate(() => [...document.querySelectorAll('#profile option')].map(o => o.textContent).join(' | ')));
  console.log('picked', await p.evaluate(() => document.querySelector('#profile').selectedOptions[0].textContent), '·', await p.evaluate(() => document.getElementById('which').textContent));
  console.log('stats', await p.evaluate(() => document.getElementById('stats').innerText.replace(/\n/g, ' ; ')));
  const tag = file.split('/')[1].slice(0, 14);
  const shot = async (name) => { await p.waitForTimeout(1800); await p.locator('#view').screenshot({ path: `${S}/shots/${tag}-${name}.png` }); };
  const set = (id, v) => p.evaluate(([id, v]) => { const s = document.getElementById(id); if (s.type === 'checkbox') { s.checked = v; s.dispatchEvent(new Event('change')); } else { s.value = String(v); s.dispatchEvent(new Event('input')); } }, [id, v]);
  const sel = async (w) => { const v = await p.evaluate((w) => [...document.querySelectorAll('#profile option')].find(o => o.textContent === w)?.value, w); if (v === undefined) return false; await p.evaluate(() => { window.__check = null; }); await p.selectOption('#profile', v); for (let i = 0; i < 20; i++) { await p.waitForTimeout(800); if (await p.evaluate(() => !!window.__check)) break; } return true; };
  for (const w of (process.env.PROFILES || 'Adobe Color,Adobe Standard,Adobe Neutral,Adobe Portrait').split(',')) {
    if (!await sel(w)) { console.log('no', w); continue; }
    console.log(w, JSON.stringify(await p.evaluate(() => window.__check)));
    await shot(w.replace(/ /g, '-'));
  }
  await sel('Adobe Color');
  for (const ev of (process.env.EVS || '-2.5').split(',').map(Number)) {
    await set('ev', ev); await set('hl', true); await shot(`ev${ev}-rebuilt`);
    await set('hl', false); await shot(`ev${ev}-clipped`); await set('hl', true);
  }
  console.log('stats', await p.evaluate(() => document.getElementById('stats').innerText.replace(/\n/g, ' ; ')));
  console.log('errors', JSON.stringify(errs.slice(0, 5)));
  await b.close();
})();

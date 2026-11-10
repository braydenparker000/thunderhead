// How long the View board takes to get its before picture and histogram after an edit (headless).
const { chromium } = require('playwright');
const S = __dirname, E = process.env, FILE = E.FILE || 'raf2/X100VI__DSCF0074.RAF';
(async () => {
  const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 384, height: 780 }, deviceScaleFactor: 1, hasTouch: true });
  const p = await ctx.newPage(); p.on('pageerror', (e) => console.log('ERR ' + e.message)); p.on('console', (m) => { if (/error/i.test(m.type())) console.log('LOG', m.text().slice(0, 300)); });
  await p.goto((process.env.BASE || 'http://127.0.0.1:8080') + '/'); await p.waitForTimeout(3000);
  await p.goto((process.env.BASE || 'http://127.0.0.1:8080') + '/lab/editor/index.html?readback'); await p.waitForTimeout(5000);
  await p.getByRole('button', { name: 'Import' }).click(); await p.waitForTimeout(300);
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.getByText('Choose photos').click()]);
  await fc.setFiles([S + '/' + FILE]);
  await p.waitForFunction(() => /Done/.test(document.body.textContent), null, { timeout: 90000 });
  await p.getByRole('button', { name: 'Import' }).click().catch(() => {});
  await p.locator('[role=list] button, button[aria-label$="RAF"], button[aria-label*="X-"], button[aria-label*="DSCF"]').first().click();
  await p.waitForFunction(() => document.querySelector('canvas[aria-label="The photo being edited"]')?.isConnected, null, { timeout: 120000 }); await p.waitForTimeout(9000);
  await p.evaluate(async () => { const s = await import('/lab/editor/app/session.js'); s.turn('Exposure', 0.8); }); await p.waitForTimeout(+(E.REST || 3000));
  await p.getByRole('button', { name: /Back to the tools/i }).click(); await p.waitForTimeout(400);
  await p.locator('#dock button[data-go="Versions"]').click(); const t0 = Date.now();
  for (let i = 0; i < 20; i++) { await p.waitForTimeout(2000);
    const v = await p.evaluate(() => ({ imgs: [...document.querySelectorAll('#stage img')].filter((i) => i.src.startsWith('blob:')).length, paths: [...document.querySelectorAll('svg[aria-label=Histogram] path')].map((x) => (x.getAttribute('d') || '').length), nav: !!document.querySelector('nav[aria-label=View]'), hist: !!document.querySelector('svg[aria-label=Histogram]') }));
    console.log(((Date.now() - t0) / 1000).toFixed(0) + ' s', JSON.stringify(v)); if (v.imgs && v.paths.length === 3 && v.paths[0] > 100) break; }
  await p.getByRole('button', { name: 'VERSIONS', exact: true }).click(); await p.waitForTimeout(800);
  await p.locator('[role=listbox][aria-label=Versions] button').last().click(); const t1 = Date.now();
  for (let i = 0; i < 20; i++) { await p.waitForTimeout(2000); const v = await p.evaluate(() => [...document.querySelectorAll('[role=listbox][aria-label=Versions] button')].map((x) => x.textContent.trim() + (x.querySelector('img')?.src.startsWith('blob:') ? '+img' : '')));
    console.log(((Date.now() - t1) / 1000).toFixed(0) + ' s', JSON.stringify(v)); if (v.length === 3 && /\+img/.test(v[1])) break; }
  await b.close();
})();

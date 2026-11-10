// Times off-screen pictures in the editor with and without the step 5 tools (headless: relative numbers only).
const { chromium } = require('playwright');
const S = __dirname, E = process.env, FILE = E.FILE || 'raf2/X100VI__DSCF0074.RAF';
(async () => {
  const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 384, height: 780 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage(); p.on('pageerror', (e) => console.log('ERR ' + e.message));
  await p.goto((process.env.BASE || 'http://127.0.0.1:8080') + '/'); await p.waitForTimeout(3000);
  await p.goto((process.env.BASE || 'http://127.0.0.1:8080') + '/lab/editor/index.html?readback'); await p.waitForTimeout(5000);
  await p.getByRole('button', { name: 'Import' }).click(); await p.waitForTimeout(300);
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.getByText('Choose photos').click()]);
  await fc.setFiles([S + '/' + FILE]);
  await p.waitForFunction(() => /Done/.test(document.body.textContent), null, { timeout: 90000 });
  await p.getByRole('button', { name: 'Import' }).click().catch(() => {});
  await p.locator('[role=list] button, button[aria-label$="RAF"], button[aria-label*="X-"], button[aria-label*="DSCF"]').first().click();
  await p.waitForFunction(() => document.querySelector('canvas[aria-label="The photo being edited"]')?.isConnected, null, { timeout: 120000 }); await p.waitForTimeout(12000);
  const time = (label) => p.evaluate(async (label) => { const s = await import('/lab/editor/app/session.js'); const t = []; const st0 = s.state();
    for (let i = 0; i < 3; i++) { const a = performance.now(); await s.pixels(); t.push(Math.round(performance.now() - a)); }
    const a = performance.now(); const u = await s.picture({ ...st0, values: { ...st0.values, Contrast: 37 } }, 132); URL.revokeObjectURL(u); const two = Math.round(performance.now() - a);
    return `${label}: pixels ${t.join(' ')} ms · a picture of another edit (a bake) ${two} ms`; }, label);
  console.log(await time('plain'));
  await p.evaluate(async () => { const s = await import('/lab/editor/app/session.js'); s.setValues({ 'Mix Blue Sat': 60, 'Grade Shadows Lum': 60, 'Grade Shadows Sat': 50, Vignette: 60 }, '', 'Test'); s.setCurve('RGB', [[0, 0], [0.3, 0.2], [1, 1]]); });
  await p.waitForTimeout(12000);
  console.log(await time('tools on'));
  await b.close();
})();

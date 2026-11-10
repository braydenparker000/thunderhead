// The engine's full-size view driven directly, with the GPU's errors printed: node dbg.cjs
const { chromium } = require('playwright');
const S = __dirname, E = process.env, FILE = E.FILE || 'raf/DSCF0021.RAF', BASE = E.BASE || 'http://127.0.0.1:8080';
(async () => {
  const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader'] });
  const p = await (await b.newContext({ viewport: { width: 384, height: 780 }, hasTouch: true })).newPage(); p.on('console', (m) => { const t = m.text(); if (!/deprecated|experimental/.test(t)) console.log('page:', t.slice(0, 900)); }); p.on('pageerror', (e) => console.log('ERR', e.message));
  await p.goto(BASE + '/'); await p.waitForTimeout(2000);
  await p.goto(BASE + '/lab/editor/index.html?readback'); await p.waitForTimeout(4000);
  await p.getByRole('button', { name: 'Import' }).click(); await p.waitForTimeout(300);
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.getByText('Choose photos').click()]);
  await fc.setFiles([S + '/' + FILE]);
  await p.waitForFunction(() => /Done/.test(document.body.textContent), null, { timeout: 90000 });
  await p.getByRole('button', { name: 'Import' }).click().catch(() => {});
  await p.locator('[role=list] button, button[aria-label$="RAF"], button[aria-label*="X-"], button[aria-label*="DSCF"]').first().click();
  for (let c = 0, i = 0; c < 4 && i < 300; i++) { await p.waitForTimeout(400); c = (await p.evaluate(async () => { const s = await import('/lab/editor/app/session.js'); return s.busy() || !s.ready || !s.whole(); })) ? 0 : c + 1; }
  const r = await p.evaluate(async () => {
    const s = await import('/lab/editor/app/session.js'), big = s.whole(), dev = s.eng.gpu.device, errs = [];
    dev.addEventListener('uncapturederror', (e) => errs.push(e.error.message.slice(0, 600)));
    dev.pushErrorScope('validation');
    const v = await big.view(300, 300, null, true); v.place(3000, 2000, 300, 300); await s.frame();
    const e1 = await dev.popErrorScope(); const im = await v.read(); let sum = 0; for (let i = 0; i < im.data.length; i += 4) sum += im.data[i] + im.data[i + 1] + im.data[i + 2];
    return { scope: e1 && e1.message.slice(0, 900), errs, mean: sum / (im.data.length / 4) / 3 };
  }).catch((e) => ({ thrown: String(e).slice(0, 600) }));
  console.log(JSON.stringify(r, null, 1)); await b.close();
})();

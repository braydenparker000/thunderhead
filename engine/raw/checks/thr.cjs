const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader'] });
  for (const iso of [false, true]) {
    const ctx = await b.newContext({ serviceWorkers: 'block' });
    if (iso) await ctx.route('**/lab/engine/**', async (r) => { const res = await r.fetch(); r.fulfill({ response: res, headers: { ...res.headers(), 'cross-origin-embedder-policy': 'require-corp', 'cross-origin-opener-policy': 'same-origin' } }); });
    const p = await ctx.newPage(); const logs = []; p.on('console', m => logs.push(m.text())); p.on('worker', w => w.on('console', m => logs.push('w: ' + m.text()))); p.on('pageerror', e => logs.push(e.message));
    await p.goto((process.env.BASE || 'http://127.0.0.1:8080') + '/lab/engine/?readback');
    await p.setInputFiles('#file', process.argv[2]);
    for (let i = 0; i < 60; i++) { await p.waitForTimeout(1000); const t = await p.evaluate(() => document.querySelector('#stats').textContent); if (/Decode/.test(t)) break; }
    console.log(iso ? 'isolated' : 'plain', await p.evaluate(() => [crossOriginIsolated, [...document.querySelectorAll('#stats dt')].map(d => d.textContent + ': ' + d.nextElementSibling.textContent).filter(t => /Decode|Status/.test(t))]), logs.slice(0, 3));
    await ctx.close();
  }
  await b.close();
})();

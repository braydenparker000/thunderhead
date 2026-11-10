// Step 5 export check: the saved full-size file against the fitted photo on screen, with the new tools on.
const { chromium } = require('playwright'); const fs = require('fs');
const S = __dirname, E = process.env, TAG = E.TAG || 'a', FILE = E.FILE || 'raf/DSCF0021.RAF';
(async () => {
  const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 384, height: 780 }, deviceScaleFactor: 1, acceptDownloads: true });
  const p = await ctx.newPage(); const logs = []; p.on('console', (m) => { if (/error/i.test(m.type())) logs.push(m.text().slice(0, 300)); }); p.on('pageerror', (e) => logs.push('ERR ' + e.message));
  const saves = []; p.on('download', (d) => saves.push(d.saveAs(`${S}/out/e5-${TAG}-${d.suggestedFilename()}`).then(() => d.suggestedFilename())));
  await p.goto((process.env.BASE || 'http://127.0.0.1:8080') + '/'); await p.waitForTimeout(3000);
  await p.goto((process.env.BASE || 'http://127.0.0.1:8080') + '/lab/editor/index.html?readback'); await p.waitForTimeout(5000);
  await p.getByRole('button', { name: 'Import' }).click(); await p.waitForTimeout(300);
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.getByText('Choose photos').click()]);
  await fc.setFiles([S + '/' + FILE]);
  await p.waitForFunction(() => /Done/.test(document.body.textContent), null, { timeout: 90000 });
  await p.getByRole('button', { name: 'Import' }).click().catch(() => {});
  await p.locator('[role=list] button, button[aria-label$="RAF"], button[aria-label*="X-"], button[aria-label*="DSCF"]').first().click();
  await p.waitForFunction(() => document.querySelector('canvas[aria-label="The photo being edited"]')?.isConnected, null, { timeout: 120000 }); await p.waitForTimeout(9000);
  if (E.PLAIN) await p.evaluate(() => { window.__plain = true; });
  await p.evaluate(async () => { const s = await import('/lab/editor/app/session.js');
    if (!window.__plain) s.setValues({ 'Mix Blue Sat': -60, 'Mix Orange Hue': 60, 'Mix Green Lum': 40, 'Grade Shadows Hue': 220, 'Grade Shadows Sat': 80, 'Grade Highlights Hue': 40, 'Grade Highlights Sat': 70, 'Grade Midtones Lum': 20, Balance: 20, Vignette: -70, Sharpening: 0 }, '', 'Test');
    if (!window.__plain) { s.setCurve('RGB', [[0, 0.04], [0.25, 0.18], [0.75, 0.84], [1, 0.97]]); s.setCurve('B', [[0, 0], [0.5, 0.58], [1, 1]]); } });
  if (E.PRE) await p.evaluate(async (ops) => { const m = { s: await import('/lab/editor/app/session.js'), mk: await import('/lab/editor/app/masks.js'), hl: await import('/lab/editor/app/heal.js') }; for (const [mod, fn, ...args] of ops) await m[mod][fn](...args); }, JSON.parse(E.PRE));   // PRE: a JSON list of ["s" | "mk", function, ...arguments]
  const t0 = Date.now(); for (let calm = 0, i = 0; calm < 4 && i < 400; i++) { await p.waitForTimeout(500); calm = (await p.evaluate(async () => (await import('/lab/editor/app/session.js')).busy())) ? 0 : calm + 1; } console.log('drawn after', Math.round((Date.now() - t0) / 1000), 's');
  const png = await p.evaluate(() => document.querySelector('#frame > div:first-child .fillphoto > canvas').toDataURL('image/png'));
  fs.writeFileSync(`${S}/out/e5-${TAG}-screen.png`, Buffer.from(png.split(',')[1], 'base64'));
  await p.locator('header button', { hasText: /^Export$/ }).click(); await p.waitForTimeout(2000);
  await p.getByRole('button', { name: /SAVE/ }).first().click();
  await p.waitForFunction(() => /Saved to Downloads|Not saved/.test(document.body.textContent), null, { timeout: 800000 }).catch(() => console.log("never finished"));
  await p.waitForTimeout(2500); console.log('saved', (await Promise.all(saves)).join(' '), '·', await p.evaluate(() => { const t = document.body.innerText, k = t.search(/Saved to Downloads|Not saved/i); return k < 0 ? '(no message)' : t.slice(k, k + 260).replace(/\n+/g, ' | '); }));
  console.log(logs.length ? logs.slice(0, 6).join('\n') : 'no console errors');
  await b.close();
})();

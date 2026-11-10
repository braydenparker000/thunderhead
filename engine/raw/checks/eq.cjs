// The editor's Export board, headless: import a RAF, open it, Export, save both presets, keep the downloads.
const { chromium } = require('playwright');
const S = __dirname, E = process.env, TAG = E.TAG || 'a', FILE = E.FILE || 'raf2/X-E4__fuji_xe4_32_lossless.RAF';
(async () => {
  const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1, acceptDownloads: true });
  const p = await ctx.newPage(); const logs = []; p.on('console', (m) => logs.push(m.type() + ': ' + m.text())); p.on('pageerror', (e) => logs.push('ERR ' + e.message));
  const saves = []; p.on('download', (d) => saves.push(d.saveAs(`${S}/out/eq-${TAG}-${d.suggestedFilename()}`).then(() => d.suggestedFilename())));
  await p.goto((process.env.BASE || 'http://127.0.0.1:8080') + '/'); await p.waitForTimeout(3000);
  await p.goto((process.env.BASE || 'http://127.0.0.1:8080') + '/lab/editor/index.html?readback'); await p.waitForTimeout(5000);
  await p.getByRole('button', { name: 'Import' }).click(); await p.waitForTimeout(300);
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.getByText('Choose photos').click()]);
  await fc.setFiles([S + '/' + FILE]);
  await p.waitForFunction(() => /Done/.test(document.body.textContent), null, { timeout: 90000 });
  await p.getByRole('button', { name: 'Import' }).click().catch(() => {});
  await p.locator('[role=list] button, button[aria-label$="RAF"], button[aria-label*="DSCF"], button[aria-label*="X-"]').first().click();
  await p.waitForFunction(() => document.querySelector('canvas[aria-label="The photo being edited"]')?.isConnected, null, { timeout: 120000 }); await p.waitForTimeout(9000);
  if (E.GEO) { await p.evaluate(async (g) => { const m = await import('/lab/editor/app/session.js'); m.setGeo(JSON.parse(g)); }, E.GEO); await p.waitForTimeout(7000); }
  await p.locator('header button', { hasText: /^Export$/ }).click(); await p.waitForTimeout(2500);
  const text = () => p.evaluate(() => document.querySelector('#stage').innerText.replace(/\s+/g, ' ').slice(0, 520));
  console.log('board:', await text()); await p.screenshot({ path: `${S}/shots/eq-${TAG}-export.png` });
  const t0 = Date.now();
  await p.getByRole('button', { name: /SAVE BOTH/ }).click(); await p.waitForTimeout(4000);
  console.log('working:', (await text()).match(/SAVING[^%]*%/)?.[0]); await p.screenshot({ path: `${S}/shots/eq-${TAG}-working.png` });
  await p.waitForFunction(() => /Saved to Downloads|Not saved/.test(document.body.textContent), null, { timeout: 560000 }).catch(() => console.log('never finished'));
  console.log('took', Math.round((Date.now() - t0) / 1000), 's ·', (await text()).match(/(Saved to Downloads|Not saved).{0,200}/)?.[0]);
  await p.screenshot({ path: `${S}/shots/eq-${TAG}-done.png` }); await p.waitForTimeout(2500);
  console.log('saved', (await Promise.all(saves)).join(' '));
  // the editor still works after an export
  await p.getByRole('button', { name: /Back to the editor/i }).click(); await p.waitForTimeout(2500);
  console.log('edit board canvas', await p.evaluate(() => { const c = document.querySelector('canvas[aria-label="The photo being edited"]')?.isConnected, r = c?.getBoundingClientRect(); return r ? [r.width, r.height] : null; }));
  console.log(logs.filter((l) => !/deprecated|Slow network|willReadFrequently/.test(l)).slice(0, 10).join('\n'));
  await b.close();
})();

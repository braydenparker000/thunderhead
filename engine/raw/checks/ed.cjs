const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
  const p = await ctx.newPage(); const logs = []; p.on('console', m => logs.push(m.type() + ': ' + m.text())); p.on('pageerror', e => logs.push('ERR ' + e.message));
  p.on('worker', w => w.on('console', m => logs.push('w: ' + m.text())));
  await p.goto((process.env.BASE || 'http://127.0.0.1:8080') + '/lab/engine/'); await p.setInputFiles('#profiles', process.env.S + '/xe5-profiles.zip'); await p.waitForTimeout(1500);
  await p.goto((process.env.BASE || 'http://127.0.0.1:8080') + '/lab/editor/?readback'); await p.waitForTimeout(1500);
  await p.getByRole('button', { name: 'Import' }).click(); await p.waitForTimeout(300);
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.getByText('Choose photos').click()]);
  await fc.setFiles([process.env.S + '/raf/DSCF0021.RAF', process.env.S + '/raf/Fuji-X-H2-Lossless-Compressed-Raw.RAF']);
  await p.waitForFunction(() => /Done/.test(document.body.textContent), null, { timeout: 30000 });
  await p.screenshot({ path: process.env.S + '/shots/ed-lib.png' });
  await p.getByRole('button', { name: 'Import' }).click().catch(() => {});
  await p.locator('button[aria-label^="DSCF0021"]').first().click();
  await p.waitForFunction(() => document.querySelector('canvas[aria-label="The photo being edited"]')?.isConnected, null, { timeout: 60000 });
  await p.waitForTimeout(1500);
  await p.screenshot({ path: process.env.S + '/shots/ed-open.png' });
  // turn the dial right for exposure
  const d = await p.locator('[aria-valuenow], [role=slider]').first().boundingBox();
  console.log('dial', d);
  if (d) { await p.mouse.move(d.x + d.width / 2, d.y + d.height / 2); await p.mouse.down(); await p.mouse.move(d.x + d.width / 2 + 120, d.y + d.height / 2, { steps: 8 }); await p.mouse.up(); }
  await p.waitForTimeout(1500);
  await p.screenshot({ path: process.env.S + '/shots/ed-ev.png' });
  console.log(await p.evaluate(async () => { const r = await new Promise((res) => { const q = indexedDB.open('th-editor'); q.onsuccess = () => { const g = q.result.transaction('edits').objectStore('edits').getAll(); g.onsuccess = () => res(g.result); }; }); return JSON.stringify(r).slice(0, 300); }));
  console.log(logs.filter(l => !/deprecated/.test(l)).slice(0, 8).join('\n'));
  await b.close();
})();

// The Profile face, looked at, with the profiles loaded: node ui3.cjs (FILE, TAG, VH).
const { chromium } = require('playwright');
const S = __dirname, E = process.env, TAG = E.TAG || 'a', FILE = E.FILE || 'raf/DSCF0021.RAF', VH = +(E.VH || 780), BASE = E.BASE || 'http://127.0.0.1:8080';
(async () => {
  const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 384, height: VH }, deviceScaleFactor: 2, hasTouch: true });
  const p = await ctx.newPage(), logs = []; p.on('console', (m) => { if (/error/i.test(m.type())) logs.push(m.text().slice(0, 300)); }); p.on('pageerror', (e) => logs.push('ERR ' + e.message));
  await p.goto(BASE + '/'); await p.waitForTimeout(3000);
  await p.goto(BASE + '/lab/engine/'); await p.waitForTimeout(3000); await p.setInputFiles('#profiles', S + '/xe5-profiles.zip'); await p.waitForTimeout(2500);
  await p.goto(BASE + '/lab/editor/index.html?readback'); await p.waitForTimeout(5000);
  await p.getByRole('button', { name: 'Import' }).click(); await p.waitForTimeout(300);
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.getByText('Choose photos').click()]);
  await fc.setFiles([S + '/' + FILE]);
  await p.waitForFunction(() => /Done/.test(document.body.textContent), null, { timeout: 90000 });
  await p.getByRole('button', { name: 'Import' }).click().catch(() => {});
  await p.locator('[role=list] button, button[aria-label$="RAF"], button[aria-label*="X-"], button[aria-label*="DSCF"]').first().click();
  const calm = async () => { for (let c = 0, i = 0; c < 3 && i < 400; i++) { await p.waitForTimeout(300); c = (await p.evaluate(async () => { const s = await import('/lab/editor/app/session.js'); return s.busy() || !s.ready; })) ? 0 : c + 1; } };
  await calm();
  const drum = p.locator('[role=listbox][aria-label^="Sections"]');
  const r = await drum.boundingBox(); await p.mouse.click(r.x + r.width / 2, r.y + 6); await p.waitForTimeout(600); await calm();
  console.log(await drum.getAttribute('aria-label'));
  await p.screenshot({ path: `${S}/shots/ui3-${TAG}-profile.png` });
  if (E.LOOKS) {
    await p.getByRole('button', { name: /Back to the tools/i }).click(); await p.waitForTimeout(500); await p.screenshot({ path: `${S}/shots/ui3-${TAG}-tools.png` });
    await p.locator('#dock button[data-go="Looks"]').click(); await p.waitForTimeout(1200); await calm(); await p.screenshot({ path: `${S}/shots/ui3-${TAG}-looks0.png` });
    const [fc2] = await Promise.all([p.waitForEvent('filechooser'), p.getByRole('button', { name: 'Import looks' }).click()]);
    await fc2.setFiles(['Same.cube', 'Half red.cube', 'Teal orange.cube', 'Pack.xmp'].map((n) => `${S}/cubes/${n}`)); await p.waitForTimeout(2500); await calm();
    await p.locator('[role=option]', { hasText: 'Teal orange' }).first().click(); await calm(); await p.waitForTimeout(1500); await calm();
    await p.screenshot({ path: `${S}/shots/ui3-${TAG}-looks.png` });
    const r2 = await drum.boundingBox(); await p.mouse.click(r2.x + r2.width / 2, r2.y + r2.height - 6); await p.waitForTimeout(900); await p.screenshot({ path: `${S}/shots/ui3-${TAG}-mine.png` });
  }
  console.log(logs.length ? 'console errors:\n' + logs.slice(0, 8).join('\n') : 'no console errors');
  await b.close();
})();

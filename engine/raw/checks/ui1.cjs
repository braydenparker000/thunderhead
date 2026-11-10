// The new Edit board, looked at: node ui1.cjs   (FILE, TAG, VH from the environment). Saves screenshots of the faces.
const { chromium } = require('playwright');
const S = __dirname, E = process.env, TAG = E.TAG || 'a', FILE = E.FILE || 'raf/DSCF0021.RAF', VH = +(E.VH || 780);
(async () => {
  const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 384, height: VH }, deviceScaleFactor: 2, hasTouch: true });
  const p = await ctx.newPage(), logs = []; p.on('console', (m) => { if (/error/i.test(m.type())) logs.push(m.text().slice(0, 300)); }); p.on('pageerror', (e) => logs.push('ERR ' + e.message));
  await p.goto((process.env.BASE || 'http://127.0.0.1:8080') + '/'); await p.waitForTimeout(3000);
  await p.goto((process.env.BASE || 'http://127.0.0.1:8080') + '/lab/editor/index.html?readback'); await p.waitForTimeout(5000);
  await p.getByRole('button', { name: 'Import' }).click(); await p.waitForTimeout(300);
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.getByText('Choose photos').click()]);
  await fc.setFiles([S + '/' + FILE]);
  await p.waitForFunction(() => /Done/.test(document.body.textContent), null, { timeout: 90000 });
  await p.getByRole('button', { name: 'Import' }).click().catch(() => {});
  await p.locator('[role=list] button, button[aria-label$="RAF"], button[aria-label*="X-"], button[aria-label*="DSCF"]').first().click();
  const calm = async () => { for (let c = 0, i = 0; c < 3 && i < 300; i++) { await p.waitForTimeout(300); c = (await p.evaluate(async () => { const s = await import('/lab/editor/app/session.js'); return s.busy() || !s.ready; })) ? 0 : c + 1; } };
  await calm(); await p.screenshot({ path: `${S}/shots/ui1-${TAG}-light.png` });
  const drum = p.locator('[role=listbox][aria-label^="Sections"]');
  const spin = async (dy) => { const r = await drum.boundingBox(); const x = r.x + r.width / 2, y = r.y + r.height / 2; await p.mouse.move(x, y); await p.mouse.down(); for (let i = 1; i <= 6; i++) { await p.mouse.move(x, y + (dy * i) / 6); await p.waitForTimeout(30); } await p.waitForTimeout(120); await p.mouse.up(); await p.waitForTimeout(700); };
  const face = () => drum.getAttribute('aria-label');
  for (const name of (E.FACES || 'Curve,Color,Mixer,Grading,Effects,Detail,Optics,Profile').split(',')) { await spin(-24); console.log(await face(), '· chips:', (await p.evaluate(() => [...document.querySelectorAll('[role=toolbar] button')].map((x) => x.getAttribute('aria-label')))).join(', ').slice(0, 160)); await calm(); await p.screenshot({ path: `${S}/shots/ui1-${TAG}-${name.toLowerCase()}.png` }); }
  console.log(logs.length ? 'console errors:\n' + logs.slice(0, 8).join('\n') : 'no console errors');
  await b.close();
})();

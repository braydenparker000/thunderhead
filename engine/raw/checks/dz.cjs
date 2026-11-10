// The photo at 100 % about a point, saved as a picture: node dz.cjs <out.png>   (BASE, FILE, CX, CY as shares of the photo)
const { chromium } = require('playwright');
const S = __dirname, E = process.env, FILE = E.FILE || 'raf/DSCF0021.RAF', BASE = E.BASE || 'http://127.0.0.1:8080';
(async () => {
  const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 384, height: 780 }, deviceScaleFactor: 2, hasTouch: true });
  const p = await ctx.newPage(), cdp = await ctx.newCDPSession(p), logs = []; p.on('console', (m) => { if (/error|warn/i.test(m.type())) logs.push(m.text().slice(0, 300)); }); p.on('pageerror', (e) => logs.push('ERR ' + e.message));
  await p.goto(BASE + '/'); await p.waitForTimeout(3000);
  await p.goto(BASE + '/lab/editor/index.html?readback'); await p.waitForTimeout(5000);
  await p.getByRole('button', { name: 'Import' }).click(); await p.waitForTimeout(300);
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.getByText('Choose photos').click()]);
  await fc.setFiles([S + '/' + FILE]);
  await p.waitForFunction(() => /Done/.test(document.body.textContent), null, { timeout: 90000 });
  await p.getByRole('button', { name: 'Import' }).click().catch(() => {});
  await p.locator('[role=list] button, button[aria-label$="RAF"], button[aria-label*="X-"], button[aria-label*="DSCF"]').first().click();
  const calm = async () => { for (let c = 0, i = 0; c < 4 && i < 400; i++) { await p.waitForTimeout(400); c = (await p.evaluate(async () => { const s = await import('/lab/editor/app/session.js'); return s.busy() || !s.ready || !s.whole(); })) ? 0 : c + 1; } };
  await calm();
  const r = await p.evaluate(() => { const q = document.querySelector('#frame > div:first-child .fillphoto').getBoundingClientRect(); return [q.left, q.top, q.width, q.height]; });
  const x = r[0] + r[2] * +(E.CX || 0.62), y = r[1] + r[3] * +(E.CY || 0.55), touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
  for (let k = 0; k < 2; k++) { await touch('touchStart', [[x, y]]); await touch('touchEnd', []); await p.waitForTimeout(90); }   // two taps: 100 % about that point
  await p.waitForTimeout(1500); await calm();
  for (let i = 0; i < 60; i++) { const ok = await p.evaluate(() => { const c = [...document.querySelectorAll('#frame > div:first-child .fillphoto > canvas')].pop(); return c && c.style.display === 'block' && c.width > 300; }); if (ok) break; await p.waitForTimeout(1000); }
  await calm(); await p.waitForTimeout(1500);
  await p.screenshot({ path: process.argv[2] });
  console.log(await p.evaluate(() => document.querySelector('#frame > div:first-child span.glass')?.textContent), logs.length ? 'logs:\n' + logs.slice(0, 6).join('\n') : 'no errors');
  await b.close();
})();

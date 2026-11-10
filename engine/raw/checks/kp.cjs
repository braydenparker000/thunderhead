// Boards are found as they were left, and the header's histogram key opens View. FILE from the environment.
const { chromium } = require('playwright');
const S = __dirname, E = process.env, FILE = E.FILE || 'raf/DSCF0021.RAF', BASE = E.BASE || 'http://127.0.0.1:8080';
let fails = 0; const ok = (name, pass, extra = '') => { if (!pass) fails++; console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? '  · ' + extra : ''}`); };
(async () => {
  const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader'] });
  const p = await (await b.newContext({ viewport: { width: 384, height: 780 }, hasTouch: true })).newPage(), logs = []; p.on('console', (m) => { if (/error/i.test(m.type())) logs.push(m.text().slice(0, 300)); }); p.on('pageerror', (e) => logs.push('ERR ' + e.message));
  await p.goto(BASE + '/'); await p.waitForTimeout(3000);
  await p.goto(BASE + '/lab/editor/index.html?readback'); await p.waitForTimeout(5000);
  await p.getByRole('button', { name: 'Import' }).click(); await p.waitForTimeout(300);
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.getByText('Choose photos').click()]);
  await fc.setFiles([S + '/' + FILE]);
  await p.waitForFunction(() => /Done/.test(document.body.textContent), null, { timeout: 90000 });
  await p.getByRole('button', { name: 'Import' }).click().catch(() => {});
  await p.locator('[role=list] button, button[aria-label$="RAF"], button[aria-label*="X-"], button[aria-label*="DSCF"]').first().click();
  const calm = async () => { for (let c = 0, i = 0; c < 3 && i < 300; i++) { await p.waitForTimeout(300); c = (await p.evaluate(async () => { const s = await import('/lab/editor/app/session.js'); return s.busy() || !s.ready; })) ? 0 : c + 1; } };
  await calm();
  const drum = () => p.locator('[role=listbox][aria-label^="Sections"]'), face = async () => (await drum().getAttribute('aria-label')).replace('Sections: ', '');
  const to = async (name) => { for (let i = 0; i < 12 && (await face()) !== name; i++) { const r = await drum().boundingBox(); await p.mouse.click(r.x + r.width / 2, r.y + r.height - 6); await p.waitForTimeout(600); } };
  const go = async (name) => { await p.getByRole('button', { name: /Back to the tools/i }).click(); await p.waitForTimeout(400); await p.locator(`#dock button[data-go="${name}"]`).click(); await p.waitForTimeout(1500); };
  const on = () => p.evaluate(() => [...document.querySelectorAll('[role=toolbar] button[aria-pressed=true]')].map((x) => x.getAttribute('aria-label')).join());
  await to('Effects'); await p.locator('[role=toolbar] button[aria-label="Clarity"]').click(); await p.waitForTimeout(300);
  await go('Heal'); await to('Clone'); await go('Edit');
  ok('Edit is found on the section and control it was left on', (await face()) === 'Effects' && (await on()) === 'Clarity', `${await face()} ${await on()}`);
  await go('Heal'); ok('Heal is found on the tool it was left on', (await face()) === 'Clone', await face());
  await go('Edit'); await p.locator('header button[aria-label="Show histogram"]').click(); await p.waitForTimeout(1500);
  ok('The header\'s histogram key opens View, with the histogram', await p.evaluate(() => !!document.querySelector('svg[aria-label="Histogram"]') && !!document.querySelector('nav[aria-label="View"]')));
  await p.getByRole('button', { name: 'Back to the editor' }).click(); await p.waitForTimeout(1200); ok('Back from View: Edit as it was', (await face()) === 'Effects', await face());
  // the photo's waits are said on the View board once they have happened
  await p.evaluate(async () => { (await import('/lab/editor/app/zoom.js')).toggle(); }); await p.waitForTimeout(600);
  const dot = await p.evaluate(() => { const b = document.querySelector('#frame > div:first-child span.glass'); return b.classList.contains('busy') && getComputedStyle(b, '::after').animationName; });
  for (let i = 0; i < 120; i++) { if (await p.evaluate(async () => (await import('/lab/editor/app/session.js')).took.detail > 0)) break; await p.waitForTimeout(1000); }
  const still = await p.evaluate(() => document.querySelector('#frame > div:first-child span.glass').classList.contains('busy'));
  ok('A dot beats on the zoom badge while 100 % is being made, and stops', dot === 'beat' && !still, `${dot} ${still}`);
  await p.locator('header button[aria-label="Show histogram"]').click(); await p.waitForTimeout(1500);
  const line = await p.evaluate(() => document.querySelector('header').innerText.replace(/\s+/g, ' ')); ok('View says how long the photo took to open and to turn sharp', /opened in [\d.]+ s · sharp in [\d.]+ s/.test(line), line);
  await p.getByRole('button', { name: 'Back to the editor' }).click(); await p.waitForTimeout(1200);
  const press = await p.evaluate(() => { const s = getComputedStyle(document.body); return [s.overscrollBehaviorY, s.userSelect || s.webkitUserSelect]; }); ok('The page neither overscrolls nor selects text', press[0] === 'none' && press[1] === 'none', press.join());
  console.log(logs.length ? 'console errors:\n' + logs.slice(0, 8).join('\n') : 'no console errors'); console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  await b.close();
})();

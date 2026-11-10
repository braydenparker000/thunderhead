// Zoom on the tool boards, headless: two fingers zoom the photo on Masks and Heal, one finger still works the tool, at the right place. FILE, TAG from the environment.
const { chromium } = require('playwright');
const S = __dirname, E = process.env, TAG = E.TAG || 'a', FILE = E.FILE || 'raf/DSCF0021.RAF';
let fails = 0; const ok = (name, pass, extra = '') => { if (!pass) fails++; console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? '  · ' + extra : ''}`); };
(async () => {
  const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 384, height: 780 }, deviceScaleFactor: 1, hasTouch: true });
  const p = await ctx.newPage(), cdp = await ctx.newCDPSession(p), logs = []; p.on('console', (m) => { if (/error/i.test(m.type())) logs.push(m.text().slice(0, 300)); }); p.on('pageerror', (e) => logs.push('ERR ' + e.message));
  const open = async () => { await p.locator('[role=list] button, button[aria-label$="RAF"], button[aria-label*="X-"], button[aria-label*="DSCF"]').first().click(); await p.waitForFunction(() => document.querySelector('canvas[aria-label="The photo being edited"]')?.isConnected, null, { timeout: 120000 }); await p.waitForTimeout(8000); };
  const toMasks = async () => { await p.getByRole('button', { name: /Back to the tools/i }).click(); await p.waitForTimeout(400); await p.locator('#dock button[data-go="Masks"]').click(); await p.waitForTimeout(1500); };
  await p.goto((process.env.BASE || 'http://127.0.0.1:8080') + '/'); await p.waitForTimeout(3000);
  await p.goto((process.env.BASE || 'http://127.0.0.1:8080') + '/lab/editor/index.html?readback'); await p.waitForTimeout(5000);
  await p.getByRole('button', { name: 'Import' }).click(); await p.waitForTimeout(300);
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.getByText('Choose photos').click()]);
  await fc.setFiles([S + '/' + FILE]);
  await p.waitForFunction(() => /Done/.test(document.body.textContent), null, { timeout: 90000 });
  await p.getByRole('button', { name: 'Import' }).click().catch(() => {});
  await open();
  const calm = async () => { for (let calm = 0, i = 0; calm < 3 && i < 200; i++) { await p.waitForTimeout(300); calm = (await p.evaluate(async () => (await import('/lab/editor/app/session.js')).busy())) ? 0 : calm + 1; } };   // once the engine has nothing left to draw
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
  const pinch = async (cx, cy, d0, d1) => { await touch('touchStart', [[cx - d0, cy]]); await p.waitForTimeout(30); await touch('touchStart', [[cx - d0, cy], [cx + d0, cy]]); for (let i = 1; i <= 8; i++) { const d = d0 + ((d1 - d0) * i) / 8; await touch('touchMove', [[cx - d, cy], [cx + d, cy]]); await p.waitForTimeout(25); } await touch('touchEnd', []); await p.waitForTimeout(1200); };
  const stroke = async (pts) => { await touch('touchStart', [pts[0]]); for (const q of pts.slice(1)) { await touch('touchMove', [q]); await p.waitForTimeout(25); } await touch('touchEnd', []); await p.waitForTimeout(600); };
  const tapAt = async (x, y) => { await touch('touchStart', [[x, y]]); await p.waitForTimeout(40); await touch('touchEnd', []); await p.waitForTimeout(700); };
  // where things are on screen: the zoomed photo itself, what the board lays over it, the zoom's badge
  const see = () => p.evaluate(() => { const w = document.querySelector('#frame > div:first-child .fillphoto'), o = document.querySelector('[data-zoom-with]'), b = document.querySelector('[data-keep="photo"] span.glass'), r = (e) => { const q = e.getBoundingClientRect(); return [q.left, q.top, q.width, q.height].map((v) => +v.toFixed(1)); };
    return { photo: r(w), over: r(o), badge: b && b.style.display !== 'none' ? b.textContent : '' }; });
  const mk = (f, ...a) => p.evaluate(async ([f, a]) => { const m = await import('/lab/editor/app/masks.js'); return m[f](...a); }, [f, a]);
  const hl = () => p.evaluate(async () => (await import('/lab/editor/app/heal.js')).list());
  const toShown = (x, y) => p.evaluate(async ([x, y]) => (await import('/lab/editor/app/session.js')).eng.shownPoint(x, y), [x, y]);
  const go = async (name) => { await p.getByRole('button', { name: /Back to the tools/i }).click().catch(() => {}); await p.waitForTimeout(400); await p.locator(`#dock button[data-go="${name}"]`).click(); await p.waitForTimeout(1500); };
  await go('Masks');
  await p.locator('[role=dialog][aria-label="Add a mask"] button', { hasText: 'Brush' }).click(); await p.waitForTimeout(800);
  let v = await see(); ok('Masks: fitted, what the board lays over the photo sits on it', !v.badge && v.photo.every((x, i) => Math.abs(x - v.over[i]) < 0.6), JSON.stringify(v));
  const mid = [v.photo[0] + v.photo[2] / 2, v.photo[1] + v.photo[3] / 2];
  await pinch(mid[0], mid[1], 30, 120); await calm(); let w = await see(), m = await mk('list');
  ok('  two fingers zoom the photo, and nothing is painted', parseInt(w.badge) > 0 && w.photo[2] > v.photo[2] * 3 && m[0].strokes.length === 0, JSON.stringify([w.badge, m[0].strokes.length]));
  ok('  what the board lays over the photo zooms with it', w.photo.every((x, i) => Math.abs(x - w.over[i]) < 0.8), JSON.stringify(w));
  for (let k = 0; k < 4; k++) { console.log('map', JSON.stringify(await p.evaluate(() => { const i = document.querySelector('[data-keep="photo"] div.glass img'); return i ? { src: i.getAttribute('src')?.slice(0, 60), ok: i.complete && i.naturalWidth, shown: i.parentElement.style.display } : null; }))); await p.waitForTimeout(2500); }
  await stroke([[120, 300], [160, 300], [200, 300]]); await calm(); await p.waitForTimeout(3000);
  console.log('map after a stroke', JSON.stringify(await p.evaluate(() => { const i = document.querySelector('[data-keep="photo"] div.glass img'); return i ? { src: i.getAttribute('src')?.slice(0, 60), ok: i.complete && i.naturalWidth } : null; })));
  await b.close(); return;
})();

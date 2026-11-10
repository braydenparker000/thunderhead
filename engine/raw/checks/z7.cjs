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
  const see = () => p.evaluate(() => { const w = document.querySelector('#frame > div:first-child .fillphoto'), o = document.querySelector('[data-zoom-with]'), b = document.querySelector('#frame > div:first-child span.glass'), r = (e) => { const q = e.getBoundingClientRect(); return [q.left, q.top, q.width, q.height].map((v) => +v.toFixed(1)); };
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
  await stroke([[120, 300], [160, 300], [200, 300], [240, 300]]); await calm(); m = await mk('list');
  const s0 = m[0].strokes[0], first = s0 ? await toShown(s0.pts[0], s0.pts[1]) : [0, 0], last = s0 ? await toShown(s0.pts.at(-2), s0.pts.at(-1)) : [0, 0];
  const want = (x, y) => [(x - w.photo[0]) / w.photo[2], (y - w.photo[1]) / w.photo[3]];
  ok('  one finger paints, where it touches the zoomed photo', m[0].strokes.length === 1 && Math.hypot(first[0] - want(120, 300)[0], first[1] - want(120, 300)[1]) < 0.004 && Math.hypot(last[0] - want(240, 300)[0], last[1] - want(240, 300)[1]) < 0.004, JSON.stringify({ first, wantFirst: want(120, 300), last, wantLast: want(240, 300) }));
  ok('  the brush keeps its size on screen: 16 design pixels across the zoomed photo', s0 && Math.abs(s0.r * w.photo[2] - 16 * (384 / 412)) < 1, `${(s0?.r * w.photo[2]).toFixed(2)} px`);
  await p.screenshot({ path: `${S}/shots/z7-${TAG}-masks.png` });
  await tapAt(200, 420); await calm(); m = await mk('list'); ok('  a tap leaves one dab', m[0].strokes.length === 2 && m[0].strokes[1].pts.length === 2, JSON.stringify(m[0].strokes.map((x) => x.pts.length)));
  await pinch(192, 300, 120, 20); await calm(); const back = await see(); ok('  pinched back, it is fitted again', !back.badge && Math.abs(back.photo[2] - v.photo[2]) < 1, JSON.stringify(back));
  // the Heal board
  await go('Heal'); v = await see();
  await pinch(v.photo[0] + v.photo[2] / 2, v.photo[1] + v.photo[3] / 2, 30, 110); await calm(); w = await see(); let sp = await hl();
  ok('Heal: two fingers zoom, and no spot is made', parseInt(w.badge) > 0 && sp.length === 0 && w.photo.every((x, i) => Math.abs(x - w.over[i]) < 0.8), JSON.stringify([w, sp.length]));
  await tapAt(180, 330); await calm(); sp = await hl(); const at = sp[0] ? await toShown(sp[0].x, sp[0].y) : [0, 0], wanted = [(180 - w.photo[0]) / w.photo[2], (330 - w.photo[1]) / w.photo[3]];
  ok('  a tap makes a spot where it touched the zoomed photo', sp.length === 1 && Math.hypot(at[0] - wanted[0], at[1] - wanted[1]) < 0.004, JSON.stringify({ at, wanted }));
  const ring = await p.evaluate(() => { const c = document.querySelector('[data-zoom-with] svg circle')?.getBoundingClientRect(); return c ? [c.left + c.width / 2, c.top + c.height / 2, c.width] : null; });
  ok('  its ring is drawn where the tap was', ring && Math.hypot(ring[0] - 180, ring[1] - 330) < 3, JSON.stringify(ring)); await p.screenshot({ path: `${S}/shots/z7-${TAG}-heal.png` });
  console.log(logs.length ? 'console errors:\n' + logs.slice(0, 8).join('\n') : 'no console errors'); console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  await b.close();
})();

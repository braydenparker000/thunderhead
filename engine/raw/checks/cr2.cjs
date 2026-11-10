// The Crop board's gestures, checked: the photo fits the room, moves and zooms under the frame, sides pull. FILE, TAG from the environment.
const { chromium } = require('playwright');
const S = __dirname, E = process.env, TAG = E.TAG || 'a', FILE = E.FILE || 'raf/DSCF0021.RAF';
let fails = 0; const ok = (name, pass, extra = '') => { if (!pass) fails++; console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? '  · ' + extra : ''}`); };
(async () => {
  const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 384, height: 780 }, deviceScaleFactor: 1, hasTouch: true });
  const p = await ctx.newPage(), cdp = await ctx.newCDPSession(p), logs = []; p.on('console', (m) => { if (/error/i.test(m.type())) logs.push(m.text().slice(0, 300)); }); p.on('pageerror', (e) => logs.push('ERR ' + e.message));
  await p.goto((process.env.BASE || 'http://127.0.0.1:8080') + '/'); await p.waitForTimeout(3000);
  await p.goto((process.env.BASE || 'http://127.0.0.1:8080') + '/lab/engine/'); await p.waitForTimeout(3000); await p.setInputFiles('#profiles', S + '/xe5-profiles.zip'); await p.waitForTimeout(2500);
  await p.goto((process.env.BASE || 'http://127.0.0.1:8080') + '/lab/editor/index.html?readback'); await p.waitForTimeout(5000);
  await p.getByRole('button', { name: 'Import' }).click(); await p.waitForTimeout(300);
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.getByText('Choose photos').click()]);
  await fc.setFiles([S + '/' + FILE]);
  await p.waitForFunction(() => /Done/.test(document.body.textContent), null, { timeout: 90000 });
  await p.getByRole('button', { name: 'Import' }).click().catch(() => {});
  await p.locator('[role=list] button, button[aria-label$="RAF"], button[aria-label*="X-"], button[aria-label*="DSCF"]').first().click();
  const calm = async () => { for (let c = 0, i = 0; c < 3 && i < 300; i++) { await p.waitForTimeout(300); c = (await p.evaluate(async () => { const s = await import('/lab/editor/app/session.js'); return s.busy() || !s.ready; })) ? 0 : c + 1; } };
  const ses = (f, ...a) => p.evaluate(async ([f, a]) => { const s = await import('/lab/editor/app/session.js'); return s[f](...a); }, [f, a]);
  const drum = p.locator('[role=listbox][aria-label^="Sections"]'), face = async () => (await drum.getAttribute('aria-label')).replace('Sections: ', '');
  const chips = () => p.evaluate(() => [...document.querySelectorAll('[role=toolbar] button')].map((x) => x.getAttribute('aria-label')));
  const step = async (down = true) => { const r = await drum.boundingBox(); await p.mouse.click(r.x + r.width / 2, r.y + (down ? r.height - 6 : 6)); await p.waitForTimeout(500); };
  const to = async (name) => { for (let i = 0; i < 12 && (await face()) !== name; i++) await step(); };
  const dialBox = () => p.locator('[role=slider][style*="ew-resize"]').first().boundingBox();
  const drag = async (dx, hold = 150) => { const r = await dialBox(); const x = r.x + r.width / 2, y = r.y + r.height / 2; await p.mouse.move(x, y); await p.mouse.down(); for (let i = 1; i <= 8; i++) { await p.mouse.move(x + (dx * i) / 8, y); await p.waitForTimeout(16); } await p.waitForTimeout(hold); await p.mouse.up(); };
  const dtap = async () => { const r = await dialBox(); const x = r.x + r.width / 2, y = r.y + r.height / 2; await p.mouse.click(x, y); await p.waitForTimeout(90); await p.mouse.click(x, y); await p.waitForTimeout(400); };
  await calm();
  const go = async (name) => { await p.getByRole('button', { name: /Back to the tools/i }).click(); await p.waitForTimeout(400); await p.locator(`#dock button[data-go="${name}"]`).click(); await p.waitForTimeout(1500); };
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
  const geo = () => ses('geo');
  // where things are: the frame (the crop's outline), the photo's box, the panel
  const see = () => p.evaluate(() => { const r = (e) => { const q = e.getBoundingClientRect(); return [q.left, q.top, q.width, q.height].map((v) => +v.toFixed(1)); }; const f = document.querySelector('[aria-label="Drag the top left corner"]').parentElement, ph = document.querySelector('[data-keep="photo"]'), pl = document.querySelector('.plate'); return { frame: r(f), photo: r(ph), plateTop: pl.getBoundingClientRect().top }; });
  const chip = async (group, name) => { const want = group[0] + group.slice(1).toLowerCase(), dr = p.locator('[role=listbox][aria-label^="Sections"]'); for (let i = 0; i < 6 && (await dr.getAttribute('aria-label')) !== 'Sections: ' + want; i++) { const r = await dr.boundingBox(); await p.mouse.click(r.x + r.width / 2, r.y + r.height - 6); await p.waitForTimeout(600); } if (name) { await p.getByRole('button', { name, exact: true }).click(); await p.waitForTimeout(600); } };
  await go('Crop'); await calm(); let v = await see();
  ok('The photo and its frame sit inside the room above the panel', v.frame[1] + v.frame[3] <= v.plateTop - 4 && v.photo[1] + v.photo[3] <= v.plateTop + 1 && v.frame[1] > 52, JSON.stringify(v));
  const mid = [v.frame[0] + v.frame[2] / 2, v.frame[1] + v.frame[3] / 2];
  // two fingers apart: the photo grows under the frame (the crop gets tighter, its shape kept)
  await touch('touchStart', [[mid[0] - 40, mid[1]]]); await touch('touchStart', [[mid[0] - 40, mid[1]], [mid[0] + 40, mid[1]]]); for (let i = 1; i <= 8; i++) { await touch('touchMove', [[mid[0] - 40 - 5 * i, mid[1]], [mid[0] + 40 + 5 * i, mid[1]]]); await p.waitForTimeout(25); } await touch('touchEnd', []); await p.waitForTimeout(900);
  let g = await geo(), w = await see();
  ok('Two fingers apart zoom the photo under the frame', g?.rect && Math.abs(g.rect.w - 0.5) < 0.06 && Math.abs(g.rect.w - g.rect.h) < 0.02 && Math.abs(w.frame[2] - v.frame[2]) < 3 && w.photo[2] > v.photo[2] * 1.8, JSON.stringify([g?.rect, w.frame, w.photo]));
  // one finger: the photo follows it
  await touch('touchStart', [[mid[0], mid[1]]]); for (let i = 1; i <= 6; i++) { await touch('touchMove', [[mid[0] + 10 * i, mid[1] + 5 * i]]); await p.waitForTimeout(25); } await touch('touchEnd', []); await p.waitForTimeout(900);
  const g2 = await geo(), w2 = await see();
  ok('One finger moves the photo, the frame staying put', g2.rect.x < g.rect.x - 0.03 && g2.rect.y < g.rect.y - 0.02 && Math.abs(g2.rect.w - g.rect.w) < 1e-6 && Math.abs(w2.frame[0] - w.frame[0]) < 1.5 && w2.photo[0] > w.photo[0] + 40, JSON.stringify([g.rect, g2.rect, w.photo, w2.photo]));
  await p.screenshot({ path: `${S}/shots/cr2-${TAG}-zoomed.png` });
  // a side, with the shape free
  await chip('ASPECT', 'Free'); await p.waitForTimeout(600); const f0 = await see(), g3 = await geo();
  ok('Free shape starts from the whole photo', !g3 || !g3.rect, JSON.stringify(g3?.rect));
  const rs = await p.locator('[aria-label="Drag the right side"]').boundingBox(); await p.mouse.move(rs.x + 22, rs.y + 22); await p.mouse.down(); for (let i = 1; i <= 6; i++) { await p.mouse.move(rs.x + 22 - 15 * i, rs.y + 22); await p.waitForTimeout(25); } await p.mouse.up(); await p.waitForTimeout(900);
  const g4 = await geo(), f1 = await see();
  ok('Pulling the right side in narrows the crop, its height kept', g4.rect && g4.rect.w < 0.82 && g4.rect.w > 0.6 && Math.abs(g4.rect.h - 1) < 1e-6 && Math.abs(g4.rect.x) < 1e-6, JSON.stringify(g4.rect));
  ok('  then the view settles: the frame fills the room again', f1.frame[3] >= f0.frame[3] - 2 || f1.frame[2] > 340, JSON.stringify([f0.frame, f1.frame]));
  const bl = await p.locator('[aria-label="Drag the bottom left corner"]').boundingBox(); await p.mouse.move(bl.x + 22, bl.y + 22); await p.mouse.down(); for (let i = 1; i <= 6; i++) { await p.mouse.move(bl.x + 22 + 8 * i, bl.y + 22 - 8 * i); await p.waitForTimeout(25); } await p.mouse.up(); await p.waitForTimeout(900);
  const g5 = await geo(); ok('A corner pulls two sides', g5.rect.x > 0.05 && g5.rect.h < 0.95 && g5.rect.w < g4.rect.w, JSON.stringify(g5.rect));
  await p.screenshot({ path: `${S}/shots/cr2-${TAG}-free.png` });
  const dims = await p.evaluate(() => [...document.querySelectorAll('span')].map((x) => x.textContent).find((t) => /^\d+ × \d+ · /.test(t)));
  await go('Edit'); await calm(); const size = await p.evaluate(() => { const c = document.querySelector('canvas[aria-label="The photo being edited"]'); return [c.width * 3, c.height * 3]; }), want = dims.match(/(\d+) × (\d+)/).slice(1).map(Number);
  ok('The engine draws the crop the board showed', Math.abs(size[0] - want[0]) <= 3 && Math.abs(size[1] - want[1]) <= 3, `${dims} · ${size}`);
  console.log(logs.length ? 'console errors:\n' + logs.slice(0, 8).join('\n') : 'no console errors'); console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  await b.close();
})();

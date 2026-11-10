// Step 6b, headless: the brush on the Masks board. FILE, TAG from the environment.
const { chromium } = require('playwright');
const S = __dirname, E = process.env, TAG = E.TAG || 'a', FILE = E.FILE || 'raf/DSCF0021.RAF';
let fails = 0; const ok = (name, pass, extra = '') => { if (!pass) fails++; console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? '  · ' + extra : ''}`); };
(async () => {
  const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 384, height: 780 }, deviceScaleFactor: 1, hasTouch: true });
  const p = await ctx.newPage(), logs = []; p.on('console', (m) => { if (/error/i.test(m.type())) logs.push(m.text().slice(0, 300)); }); p.on('pageerror', (e) => logs.push('ERR ' + e.message));
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
  // the picture as the engine last drew it: mean brightness of its top and bottom thirds, its middle and its rim, how red it is, how coloured
  const look1 = () => p.evaluate(async () => { const c = (await import('/lab/editor/app/session.js')).canvas, W = c.width, H = c.height, d = c.getContext('2d').getImageData(0, 0, W, H).data, z = { top: [0, 0], bottom: [0, 0], middle: [0, 0], rim: [0, 0], red: [0, 0], sat: [0, 0] };
    for (let y = 0; y < H; y += 3) for (let x = 0; x < W; x += 3) { const i = (y * W + x) * 4, l = (d[i] + d[i + 1] + d[i + 2]) / 3, add = (k, v = l) => { z[k][0] += v; z[k][1]++; }; if (y < H / 3) add('top'); else if (y > (2 * H) / 3) add('bottom'); const r = Math.hypot((x / W - 0.5) * 2, (y / H - 0.5) * 2); if (r < 0.3) add('middle'); else if (r > 0.95) add('rim'); add('red', d[i] - (d[i + 1] + d[i + 2]) / 2); add('sat', Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2])); }
    return Object.fromEntries(Object.entries(z).map(([k, [s, n]]) => [k, +(s / n).toFixed(1)])); });
  const look = async () => { for (let calm = 0, i = 0; calm < 3 && i < 200; i++) { await p.waitForTimeout(300); calm = (await p.evaluate(async () => (await import('/lab/editor/app/session.js')).busy())) ? 0 : calm + 1; } return look1(); };   // once the engine has nothing left to draw
  const ses = (f, ...a) => p.evaluate(async ([f, a]) => { const s = await import('/lab/editor/app/session.js'); return s[f](...a); }, [f, a]);
  const masks = () => p.evaluate(async () => (await import('/lab/editor/app/masks.js')).list());
  const names = async () => (await ses('history')).steps.map((s) => s.name + (s.val ? ' ' + s.val : ''));
  const rows = () => p.evaluate(() => [...document.querySelectorAll('[role=listbox][aria-label=Masks] [role=option]')].map((t) => t.textContent.trim().replace(/\s+/g, ' ') + (t.getAttribute('aria-selected') === 'true' ? '*' : '')));
  const dial = async (dx) => { const r = await p.locator('[style*="ew-resize"]').first().boundingBox(); const x = r.x + r.width / 2, y = r.y + r.height / 2; await p.mouse.move(x, y); await p.mouse.down(); for (let i = 1; i <= 6; i++) { await p.mouse.move(x + (dx * i) / 6, y); await p.waitForTimeout(20); } await p.waitForTimeout(160); await p.mouse.up(); await p.waitForTimeout(600); };   // held still before letting go: a drag, not a flick
  const photoBox = () => p.locator('[aria-label="Photo"], [aria-label^="Paint the brush mask"]').first().boundingBox();
  const drag = async (u0, v0, u1, v1) => { const r = await photoBox(); await p.mouse.move(r.x + u0 * r.width, r.y + v0 * r.height); await p.mouse.down(); for (let i = 1; i <= 6; i++) { await p.mouse.move(r.x + (u0 + ((u1 - u0) * i) / 6) * r.width, r.y + (v0 + ((v1 - v0) * i) / 6) * r.height); await p.waitForTimeout(25); } await p.mouse.up(); await p.waitForTimeout(600); };
  const add = async (kind) => { if (!(await p.locator('[role=dialog][aria-label="Add a mask"]').count())) { await p.getByRole('button', { name: 'Add mask' }).click(); await p.waitForTimeout(400); } await p.locator('[role=dialog][aria-label="Add a mask"] button', { hasText: kind }).click(); await p.waitForTimeout(800); };
  const chip = async (label) => { await p.locator(`button[aria-label="${label}"]`).first().click(); await p.waitForTimeout(400); };
  const sec = async (name) => { const want = name[0] + name.slice(1).toLowerCase(), drum = p.locator('[role=listbox][aria-label^="Sections"]'); for (let i = 0; i < 6 && (await drum.getAttribute('aria-label')) !== 'Sections: ' + want; i++) { const r = await drum.boundingBox(); await p.mouse.click(r.x + r.width / 2, r.y + r.height - 6); await p.waitForTimeout(600); } };
  const base = await look(); console.log('base', JSON.stringify(base));
  await toMasks();
  const menu = await p.evaluate(() => [...document.querySelectorAll('[role=dialog][aria-label="Add a mask"] button')].map((x) => x.textContent.trim()));
  ok('The add menu offers the brush', menu.join() === 'Brush,Linear,Radial,Color,Luminance', menu.join());
  await add('Brush'); let m = await masks(), r = await rows();
  const note = await p.evaluate(() => document.querySelector('span[role=status].glass')?.textContent || '');
  ok('Brush: added, listed, asks to be painted', m.length === 1 && m[0].kind === 'Brush' && m[0].strokes.length === 0 && r.join() === 'Brush*' && /Paint on the photo/.test(note), JSON.stringify([r, note]));
  await drag(0.15, 0.25, 0.85, 0.25); m = await masks(); let a = await look();
  ok('  a finger across the top paints a stroke, shown in red', m[0].strokes.length === 1 && m[0].strokes[0].pts.length >= 6 && a.red > base.red + 2 && !m[0].strokes[0].erase, JSON.stringify([m[0].strokes.map((s) => [s.r.toFixed(3), s.feather, s.flow, s.pts.length]), base.red, a.red]));
  await p.screenshot({ path: `${S}/shots/b6-${TAG}-paint.png` });
  const sizeWas = m[0].strokes[0].r; await chip('Size'); await dial(480); await drag(0.15, 0.75, 0.85, 0.75); m = await masks();
  ok('  Size on the dial makes the next stroke wider', m[0].strokes.length === 2 && m[0].strokes[1].r > sizeWas * 1.3, JSON.stringify(m[0].strokes.map((s) => +s.r.toFixed(4))));
  await sec('LIGHT'); await chip('Exposure'); await dial(-300); await p.getByRole('button', { name: 'OVERLAY' }).click(); m = await masks(); a = await look();
  ok('  its own exposure darkens what was painted: top and bottom, not the middle', m[0].vals.Exposure < -1 && a.top < base.top - 4 && a.bottom < base.bottom - 4 && Math.abs(a.middle - base.middle) < 2, JSON.stringify([m[0].vals, base, a]));
  await sec('MASK'); await chip('Erase'); await drag(0.15, 0.75, 0.85, 0.75); m = await masks(); const a2 = await look();
  ok('  Erase rubs the lower stroke out', m[0].strokes.length === 3 && m[0].strokes[2].erase === true && a2.bottom > a.bottom + 3 && Math.abs(a2.top - a.top) < 1, JSON.stringify([a.bottom, a2.bottom, a.top, a2.top]));
  let h = await names(); ok('  steps: added, painted, painted, exposure, rubbed out', h.length === 6 && /added$/.test(h[1]) && /painted$/.test(h[2]) && /painted$/.test(h[3]) && /Exposure/.test(h[4]) && /rubbed out$/.test(h[5]), JSON.stringify(h));
  await ses('undo'); await p.waitForTimeout(500); m = await masks(); const a3 = await look(); ok('Undo takes the rubbing out back', m[0].strokes.length === 2 && Math.abs(a3.bottom - a.bottom) < 0.5, JSON.stringify([a.bottom, a3.bottom]));
  const kept = JSON.stringify(m); await p.waitForTimeout(1500); await p.reload(); await p.waitForTimeout(5000); await open();
  const back = await look(); ok('After a reload what was painted is still there, and drawn the same', JSON.stringify(await masks()) === kept && Math.abs(back.top - a3.top) < 0.5 && Math.abs(back.bottom - a3.bottom) < 0.5, JSON.stringify([a3, back]));
  await toMasks(); await sec('MASK'); await p.getByRole('button', { name: 'Reset mask' }).click(); await p.waitForTimeout(500); m = await masks(); a = await look();
  await p.getByRole('button', { name: 'OVERLAY' }).click();
  ok('RESET MASK clears the paint', m[0].strokes.length === 0 && Math.abs(a.top - base.top) < 0.5, JSON.stringify([base.top, a.top]));
  for (let k = 0; k < 4; k++) await add('Brush'); m = await masks(); ok('A photo takes four painted masks, no more', m.filter((x) => x.kind === 'Brush').length === 4, String(m.length));
  console.log(logs.length ? 'console errors:\n' + logs.slice(0, 8).join('\n') : 'no console errors'); console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  await b.close();
})();

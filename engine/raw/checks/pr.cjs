// Step 6a, headless: masks through the Masks board. FILE, TAG from the environment.
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
  const photoBox = () => p.locator('[aria-label="Photo"]').first().boundingBox();
  const drag = async (u0, v0, u1, v1) => { const r = await photoBox(); await p.mouse.move(r.x + u0 * r.width, r.y + v0 * r.height); await p.mouse.down(); for (let i = 1; i <= 6; i++) { await p.mouse.move(r.x + (u0 + ((u1 - u0) * i) / 6) * r.width, r.y + (v0 + ((v1 - v0) * i) / 6) * r.height); await p.waitForTimeout(25); } await p.mouse.up(); await p.waitForTimeout(600); };
  const add = async (kind) => { if (!(await p.locator('[role=dialog][aria-label="Add a mask"]').count())) { await p.getByRole('button', { name: 'Add mask' }).click(); await p.waitForTimeout(400); } await p.locator('[role=dialog][aria-label="Add a mask"] button', { hasText: kind }).click(); await p.waitForTimeout(800); };
  const chip = async (label) => { await p.locator(`button[aria-label="${label}"]`).first().click(); await p.waitForTimeout(400); };
  const sec = async (name) => { const want = name[0] + name.slice(1).toLowerCase(), drum = p.locator('[role=listbox][aria-label^="Sections"]'); for (let i = 0; i < 6 && (await drum.getAttribute('aria-label')) !== 'Sections: ' + want; i++) { const r = await drum.boundingBox(); await p.mouse.click(r.x + r.width / 2, r.y + r.height - 6); await p.waitForTimeout(600); } };
  const calm = async () => { for (let c = 0, i = 0; c < 3 && i < 300; i++) { await p.waitForTimeout(300); c = (await p.evaluate(async () => { const s = await import('/lab/editor/app/session.js'); return s.busy() || !s.ready; })) ? 0 : c + 1; } };
  await calm(); await toMasks();
  await add('Radial'); await calm(); console.log('added', JSON.stringify((await masks())[0].a)); await p.screenshot({ path: `${S}/shots/pr-1.png` });
  await drag(0.5, 0.5, 0.3, 0.4); await calm(); console.log('moved', JSON.stringify((await masks())[0].a)); await p.screenshot({ path: `${S}/shots/pr-2.png` });
  const el = await p.evaluate(() => { const x = [...document.querySelectorAll('[aria-label="Photo"] span')].find((s) => /border-radius: 50%/.test(s.getAttribute('style') || '')); const q = x?.getBoundingClientRect(); return q ? [q.left + q.width / 2, q.top + q.height / 2, q.width / 2, q.height / 2] : null; });
  await p.mouse.move(el[0] + el[2] * 0.72, el[1] + el[3] * 0.72); await p.mouse.down(); for (let i = 1; i <= 5; i++) { await p.mouse.move(el[0] + el[2] * (0.72 + 0.06 * i), el[1] + el[3] * (0.72 + 0.06 * i)); await p.waitForTimeout(25); } await p.mouse.up(); await p.waitForTimeout(600);
  await calm(); console.log('grown', JSON.stringify((await masks())[0].a)); await p.screenshot({ path: `${S}/shots/pr-3.png` });
  await sec('COLOR'); await chip('Saturation'); await dial(-700); await calm(); await p.waitForTimeout(1500); await calm(); console.log('sat', JSON.stringify((await masks())[0].vals)); await p.screenshot({ path: `${S}/shots/pr-4.png` });
  console.log(logs.join('\n')); await b.close();
})();

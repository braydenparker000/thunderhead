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
  const base = await look(); console.log('base', JSON.stringify(base));
  await toMasks();
  const menu = await p.evaluate(() => [...document.querySelectorAll('[role=dialog][aria-label="Add a mask"] button')].map((x) => x.textContent.trim()));
  ok('With no masks the board offers the kinds that are built', menu.join() === 'Brush,Linear,Radial,Color,Luminance', menu.join());
  // a linear gradient
  await add('Linear'); let m = await masks(), a = await look(), r = await rows();
  ok('Linear: added, listed, shown in red over the top', m.length === 1 && m[0].a?.length === 4 && r.join() === 'Linear gradient*' && a.red > base.red + 4, JSON.stringify([r, base.red, a.red]));
  const guides = await p.evaluate(() => [...document.querySelectorAll('[aria-label="Photo"] span')].filter((x) => /border-top/.test(x.getAttribute('style') || '')).map((x) => { const q = x.getBoundingClientRect(); return [Math.round(q.top + q.height / 2), x.style.borderTopStyle]; }));
  const pb = await photoBox(); ok('  its three guide lines lie across the photo', guides.length === 3 && guides[0][0] < guides[1][0] && guides[1][0] < guides[2][0] && guides[0][0] > pb.y && guides[2][0] < pb.y + pb.height && guides[1][1] === 'dashed', JSON.stringify([guides, Math.round(pb.y), Math.round(pb.height)]));
  await p.screenshot({ path: `${S}/shots/m6-${TAG}-linear.png` });
  await dial(-200); m = await masks(); await p.getByRole('button', { name: 'OVERLAY' }).click(); a = await look();
  ok('  the dial sets its own exposure; the top darkens, the bottom does not', m[0].vals.Exposure < -1 && a.top < base.top - 15 && Math.abs(a.bottom - base.bottom) < 2.5 && Math.abs(a.red - base.red) < 3, JSON.stringify([m[0].vals, base, a]));
  await drag(0.5, 0.35, 0.5, 0.6); const m2 = await masks(), a2 = await look();
  ok('  dragged down by its middle, it reaches further down', m2[0].a[1] > m[0].a[1] + 0.05 && m2[0].a[3] > m[0].a[3] + 0.05 && a2.top < a.top - 1, JSON.stringify([m[0].a, m2[0].a, a.top, a2.top]));
  let h = await names(); ok('  steps: added, exposure, moved', /added$/.test(h[1]) && /Exposure −/.test(h[2]) && /moved$/.test(h[3]) && h.length === 4, JSON.stringify(h));
  // a radial gradient
  await p.getByRole('button', { name: 'OVERLAY' }).click(); await add('Radial'); await p.waitForTimeout(500); await sec('COLOR'); await chip('Saturation'); await dial(-700); m = await masks(); await p.getByRole('button', { name: 'OVERLAY' }).click(); a = await look(); await p.getByRole('button', { name: 'OVERLAY' }).click(); r = await rows();
  ok('Radial: its own saturation takes colour from the middle only', m.length === 2 && m[1].vals.Saturation < -80 && /Radial gradient 1?\*/.test(r[1]) && a.sat < a2.sat - 0.3, JSON.stringify([r, m[1].vals, a2.sat, a.sat]));
  await drag(0.5, 0.5, 0.3, 0.4); const m3 = await masks(); ok('  dragged by its middle it moves', m3[1].a[0] < m[1].a[0] - 0.1 && Math.abs(m3[1].a[2] - m[1].a[2]) < 1e-6, JSON.stringify([m[1].a, m3[1].a]));
  const el = await p.evaluate(() => { const x = [...document.querySelectorAll('[aria-label="Photo"] span')].find((s) => /border-radius: 50%/.test(s.getAttribute('style') || '')); const q = x?.getBoundingClientRect(); return q ? [q.left + q.width / 2, q.top + q.height / 2, q.width / 2, q.height / 2] : null; });
  const pb2 = await photoBox(); await p.mouse.move(el[0] + el[2] * 0.72, el[1] + el[3] * 0.72); await p.mouse.down(); for (let i = 1; i <= 5; i++) { await p.mouse.move(el[0] + el[2] * (0.72 + 0.06 * i), el[1] + el[3] * (0.72 + 0.06 * i)); await p.waitForTimeout(25); } await p.mouse.up(); await p.waitForTimeout(600);
  const m4 = await masks(); ok('  dragged by its rim it grows', m4[1].a[2] > m3[1].a[2] * 1.2 && m4[1].a[3] > m3[1].a[3] * 1.2 && Math.abs(m4[1].a[0] - m3[1].a[0]) < 1e-6, JSON.stringify([el.map(Math.round), m3[1].a, m4[1].a]));
  await p.waitForTimeout(6000); await p.screenshot({ path: `${S}/shots/m6-${TAG}-radial.png` }); await p.getByRole('button', { name: 'OVERLAY' }).click();
  // ranges
  await add('Color'); let note = await p.evaluate(() => document.querySelector('span[role=status].glass')?.textContent || ''); ok('Colour range: asks for a tap', /Tap the photo to pick a colour/.test(note), note);
  const r0 = await photoBox(); await p.mouse.click(r0.x + r0.width * 0.5, r0.y + r0.height * 0.07); await p.waitForTimeout(800); m = await masks();
  ok('  a tap on the sky picks its colour', m[2].pick?.length === 2 && Math.hypot(...m[2].pick) < 0.2, JSON.stringify(m[2].pick));
  await sec('LIGHT'); await chip('Exposure'); await dial(200); a = await look(); const before = a;
  await sec('MASK'); await chip('Invert'); a = await look(); m = await masks(); ok('  Invert turns it round', m[2].invert === true && Math.abs(a.top - before.top) > 0.8, JSON.stringify([before.top, a.top]));
  await chip('Delete'); await p.waitForTimeout(600); m = await masks(); r = await rows(); ok('  Delete removes it', m.length === 2 && r.length === 2, JSON.stringify(r));
  await add('Luminance'); const r1 = await photoBox(); await p.mouse.click(r1.x + r1.width * 0.5, r1.y + r1.height * 0.07); await p.waitForTimeout(600); await sec('LIGHT'); await chip('Exposure'); await dial(-240); m = await masks(); a = await look();
  ok('Brightness range: picked from the sky, it darkens the bright parts', m[2].kind === 'Luminance' && m[2].pick?.length === 1 && m[2].vals.Exposure < -1, JSON.stringify([m[2].pick, m[2].vals]));
  await p.screenshot({ path: `${S}/shots/m6-${TAG}-all.png` });
  await ses('undo'); await p.waitForTimeout(1500); m = await masks(); ok('Undo takes the last change back', m[2].vals.Exposure === undefined, JSON.stringify(m[2].vals));
  const kept = JSON.stringify(m); await p.waitForTimeout(1500); await p.reload(); await p.waitForTimeout(5000); await open();
  ok('After a reload the masks are still there', JSON.stringify(await masks()) === kept); const plain = await look();
  ok('  and drawn, without the red, on the Edit board', plain.top < base.top - 10 && Math.abs(plain.red - base.red) < 6, JSON.stringify([base, plain]));
  console.log(logs.length ? 'console errors:\n' + logs.slice(0, 8).join('\n') : 'no console errors'); console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  await b.close();
})();

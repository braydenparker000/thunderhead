// Step 7, headless: retouching through the Heal board. FILE, TAG from the environment.
const { chromium } = require('playwright');
const S = __dirname, E = process.env, TAG = E.TAG || 'a', FILE = E.FILE || 'raf/DSCF0021.RAF';
let fails = 0; const ok = (name, pass, extra = '') => { if (!pass) fails++; console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? '  · ' + extra : ''}`); };
(async () => {
  const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 384, height: 780 }, deviceScaleFactor: 1, hasTouch: true });
  const p = await ctx.newPage(), logs = []; p.on('console', (m) => { if (/error/i.test(m.type())) logs.push(m.text().slice(0, 300)); }); p.on('pageerror', (e) => logs.push('ERR ' + e.message));
  const open = async () => { await p.locator('[role=list] button, button[aria-label$="RAF"], button[aria-label*="X-"], button[aria-label*="DSCF"]').first().click(); await p.waitForFunction(() => document.querySelector('canvas[aria-label="The photo being edited"]')?.isConnected, null, { timeout: 120000 }); await p.waitForTimeout(8000); };
  const toHeal = async () => { await p.getByRole('button', { name: /Back to the tools/i }).click(); await p.waitForTimeout(400); await p.locator('#dock button[data-go="Heal"]').click(); await p.waitForTimeout(1500); };
  await p.goto((process.env.BASE || 'http://127.0.0.1:8080') + '/'); await p.waitForTimeout(3000);
  await p.goto((process.env.BASE || 'http://127.0.0.1:8080') + '/lab/editor/index.html?readback'); await p.waitForTimeout(5000);
  await p.getByRole('button', { name: 'Import' }).click(); await p.waitForTimeout(300);
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.getByText('Choose photos').click()]);
  await fc.setFiles([S + '/' + FILE]);
  await p.waitForFunction(() => /Done/.test(document.body.textContent), null, { timeout: 90000 });
  await p.getByRole('button', { name: 'Import' }).click().catch(() => {});
  await open();
  // the picture as the engine last drew it: mean colour of a disc of it (centre and radius as shares of its width and height)
  const disc = (u, v, r) => p.evaluate(async ([u, v, r]) => { const c = (await import('/lab/editor/app/session.js')).canvas, W = c.width, H = c.height, d = c.getContext('2d').getImageData(0, 0, W, H).data, s = [0, 0, 0]; let n = 0, dark = 255;
    for (let y = Math.max(0, Math.floor(v * H - r * W)); y < Math.min(H, v * H + r * W); y++) for (let x = Math.max(0, Math.floor(u * W - r * W)); x < Math.min(W, u * W + r * W); x++) { if (Math.hypot(x - u * W, y - v * H) > r * W) continue; const i = (y * W + x) * 4; s[0] += d[i]; s[1] += d[i + 1]; s[2] += d[i + 2]; n++; dark = Math.min(dark, d[i + 1]); }
    return { mean: s.map((x) => +(x / n).toFixed(1)), dark }; }, [u, v, r]);
  const calm = async () => { for (let calm = 0, i = 0; calm < 3 && i < 200; i++) { await p.waitForTimeout(300); calm = (await p.evaluate(async () => (await import('/lab/editor/app/session.js')).busy())) ? 0 : calm + 1; } };   // once the engine has nothing left to draw
  const ses = (f, ...a) => p.evaluate(async ([f, a]) => { const s = await import('/lab/editor/app/session.js'); return s[f](...a); }, [f, a]);
  const spots = () => p.evaluate(async () => (await import('/lab/editor/app/heal.js')).list());
  const names = async () => (await ses('history')).steps.map((s) => s.name + (s.val ? ' ' + s.val : ''));
  const dial = async (dx) => { const r = await p.locator('[style*="ew-resize"]').first().boundingBox(); const x = r.x + r.width / 2, y = r.y + r.height / 2; await p.mouse.move(x, y); await p.mouse.down(); for (let i = 1; i <= 6; i++) { await p.mouse.move(x + (dx * i) / 6, y); await p.waitForTimeout(20); } await p.waitForTimeout(160); await p.mouse.up(); await p.waitForTimeout(600); };   // held still before letting go: a drag, not a flick
  const sec = async (name) => { const want = name[0] + name.slice(1).toLowerCase(), drum = p.locator('[role=listbox][aria-label^="Sections"]'); for (let i = 0; i < 6 && (await drum.getAttribute('aria-label')) !== 'Sections: ' + want; i++) { const r = await drum.boundingBox(); await p.mouse.click(r.x + r.width / 2, r.y + r.height - 6); await p.waitForTimeout(600); } };
  const photoBox = () => p.locator('[aria-label^="Photo. Tap a spot"]').first().boundingBox();
  const tap = async (u, v) => { const r = await photoBox(); await p.mouse.click(r.x + u * r.width, r.y + v * r.height); await p.waitForTimeout(700); };
  const rings = () => p.evaluate(() => [...document.querySelectorAll('[aria-label^="Photo. Tap a spot"] svg')].map((g) => { const c = g.querySelectorAll('circle'), b = g.closest('[aria-label^="Photo"]').getBoundingClientRect(), k = b.width / parseFloat(g.closest('[aria-label^="Photo"]').style.width); return { at: [+c[0].getAttribute('cx') * k / b.width, +c[0].getAttribute('cy') * k / b.height], src: [+c[1].getAttribute('cx') * k / b.width, +c[1].getAttribute('cy') * k / b.height], r: +c[0].getAttribute('r') * k / b.width, ink: c[0].getAttribute('stroke') }; }));
  const U = +(E.U || 0.0215), V = +(E.V || 0.31);   // something small and dark on something plain: the crane's cable against the sky
  await calm(); const base = await disc(U, V, 0.012), far = await disc(0.5, 0.5, 0.05); console.log('base', JSON.stringify(base));
  await toHeal();
  await tap(U, V); await calm(); let s = await spots(), a = await disc(U, V, 0.012), g = await rings(), f2 = await disc(0.5, 0.5, 0.05);
  ok('Heal: a tap makes a spot with a source nearby', s.length === 1 && s[0].tool === 'Heal' && Math.hypot(s[0].sx - s[0].x, s[0].sy - s[0].y) > 2 * s[0].r && Math.hypot(s[0].sx - s[0].x, s[0].sy - s[0].y) < 5 * s[0].r, JSON.stringify(s));
  ok('  the dark thing under it is gone; the rest of the photo is as it was', (E.LOOSE ? JSON.stringify(a.mean) !== JSON.stringify(base.mean) : a.dark > base.dark + 15) && JSON.stringify(f2) === JSON.stringify(far), JSON.stringify([base, a]));
  ok('  its ring is where the tap was, the dashed one at its source', g.length === 1 && Math.abs(g[0].at[0] - U) < 0.01 && Math.abs(g[0].at[1] - V) < 0.01 && g[0].ink === '#e8202a' && Math.hypot(g[0].src[0] - g[0].at[0], g[0].src[1] - g[0].at[1]) > g[0].r, JSON.stringify(g));
  await p.screenshot({ path: `${S}/shots/h7-${TAG}-heal.png` });
  // drag the source somewhere else
  const pb = await photoBox(), sx = pb.x + g[0].src[0] * pb.width, sy = pb.y + g[0].src[1] * pb.height;
  await p.mouse.move(sx, sy); await p.mouse.down(); for (let i = 1; i <= 5; i++) { await p.mouse.move(sx + 8 * i, sy + 5 * i); await p.waitForTimeout(25); } await p.mouse.up(); await p.waitForTimeout(600);
  const s2 = await spots(); ok('  dragging the dashed circle moves the source', s2.length === 1 && s2[0].sx > s[0].sx + 0.03 && s2[0].x === s[0].x, JSON.stringify([s[0].sx, s2[0].sx]));
  await dial(400); const s3 = await spots(); ok('  Size on the dial makes the chosen spot larger', s3[0].r > s2[0].r * 1.3, JSON.stringify([s2[0].r, s3[0].r]));
  await p.locator('button[aria-label="Opacity"]').first().click(); await p.waitForTimeout(300); await dial(-600); await calm(); const s4 = await spots(), a4 = await disc(U, V, 0.012);
  ok('  Opacity lets the original show through', s4[0].opacity <= 0.65 && (E.LOOSE ? JSON.stringify(a4.mean) !== JSON.stringify(a.mean) : a4.dark < a.dark - 5), JSON.stringify([s4[0].opacity, a.dark, a4.dark]));
  await sec('CLONE'); await tap(+(E.U2 || 0.5), +(E.V2 || 0.5)); await calm(); const s5 = await spots(), c5 = await disc(0.5, 0.5, 0.012);
  ok('Clone: a second spot, copied as it is', s5.length === 2 && s5[1].tool === 'Clone', JSON.stringify(s5.map((x) => x.tool)));
  let h = await names(); ok('History: a step for each', h.length >= 6 && /^Heal spot/.test(h[1]) && /source moved/.test(h[2]) && /Spot size/.test(h[3]) && /Spot opacity/.test(h[4]) && /^Clone spot/.test(h[5]), JSON.stringify(h));
  await p.locator('button[aria-label="Visualize"]').first().click(); await p.waitForTimeout(400);
  const viz = await p.evaluate(() => getComputedStyle(document.querySelector('canvas[aria-label="The photo being edited"]').closest('.fillphoto')).filter || ''); ok('Visualize shows the photo in high contrast', /grayscale/.test(viz), viz); await p.screenshot({ path: `${S}/shots/h7-${TAG}-viz.png` });
  await p.locator('button[aria-label="Visualize"]').first().click();
  await p.getByRole('button', { name: 'UNDO SPOT' }).click(); await calm(); ok('UNDO SPOT takes the last one away', (await spots()).length === 1);
  const kept = JSON.stringify(await spots()); await p.waitForTimeout(1500); await p.reload(); await p.waitForTimeout(5000); await open(); await calm();
  const back = await disc(U, V, 0.012); ok('After a reload the spot is still there, and drawn', JSON.stringify(await spots()) === kept && Math.abs(back.dark - a4.dark) < 4, JSON.stringify([a4, back]));
  await toHeal(); await p.getByRole('button', { name: 'CLEAR ALL' }).click(); await calm(); const end = await disc(U, V, 0.012);
  ok('CLEAR ALL puts the photo back', (await spots()).length === 0 && JSON.stringify(end) === JSON.stringify(base), JSON.stringify([base, end]));
  console.log(logs.length ? 'console errors:\n' + logs.slice(0, 8).join('\n') : 'no console errors'); console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  await b.close();
})();

// Step 5, headless: mixer, grading, point curve, vignette, grain through the Edit board. FILE, TAG from the environment.
const { chromium } = require('playwright');
const S = __dirname, E = process.env, TAG = E.TAG || 'a', FILE = E.FILE || 'raf/DSCF0021.RAF';
let fails = 0; const ok = (name, pass, extra = '') => { if (!pass) fails++; console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? '  · ' + extra : ''}`); };
(async () => {
  const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 384, height: 780 }, deviceScaleFactor: 1, hasTouch: true });
  const p = await ctx.newPage(), logs = []; p.on('console', (m) => { if (/error/i.test(m.type())) logs.push(m.text().slice(0, 300)); }); p.on('pageerror', (e) => logs.push('ERR ' + e.message));
  const open = async () => { await p.locator('[role=list] button, button[aria-label$="RAF"], button[aria-label*="X-"], button[aria-label*="DSCF"]').first().click(); await p.waitForFunction(() => document.querySelector('canvas[aria-label="The photo being edited"]')?.isConnected, null, { timeout: 120000 }); await p.waitForTimeout(8000); };
  await p.goto((process.env.BASE || 'http://127.0.0.1:8080') + '/'); await p.waitForTimeout(3000);
  await p.goto((process.env.BASE || 'http://127.0.0.1:8080') + '/lab/editor/index.html?readback'); await p.waitForTimeout(5000);
  await p.getByRole('button', { name: 'Import' }).click(); await p.waitForTimeout(300);
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.getByText('Choose photos').click()]);
  await fc.setFiles([S + '/' + FILE]);
  await p.waitForFunction(() => /Done/.test(document.body.textContent), null, { timeout: 90000 });
  await p.getByRole('button', { name: 'Import' }).click().catch(() => {});
  await open();
  // the picture as shown: mean colour of the whole, of the corners and the middle, and fine detail
  const look1 = () => p.evaluate(() => { const c = document.querySelector('#frame > div:first-child .fillphoto > canvas'), w = c.width, h = c.height, d = c.getContext('2d').getImageData(0, 0, w, h).data;
    const mean = (x0, y0, x1, y1) => { const a = [0, 0, 0]; let n = 0; for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) { const i = (y * w + x) * 4; a[0] += d[i]; a[1] += d[i + 1]; a[2] += d[i + 2]; n++; } return a.map((v) => +(v / n).toFixed(1)); };
    let fine = 0, n = 0, sat = 0; for (let y = 1; y < h - 1; y += 3) for (let x = 1; x < w - 1; x += 3) { const i = (y * w + x) * 4; fine += Math.abs(d[i + 1] - (d[i + 1 - 4] + d[i + 1 + 4]) / 2); sat += Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]); n++; }
    const q = Math.round(Math.min(w, h) / 8), cs = [mean(0, 0, q, q), mean(w - q, 0, w, q), mean(0, h - q, q, h), mean(w - q, h - q, w, h)], lum = (m) => (m[0] + m[1] + m[2]) / 3;
    const dark = [0, 0, 0], light = [0, 0, 0]; let nd = 0, nl = 0; for (let i = 0; i < d.length; i += 28) { const l = (d[i] + d[i + 1] + d[i + 2]) / 3; if (l < 60) { dark[0] += d[i]; dark[1] += d[i + 1]; dark[2] += d[i + 2]; nd++; } else if (l > 170) { light[0] += d[i]; light[1] += d[i + 1]; light[2] += d[i + 2]; nl++; } }
    return { size: [w, h], all: mean(0, 0, w, h), corner: +(cs.reduce((s, m) => s + lum(m), 0) / 4).toFixed(1), mid: +lum(mean(w / 2 - q | 0, h / 2 - q | 0, w / 2 + q | 0, h / 2 + q | 0)).toFixed(1), fine: +(fine / n).toFixed(2), sat: +(sat / n).toFixed(1), dark: dark.map((v) => +(v / (nd || 1)).toFixed(1)), light: light.map((v) => +(v / (nl || 1)).toFixed(1)) }; });
  const look = async () => { const t0 = Date.now(); for (let calm = 0, i = 0; calm < 3 && i < 300; i++) { await p.waitForTimeout(300); calm = (await p.evaluate(async () => { const s = await import('/lab/editor/app/session.js'); return s.busy() || !s.ready; })) ? 0 : calm + 1; } if (!look.told) { look.told = true; console.log('first frame within', Math.round((Date.now() - t0) / 1000), 's of the wait'); } return look1(); };   // once the engine has nothing left to draw
  const ses = (f, ...a) => p.evaluate(async ([f, a]) => { const s = await import('/lab/editor/app/session.js'); return s[f](...a); }, [f, a]);
  const hist = async () => { const h = await ses('history'); return { at: h.at, names: h.steps.map((s) => s.name + (s.val ? ' ' + s.val : '')) }; };
  const dial = async (dx) => { const r = await p.locator('[role=slider][style*="ew-resize"]').first().boundingBox(); const x = r.x + r.width / 2, y = r.y + r.height / 2; await p.mouse.move(x, y); await p.mouse.down(); for (let i = 1; i <= 6; i++) { await p.mouse.move(x + (dx * i) / 6, y); await p.waitForTimeout(20); } await p.waitForTimeout(180); await p.mouse.up(); await p.waitForTimeout(2500); };   // held still before letting go: a moving release would run on
  const tap = async (label, wait = 500) => { await p.locator(`button[aria-label="${label}"]`).first().click(); await p.waitForTimeout(wait); };
  const drum = p.locator('[role=listbox][aria-label^="Sections"]'); const to = async (name) => { for (let i = 0; i < 12 && (await drum.getAttribute('aria-label')) !== 'Sections: ' + name; i++) { const r = await drum.boundingBox(); await p.mouse.click(r.x + r.width / 2, r.y + r.height - 6); await p.waitForTimeout(450); } await p.waitForTimeout(400); };   // the drum, stepped to a face
  const base = await look(); console.log('base', JSON.stringify(base));
  // Colour mixer
  await to('Mixer'); await tap('Sat'); await tap('Blue');
  await dial(-240); let v = await ses('value', 'Mix Blue Sat'), a = await look(), h = await hist();
  ok('Mixer: the dial turns Blue Sat', v === -34, String(v)); ok('  one step of history, named', h.names.length === 2 && /^Mix Blue Sat −34/.test(h.names[1]), JSON.stringify(h.names)); await ses('turn', 'Mix Blue Sat', -5); a = await look(); ok('  the picture loses colour', a.sat < base.sat - 1, `${base.sat} → ${a.sat}`); await p.screenshot({ path: `${S}/shots/g5-${TAG}-mixer.png` });
  await tap('Lum'); await tap('Orange'); await dial(120); v = await ses('value', 'Mix Orange Lum'); ok('Mixer: another colour and attribute', v === 17 && (await ses('value', 'Mix Blue Sat')) === -100, String(v));
  const mid = await look(); await tap('Reset'); await p.waitForTimeout(2500); a = await look(); h = await hist(); console.log('before RESET ALL', mid.sat);
  ok('Mixer: Reset puts the picture back', (await ses('value', 'Mix Blue Sat')) === 0 && Math.abs(a.sat - base.sat) < 0.3 && h.names.at(-1) === 'Mixer reset', JSON.stringify([a.sat, h.names]));
  // Grading
  await to('Grading');
  const wheel = async (zone, fx, fy) => { const r = await p.locator(`[role=slider][aria-label="${zone} hue and saturation"]`).boundingBox(); const x = r.x + r.width / 2, y = r.y + r.height / 2; await p.mouse.move(x, y); await p.mouse.down(); for (let i = 1; i <= 5; i++) { await p.mouse.move(x + (fx * r.width / 2 * i) / 5, y - (fy * r.height / 2 * i) / 5); await p.waitForTimeout(25); } await p.mouse.up(); await p.waitForTimeout(2500); };
  const n0 = (await hist()).names.length;
  await wheel('Shadows', -0.35, -0.6); await tap('Highlights'); await wheel('Highlights', 0.6, 0.35);   // shadows toward blue (240°), highlights toward orange (30°)
  const g = { sh: [await ses('value', 'Grade Shadows Hue'), await ses('value', 'Grade Shadows Sat')], hl: [await ses('value', 'Grade Highlights Hue'), await ses('value', 'Grade Highlights Sat')] }; a = await look(); h = await hist();
  ok('Grading: the wheels set hue and saturation', Math.abs(g.sh[0] - 240) < 3 && Math.abs(g.sh[1] - 69) < 3 && Math.abs(g.hl[0] - 30) < 3 && Math.abs(g.hl[1] - 69) < 3, JSON.stringify(g));
  ok('  shadows cooler, highlights warmer', (a.dark[2] - a.dark[0]) > (base.dark[2] - base.dark[0]) + 2 && (a.light[0] - a.light[2]) > (base.light[0] - base.light[2]) + 2, JSON.stringify({ dark: [base.dark, a.dark], light: [base.light, a.light] }));
  ok('  one step a wheel', h.names.length === n0 + 2 && /^Grading · Shadows/.test(h.names[n0]) && /^Grading · Highlights/.test(h.names[n0 + 1]), JSON.stringify(h.names.slice(n0)));
  const puck = await p.evaluate(() => [...document.querySelectorAll('[role=slider][aria-label$="hue and saturation"]')].map((w) => w.getAttribute('aria-valuetext') || w.getAttribute('aria-valuenow') || ''));
  await p.screenshot({ path: `${S}/shots/g5-${TAG}-grade.png` });
  await tap('Midtones'); { const r = await p.locator('[role=slider][aria-label="Midtones brightness"]').boundingBox(); await p.mouse.move(r.x + r.width / 2, r.y + 30); await p.mouse.down(); for (let i = 1; i <= 5; i++) { await p.mouse.move(r.x + r.width / 2 + 6 * i, r.y + 30); await p.waitForTimeout(25); } await p.mouse.up(); await p.waitForTimeout(600); } v = await ses('value', 'Grade Midtones Lum'); ok('Grading: the slider beside the wheel sets the range\'s brightness', v > 20 && v < 70, String(v));
  const minis = await p.evaluate(() => [...document.querySelectorAll('.plate button[aria-label]')].map((x) => x.getAttribute('aria-label')).filter((n) => /^(Shadows|Midtones|Highlights|Global)$/.test(n))); await p.locator('.plate button[aria-label="Shadows"]').last().click(); await p.waitForTimeout(500);
  ok('  a small wheel underneath goes to its range', (await p.locator('[role=slider][aria-label="Shadows hue and saturation"]').count()) === 1, minis.join());
  await tap('Balance'); await dial(120); v = await ses('value', 'Balance'); const a2 = await look(); ok('Grading: Balance', v > 8 && JSON.stringify(a2.all) !== JSON.stringify(a.all), `${v} ${JSON.stringify([a.all, a2.all])}`);
  await tap('Blending'); await dial(120); v = await ses('value', 'Blending'); ok('Grading: Blending', v > 52 && v <= 100, String(v));
  await tap('Reset'); await p.waitForTimeout(2500); a = await look();
  ok('Grading: RESET GRADING puts the picture back', Math.abs(a.all[0] - base.all[0]) < 0.4 && Math.abs(a.all[2] - base.all[2]) < 0.4 && (await ses('value', 'Blending')) === 50, JSON.stringify([base.all, a.all]));
  await ses('undo'); await p.waitForTimeout(2500); a = await look(); ok('Undo brings the grading back', (await ses('value', 'Grade Shadows Sat')) > 55 && Math.abs(a.all[2] - a2.all[2]) < 3, JSON.stringify(a.all));
  await tap('Reset'); await p.waitForTimeout(2000);
  // Curve
  await to('Curve');
  const cv = p.locator('[aria-label^="Tone curve"]'); const cb = await cv.boundingBox(), k = cb.width / 300;
  const at = (u, w) => [cb.x + (14 + u * 272) * k, cb.y + (286 - w * 272) * k];
  const n1 = (await hist()).names.length;
  let [x0, y0] = at(0.25, 0.25), [x1, y1] = at(0.25, 0.12); await p.mouse.move(x0, y0); await p.mouse.down(); for (let i = 1; i <= 5; i++) { await p.mouse.move(x0 + (x1 - x0) * i / 5, y0 + (y1 - y0) * i / 5); await p.waitForTimeout(25); } await p.mouse.up(); await p.waitForTimeout(400);
  [x0, y0] = at(0.75, 0.75); [x1, y1] = at(0.75, 0.88); await p.mouse.move(x0, y0); await p.mouse.down(); for (let i = 1; i <= 5; i++) { await p.mouse.move(x0 + (x1 - x0) * i / 5, y0 + (y1 - y0) * i / 5); await p.waitForTimeout(25); } await p.mouse.up(); await p.waitForTimeout(2500);
  let c = await ses('curve'); a = await look(); h = await hist();
  ok('Curve: tapping the line adds points and dragging moves them', c && c.RGB && c.RGB.length === 4 && Math.abs(c.RGB[1][1] - 0.12) < 0.03 && Math.abs(c.RGB[2][1] - 0.88) < 0.03, JSON.stringify(c));
  ok('  the picture gains contrast', a.dark[1] < base.dark[1] - 2 || a.mid !== base.mid, JSON.stringify({ base: [base.dark, base.light, base.all], now: [a.dark, a.light, a.all] }));
  ok('  drags fold into few steps', h.names.length - n1 <= 2 && /^Curve · RGB/.test(h.names.at(-1)), JSON.stringify(h.names.slice(n1)));
  const drawn = await p.evaluate(() => ({ dots: document.querySelectorAll('[aria-label^="Tone curve"] ~ *, [aria-label^="Tone curve"] *').length, text: document.querySelector('[aria-label^="Tone curve"]')?.parentElement?.textContent.replace(/\s+/g, ' ').slice(0, 80) })); console.log('curve board', JSON.stringify(drawn));
  const hill = await p.evaluate(() => document.querySelector('[aria-label^="Tone curve"] svg path')?.getAttribute('d') || ''); ok('Curve: the photo\'s histogram is behind it', /^M14 286 L/.test(hill) && hill.length > 800, hill.slice(0, 40) + '…' + hill.length);
  for (let i = 0; i < 3; i++) { await p.getByRole('button', { name: 'Lift the point' }).click(); await p.waitForTimeout(120); } await p.waitForTimeout(600); const lifted = await ses('curve');
  ok('Curve: the keys beside it lift the point last touched, a level a press', Math.abs(lifted.RGB[2][1] - (c.RGB[2][1] + 3 / 255)) < 1e-6 && lifted.RGB[1][1] === c.RGB[1][1], JSON.stringify([c.RGB[2], lifted.RGB[2]])); c = lifted; a = await look();
  await p.screenshot({ path: `${S}/shots/g5-${TAG}-curve.png` });
  await tap('R'); const cb2 = await p.locator('[aria-label^="Tone curve"]').boundingBox(); [x0, y0] = [cb2.x + (14 + 0.5 * 272) * k, cb2.y + (286 - 0.5 * 272) * k]; await p.mouse.move(x0, y0); await p.mouse.down(); await p.mouse.move(x0, y0 - 20 * k); await p.mouse.move(x0, y0 - 40 * k); await p.mouse.up(); await p.waitForTimeout(2500);
  c = await ses('curve'); const a3 = await look(); ok('Curve: the red channel has its own', c.R && c.R.length === 3 && c.R[1][1] > 0.6 && a3.all[0] > a.all[0] + 3 && Math.abs(a3.all[2] - a.all[2]) < 2.5, JSON.stringify([c.R, a.all, a3.all]));
  await p.waitForTimeout(1500); await p.reload(); await p.waitForTimeout(5000); await open();
  c = await ses('curve'); const a4 = await look(); ok('After a reload the curve is still there and drawn', c && c.RGB?.length === 4 && c.R?.length === 3 && Math.abs(a4.all[0] - a3.all[0]) < 1.5, JSON.stringify([a3.all, a4.all]));
  await to('Curve'); await tap('Reset'); await p.waitForTimeout(2500); a = await look();
  ok('Curve: RESET CURVE', (await ses('curve')) === null && Math.abs(a.all[0] - base.all[0]) < 0.6, JSON.stringify([base.all, a.all]));
  // Effects
  await to('Effects'); await tap('Vignette'); await dial(-200); v = await ses('value', 'Vignette'); a = await look();
  await ses('turn', 'Vignette', -4); a = await look(); ok('Vignette darkens the corners', v < -10 && a.corner / a.mid < base.corner / base.mid - 0.05, `${v}: ${(base.corner / base.mid).toFixed(2)} → ${(a.corner / a.mid).toFixed(2)}`); await p.screenshot({ path: `${S}/shots/g5-${TAG}-vignette.png` });
  await ses('reset', 'Vignette'); await p.waitForTimeout(1500);
  await tap('Grain'); await dial(200); v = await ses('value', 'Grain'); a = await look(); await ses('turn', 'Grain', 4); a = await look(); ok('Grain adds fine texture', v > 10 && a.fine > base.fine * 1.05, `${v}: ${base.fine} → ${a.fine}`);
  console.log('pucks', JSON.stringify(puck));
  console.log(logs.length ? 'console errors:\n' + logs.slice(0, 8).join('\n') : 'no console errors'); console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  await b.close();
})();

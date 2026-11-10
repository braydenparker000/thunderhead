// Step 1, headless: free zoom on Edit and View, detail at rest, live slider at 100 %, Undo, before/after,
// histogram, history, versions. Prints PASS/FAIL lines. FILE, DPR, TAG from the environment.
const { chromium } = require('playwright');
const S = __dirname, E = process.env, TAG = E.TAG || 'a', FILE = E.FILE || 'raf2/X-E4__fuji_xe4_32_lossless.RAF', DPR = +(E.DPR || 1);
let fails = 0; const ok = (name, pass, extra = '') => { if (!pass) fails++; console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? '  · ' + extra : ''}`); };
const compare = () => {   // the detail canvas showing, against the editing copy under it, at whole-pixel shifts
  const prox = document.querySelector('#frame > div:first-child .fillphoto > canvas'), det = [...document.querySelectorAll('#frame > div:first-child .fillphoto > canvas')].slice(1).find((c) => c.style.display === 'block');
  if (!det || !prox) return { none: true };
  const dr = det.getBoundingClientRect(), pr = prox.getBoundingClientRect();
  const D = det.getContext('2d').getImageData(0, 0, det.width, det.height), P = prox.getContext('2d').getImageData(0, 0, prox.width, prox.height);
  const sx = pr.width / prox.width, sy = pr.height / prox.height, dsx = det.width / dr.width, dsy = det.height / dr.height, out = {}, step = Math.max(1, Math.round(3 / (sx * dsx)));
  for (const [ox, oy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
    let sum = 0, n = 0; const sh = Math.max(1, Math.round(sx * dsx));   // a shift of one proxy pixel's footprint
    for (let py = 0; py < prox.height; py += 2) for (let px = 0; px < prox.width; px += 2) {
      const x0 = (pr.left + px * sx - dr.left) * dsx + ox * sh, y0 = (pr.top + py * sy - dr.top) * dsy + oy * sh;
      const u0 = Math.round(x0), v0 = Math.round(y0), u1 = Math.max(u0 + 1, Math.round(x0 + sx * dsx)), v1 = Math.max(v0 + 1, Math.round(y0 + sy * dsy));
      if (u0 < 0 || v0 < 0 || u1 > det.width || v1 > det.height) continue;
      const acc = [0, 0, 0]; let m = 0;
      for (let v = v0; v < v1; v++) for (let u = u0; u < u1; u++) { const i = (v * det.width + u) * 4; if (!D.data[i + 3]) { m = -1e9; break; } acc[0] += D.data[i]; acc[1] += D.data[i + 1]; acc[2] += D.data[i + 2]; m++; }
      if (m <= 0) continue;
      const j = (py * prox.width + px) * 4; sum += Math.abs(acc[0] / m - P.data[j]) + Math.abs(acc[1] / m - P.data[j + 1]) + Math.abs(acc[2] / m - P.data[j + 2]); n++;
    }
    out[`${ox},${oy}`] = n ? +(sum / n / 3).toFixed(2) : null;
  }
  const dp = devicePixelRatio, area = det.closest('#frame > div:first-child').getBoundingClientRect();
  return { kind: det === document.querySelectorAll('#frame > div:first-child .fillphoto > canvas')[1] ? 'still' : 'live', size: [det.width, det.height], dev: [dr.left * dp, dr.top * dp, dr.width * dp, dr.height * dp].map((v) => +v.toFixed(2)), covers: dr.left <= area.left + 1 && dr.top <= area.top + 1 && dr.right >= area.right - 1 && dr.bottom >= area.bottom - 1, out };
};
const ui = () => { const s = document.querySelector('#frame > div:first-child'), w = s?.querySelector('.fillphoto'), b = s?.querySelector('span.glass'), m = /scale\(([\d.]+)\)/.exec(w?.style.transform || ''); return { scale: m ? +m[1] : null, badge: b && b.style.display !== 'none' ? b.textContent : '', map: s?.querySelector('div.glass')?.style.display === 'block', pageZoom: visualViewport.scale }; };
(async () => {
  const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 384, height: 780 }, deviceScaleFactor: DPR, hasTouch: true, acceptDownloads: true });
  const p = await ctx.newPage(), cdp = await ctx.newCDPSession(p), logs = []; p.on('console', (m) => { if (/error/i.test(m.type())) logs.push(m.text().slice(0, 300)); }); p.on('pageerror', (e) => logs.push('ERR ' + e.message));
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
  const centre = () => p.evaluate(() => { const r = document.querySelector('#frame > div:first-child').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  const pinch = async (d0, d1, rest = 9000) => { const [x, y] = await centre(); await touch('touchStart', [[x - d0, y]]); await touch('touchStart', [[x - d0, y], [x + d0, y]]); for (let i = 1; i <= 8; i++) { const d = d0 + ((d1 - d0) * i) / 8; await touch('touchMove', [[x - d, y], [x + d, y]]); await p.waitForTimeout(25); } await touch('touchEnd', []); await p.waitForTimeout(rest); };
  const drag = async (dx, dy, rest = 9000) => { const [x, y] = await centre(); await touch('touchStart', [[x, y]]); for (let i = 1; i <= 6; i++) { await touch('touchMove', [[x + (dx * i) / 6, y + (dy * i) / 6]]); await p.waitForTimeout(25); } await touch('touchEnd', []); await p.waitForTimeout(rest); };
  const dtap = async (rest = 2500) => { const [x, y] = await centre(); for (let i = 0; i < 2; i++) { await touch('touchStart', [[x, y]]); await touch('touchEnd', []); await p.waitForTimeout(90); } await p.waitForTimeout(rest); };
  const detail = async () => { let c = await p.evaluate(compare); for (let i = 0; i < 40 && (c.none || c.out['0,0'] === null); i++) { await p.waitForTimeout(1500); c = await p.evaluate(compare); } return c; };
  const good = (c, lim = 4.5) => !c.none && c.out['0,0'] !== null && c.out['0,0'] < lim && Object.values(c.out).every((v) => v === null || v >= c.out['0,0'] - 0.25);
  await p.goto((process.env.BASE || 'http://127.0.0.1:8080') + '/'); await p.waitForTimeout(3000);
  await p.goto((process.env.BASE || 'http://127.0.0.1:8080') + '/lab/editor/index.html?readback'); await p.waitForTimeout(5000);
  await p.getByRole('button', { name: 'Import' }).click(); await p.waitForTimeout(300);
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.getByText('Choose photos').click()]);
  await fc.setFiles([S + '/' + FILE]);
  await p.waitForFunction(() => /Done/.test(document.body.textContent), null, { timeout: 90000 });
  await p.getByRole('button', { name: 'Import' }).click().catch(() => {});
  await p.locator('[role=list] button, button[aria-label$="RAF"], button[aria-label*="X-"], button[aria-label*="DSCF"]').first().click();
  await p.waitForFunction(() => document.querySelector('canvas[aria-label="The photo being edited"]')?.isConnected, null, { timeout: 120000 }); await p.waitForTimeout(9000);
  if (E.FX) { await p.evaluate(async (names) => { const m = await import('/lab/editor/app/session.js'); for (const n of names.split(',')) m.turn(n, 3); }, E.FX); await p.waitForTimeout(6000); }
  if (E.GEO) { await p.evaluate(async (g) => { const m = await import('/lab/editor/app/session.js'); m.setGeo(JSON.parse(g)); }, E.GEO); await p.waitForTimeout(7000); }
  let u = await p.evaluate(ui); ok('Edit: photo fitted, no badge', u.scale === 1 && !u.badge, JSON.stringify(u));
  const z100 = await p.evaluate(async () => { const z = await import('/lab/editor/app/zoom.js'); return z.info().pct; });   // fitted, as a per cent of the sensor
  await pinch(20, Math.round(20 * 55 / z100)); u = await p.evaluate(ui); let c = await detail();
  ok('Edit: pinch to about 55 %', Math.abs(parseInt(u.badge) - 55) < 8 && u.map && u.pageZoom === 1, JSON.stringify(u));
  ok('  detail in tiles, aligned', c.kind === 'still' && good(c) && c.covers, JSON.stringify(c)); await p.screenshot({ path: `${S}/shots/z1-${TAG}-55.png` });
  await pinch(40, Math.round(40 * 97 / parseInt(u.badge))); u = await p.evaluate(ui); c = await detail();
  ok('Edit: a pinch ending near 100 % snaps to it', u.badge === '100%', JSON.stringify(u));
  ok('  one live pass, aligned, on whole pixels', c.kind === 'live' && good(c) && c.covers && c.dev.every((v) => Math.abs(v - Math.round(v)) < 0.05), JSON.stringify(c));
  const mod = () => p.evaluate(async () => { const s = await import('/lab/editor/app/session.js'); return { exp: s.value('Exposure'), hist: s.history() }; });
  await p.evaluate(async () => { const s = await import('/lab/editor/app/session.js'); s.turn('Exposure', 0.7); s.turn('Exposure', 0.8); }); await p.waitForTimeout(7000);
  c = await detail(); let m = await mod();
  ok('Edit: a slider at 100 % redraws the real pixels', c.kind === 'live' && good(c), JSON.stringify(c.out));
  ok('  and is one step of history', m.exp === 0.8 && m.hist.steps.length === 2 && m.hist.at === 1 && m.hist.steps[1].name === 'Exposure', JSON.stringify(m.hist));
  await p.evaluate(async () => { const s = await import('/lab/editor/app/session.js'); s.turn('Distortion', 3); }); await p.waitForTimeout(8000);
  c = await detail(); ok('Edit: Distortion by hand re-lays the picture, 100 % still matches', c.kind === 'live' && good(c), JSON.stringify(c.out));
  await p.evaluate(async () => { const s = await import('/lab/editor/app/session.js'); s.reset('Distortion'); }); await p.waitForTimeout(6000);
  const where = () => p.evaluate(() => { const a = document.querySelector('[data-keep="photo"]').getBoundingClientRect(), w = document.querySelector('#frame > div:first-child .fillphoto').getBoundingClientRect(), cs = [...document.querySelectorAll('#frame > div:first-child .fillphoto > canvas')].map((c) => { const r = c.getBoundingClientRect(); return [c.width, c.height, Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height), c.style.display]; }); return { area: [a.left, a.top, a.width, a.height].map(Math.round), photo: [w.left, w.top, w.width, w.height].map(Math.round), canvases: cs }; });
  await drag(-90, -60, 500);
  for (let i = 0; i < 8; i++) { const c = await p.evaluate(compare), st = await p.evaluate(async () => { const s = await import('/lab/editor/app/session.js'); return { busy: s.busy() }; }); console.log('t' + i, JSON.stringify({ kind: c.kind, size: c.size, dev: c.dev, covers: c.covers, o: c.out && c.out['0,0'] }), JSON.stringify(st), JSON.stringify((await where()).canvases)); await p.waitForTimeout(4000); }
  console.log(logs.join('\n'));
  await b.close();
})();

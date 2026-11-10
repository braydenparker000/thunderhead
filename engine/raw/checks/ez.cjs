// The editor's 100 % view, headless: import a RAF, open it, the View board, double-tap, drag, and check the
// detail canvas against the stretched editing copy under it. FILE, VW, VH, DPR, TAG from the environment.
const { chromium } = require('playwright');
const S = __dirname, E = process.env;
const VW = +(E.VW || 412), VH = +(E.VH || 915), DPR = +(E.DPR || 1), TAG = E.TAG || 'a', FILE = E.FILE || 'raf/DSCF0021.RAF';
const compare = () => {
  const det = document.querySelector('[data-keep="detail"] canvas'), prox = document.querySelector('canvas[aria-label="The photo being edited"]')?.isConnected;
  if (!det || !prox) return { err: 'no canvases', det: !!det, prox: !!prox };
  const dr = det.getBoundingClientRect(), pr = prox.getBoundingClientRect(), area = det.parentElement.getBoundingClientRect();
  const D = det.getContext('2d').getImageData(0, 0, det.width, det.height), P = prox.getContext('2d').getImageData(0, 0, prox.width, prox.height);
  const sx = pr.width / prox.width, sy = pr.height / prox.height, dsx = det.width / dr.width, dsy = det.height / dr.height, out = {};
  for (const [ox, oy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [3, 0], [0, 3]]) {   // detail pixels off
    const sum = [0, 0, 0]; let n = 0;
    for (let py = 0; py < prox.height; py += 2) for (let px = 0; px < prox.width; px += 2) {
      const x0 = (pr.left + px * sx - dr.left) * dsx + ox, y0 = (pr.top + py * sy - dr.top) * dsy + oy;
      const u0 = Math.round(x0), v0 = Math.round(y0), u1 = Math.round(x0 + sx * dsx), v1 = Math.round(y0 + sy * dsy);
      if (u0 < 0 || v0 < 0 || u1 > det.width || v1 > det.height || u1 <= u0 || v1 <= v0) continue;
      const acc = [0, 0, 0]; let m = 0;
      for (let v = v0; v < v1; v++) for (let u = u0; u < u1; u++) { const i = (v * det.width + u) * 4; acc[0] += D.data[i]; acc[1] += D.data[i + 1]; acc[2] += D.data[i + 2]; m++; }
      const j = (py * prox.width + px) * 4;
      for (let c = 0; c < 3; c++) sum[c] += Math.abs(acc[c] / m - P.data[j + c]);
      n++;
    }
    out[`${ox},${oy}`] = sum.map((s) => +(s / n).toFixed(2)).join(' ') + ' n=' + n;
  }
  const dp = devicePixelRatio, f = (v) => +(v * dp).toFixed(3);
  return { areaDev: [f(area.left), f(area.top), f(area.width), f(area.height)], detDev: [f(dr.left), f(dr.top), f(dr.width), f(dr.height)], wrapDev: [f(pr.left), f(pr.top), f(pr.width), f(pr.height)],
    det: [det.width, det.height], opacity: det.style.opacity, out };
};
const ui = () => ({ badge: [...document.querySelectorAll('.glass')].some((g) => g.textContent.trim() === '100%'), map: (() => { const i = [...document.querySelectorAll('.glass img')].find((x) => x.nextElementSibling?.style.boxShadow); return i ? [i.src.slice(0, 30), i.naturalWidth, i.parentElement.style.width, i.parentElement.style.height, i.nextElementSibling.style.cssText.replace(/box-shadow.*/, '')] : null; })(),
  hint: document.querySelector('nav[aria-label=View]')?.nextElementSibling?.textContent, name: document.querySelector('header div div')?.textContent });
(async () => {
  const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: DPR, hasTouch: true });
  const p = await ctx.newPage(); const logs = []; p.on('console', (m) => logs.push(m.type() + ': ' + m.text())); p.on('pageerror', (e) => logs.push('ERR ' + e.message));
  await p.goto((process.env.BASE || 'http://127.0.0.1:8080') + '/'); await p.waitForTimeout(3000);
  await p.goto((process.env.BASE || 'http://127.0.0.1:8080') + '/lab/editor/index.html?readback'); await p.waitForTimeout(5000);
  console.log('isolated', await p.evaluate(() => crossOriginIsolated));
  await p.getByRole('button', { name: 'Import' }).click(); await p.waitForTimeout(300);
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.getByText('Choose photos').click()]);
  await fc.setFiles([S + '/' + FILE]);
  await p.waitForFunction(() => /Done/.test(document.body.textContent), null, { timeout: 90000 });
  await p.getByRole('button', { name: 'Import' }).click().catch(() => {});
  const t0 = Date.now();
  await p.locator('[role=list] button, button[aria-label$="RAF"], button[aria-label*="DSCF"], button[aria-label*="Fuji"], button[aria-label*="X-"]').first().click();
  await p.waitForFunction(() => document.querySelector('canvas[aria-label="The photo being edited"]')?.isConnected, null, { timeout: 120000 });
  console.log('developed in', Date.now() - t0, 'ms'); await p.waitForTimeout(6000);
  await p.screenshot({ path: `${S}/shots/ez-${TAG}-edit.png` });
  await p.getByRole('button', { name: /Back to the tools/i }).click(); await p.waitForTimeout(400);
  await p.locator('#dock button[data-go="Versions"]').click(); await p.waitForTimeout(1500);
  console.log('view board', JSON.stringify(await p.evaluate(ui)));
  await p.screenshot({ path: `${S}/shots/ez-${TAG}-fit.png` });
  const area = await p.evaluate(() => { const r = document.querySelector('[data-keep="detail"]').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; });
  const tx = area[0] + area[2] * +(E.U || 0.5), ty = area[1] + area[3] * +(E.V || 0.5);
  await p.mouse.click(tx, ty); await p.waitForTimeout(90); await p.mouse.click(tx, ty);
  await p.waitForFunction(() => document.querySelector('[data-keep="detail"] canvas')?.style.opacity === '1', null, { timeout: 180000 }).catch(() => console.log('detail never shown'));
  await p.waitForTimeout(5000);
  console.log('zoomed', JSON.stringify(await p.evaluate(ui)), '\n', JSON.stringify(await p.evaluate(compare)));
  await p.screenshot({ path: `${S}/shots/ez-${TAG}-100.png` });
  await p.mouse.move(tx, ty); await p.mouse.down(); await p.mouse.move(tx - 70, ty - 40, { steps: 4 }); await p.mouse.move(tx - 141, ty - 83, { steps: 4 }); await p.mouse.up();
  await p.waitForTimeout(+(E.WAIT || 12000));
  console.log('dragged', JSON.stringify((await p.evaluate(ui)).map), '\n', JSON.stringify(await p.evaluate(compare)));
  await p.screenshot({ path: `${S}/shots/ez-${TAG}-drag.png` });
  await p.evaluate(() => { document.querySelector('[data-keep="detail"] canvas').style.visibility = 'hidden'; }); await p.screenshot({ path: `${S}/shots/ez-${TAG}-standin.png` });
  await p.evaluate(() => { document.querySelector('[data-keep="detail"] canvas').style.visibility = ''; });
  await p.mouse.click(tx, ty); await p.waitForTimeout(90); await p.mouse.click(tx, ty); await p.waitForTimeout(1500);
  console.log('out again', JSON.stringify(await p.evaluate(ui)), await p.evaluate(() => document.querySelector('[data-keep="detail"] canvas').style.opacity));
  const cdp = await ctx.newCDPSession(p), touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
  const pinch = async (d0, d1) => { await touch('touchStart', [[tx - d0, ty]]); await touch('touchStart', [[tx - d0, ty], [tx + d0, ty]]); for (let i = 1; i <= 5; i++) { const d = d0 + (d1 - d0) * i / 5; await touch('touchMove', [[tx - d, ty], [tx + d, ty]]); await p.waitForTimeout(30); } await touch('touchEnd', []); await p.waitForTimeout(1200); return (await p.evaluate(ui)).badge; };
  console.log('pinch out → 100%:', await pinch(30, 90), '· pinch in → fit:', await pinch(90, 30), '· small pinch does nothing:', await pinch(40, 44));
  await p.getByRole('button', { name: /Back to the editor/i }).click(); await p.waitForTimeout(2500);
  console.log('edit board canvas', await p.evaluate(() => { const c = document.querySelector('canvas[aria-label="The photo being edited"]')?.isConnected, r = c?.getBoundingClientRect(); return r ? [r.width, r.height] : null; }));
  console.log(logs.filter((l) => !/deprecated|Slow network/.test(l)).slice(0, 12).join('\n'));
  await b.close();
})();

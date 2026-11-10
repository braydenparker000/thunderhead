const { chromium } = require('playwright');
const S = __dirname;
(async () => {
  const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage(); const logs = []; p.on('console', m => logs.push(m.type() + ': ' + m.text())); p.on('pageerror', e => logs.push('ERR ' + e.message));
  await p.goto((process.env.BASE || 'http://127.0.0.1:8080') + '/'); await p.waitForTimeout(3000);
  if (!process.env.NOPROF) { await p.goto((process.env.BASE || 'http://127.0.0.1:8080') + '/lab/engine/'); await p.waitForTimeout(3000); await p.setInputFiles('#profiles', S + '/xe5-profiles.zip'); await p.waitForTimeout(2000); }
  const W = Number(process.env.W || 4000);
  const FILE = process.env.FILE || 'DSCF0021.RAF';
  const openPhoto = async (imp) => {
    await p.goto((process.env.BASE || 'http://127.0.0.1:8080') + '/lab/editor/index.html?readback'); await p.waitForTimeout(5000);
    if (imp) {
      await p.getByRole('button', { name: 'Import' }).click(); await p.waitForTimeout(300);
      const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.getByText('Choose photos').click()]);
      await fc.setFiles([S + '/' + (process.env.DIR || 'raf') + '/' + FILE]);
      await p.waitForFunction(() => /Done/.test(document.body.textContent), null, { timeout: 60000 });
      await p.getByRole('button', { name: 'Import' }).click().catch(() => {});
    }
    await p.locator(`button[aria-label^="${FILE.slice(0, 8)}"]`).first().click();
    await p.waitForFunction(() => document.querySelector('canvas[aria-label="The photo being edited"]')?.isConnected, null, { timeout: 90000 });
    await p.waitForTimeout(2500);
    await p.locator('nav[aria-label="Edit sections"] button', { hasText: 'COLOR' }).click(); await p.waitForTimeout(700);
  };
  const state = () => p.evaluate(() => ({
    chips: [...document.querySelectorAll('button.eng.fly')].map(c => c.getAttribute('aria-label') + '=' + c.querySelectorAll('span')[c.querySelectorAll('span').length - 1].textContent.trim()).join(' '),
    keys: [...document.querySelectorAll('button.key')].map(k => k.getAttribute('aria-label')).join(' | '),
    status: [...document.querySelectorAll('[role=status]')].map(e => e.textContent.trim().replace(/\s+/g, ' ')).join(' / '),
    dial: document.querySelector('[role=slider]')?.getAttribute('aria-label') + ' ' + document.querySelector('[role=slider]')?.getAttribute('aria-valuetext'),
    cursor: document.querySelector('canvas[aria-label="The photo being edited"]')?.isConnected.style.cursor,
  }));
  const say = async (t) => console.log(t.padEnd(18), JSON.stringify(await state()));
  // mean colour of a 9x9 patch of the shown canvas at (u, v)
  const at = (u, v) => p.evaluate(([u, v]) => { const c = document.querySelector('canvas[aria-label="The photo being edited"]')?.isConnected, g = c.getContext('2d'); const x = Math.floor(u * c.width), y = Math.floor(v * c.height), d = g.getImageData(x - 4, y - 4, 9, 9).data; const s = [0, 0, 0]; for (let i = 0; i < d.length; i += 4) { s[0] += d[i]; s[1] += d[i + 1]; s[2] += d[i + 2]; } return s.map(q => Math.round(q / 81)); }, [u, v]);
  const tap = async (u, v) => { const box = await p.locator('canvas[aria-label="The photo being edited"]').boundingBox(); await p.mouse.click(box.x + u * box.width, box.y + v * box.height); await p.waitForTimeout(W); };
  const key = (re) => p.locator('button.key').filter({ has: p.locator(':scope') }).and(p.getByRole('button', { name: re }));

  await openPhoto(true);
  console.log('canvas', await p.evaluate(() => { const c = document.querySelector('canvas[aria-label="The photo being edited"]')?.isConnected; return [c.width, c.height, c.clientWidth, c.clientHeight, !!c.getContext('2d')]; }));
  await say('as opened');
  // find the least coloured mid-bright spot, and one tinted spot, on a grid
  const spots = await p.evaluate(() => { const c = document.querySelector('canvas[aria-label="The photo being edited"]')?.isConnected, g = c.getContext('2d'); const out = []; for (let v = 0.1; v < 0.95; v += 0.05) for (let u = 0.1; u < 0.95; u += 0.05) { const d = g.getImageData(Math.floor(u * c.width) - 4, Math.floor(v * c.height) - 4, 9, 9).data; const s = [0, 0, 0]; for (let i = 0; i < d.length; i += 4) { s[0] += d[i]; s[1] += d[i + 1]; s[2] += d[i + 2]; } const m = s.map(q => q / 81), mx = Math.max(...m), mn = Math.min(...m); out.push({ u: +u.toFixed(2), v: +v.toFixed(2), m: m.map(Math.round), sat: (mx - mn) / (mx || 1), mx }); } return out; });
  const mid = spots.filter(s => s.mx > 110 && s.mx < 225);
  const grey = mid.slice().sort((a, c) => a.sat - c.sat)[0], tint = mid.filter(s => s.sat > 0.12 && s.sat < 0.3)[0] || mid.slice().sort((a, c) => c.sat - a.sat)[0];
  console.log('grey spot', JSON.stringify(grey), 'tinted spot', JSON.stringify(tint));
  if (process.env.MODE === 'pick') {
    // flat, tinted areas: mean and spread of the 21x21 patch the eyedropper reads
    const patch = (u, v) => p.evaluate(([u, v]) => { const c = document.querySelector('canvas[aria-label="The photo being edited"]')?.isConnected, g = c.getContext('2d'); const d = g.getImageData(Math.floor(u * c.width) - 10, Math.floor(v * c.height) - 10, 21, 21).data; const s = [0, 0, 0], q = [0, 0, 0]; for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) { s[k] += d[i + k]; q[k] += d[i + k] ** 2; } const m = s.map(x => x / 441); return { m: m.map(x => +x.toFixed(1)), sd: Math.max(...q.map((x, k) => Math.sqrt(Math.max(0, x / 441 - m[k] ** 2)))) }; }, [u, v]);
    const cand = [];
    for (let v = 0.06; v < 0.95; v += 0.04) for (let u = 0.06; u < 0.95; u += 0.04) { const t = await patch(u, v), mx = Math.max(...t.m), mn = Math.min(...t.m); if (t.sd < 4 && mx > 60 && mx < 235 && (mx - mn) / mx > 0.08) cand.push({ u: +u.toFixed(2), v: +v.toFixed(2), ...t, sat: (mx - mn) / mx }); }
    cand.sort((x, y) => y.sat - x.sat); const picks = [cand[0], cand[Math.floor(cand.length / 2)], cand[cand.length - 1]].filter(Boolean);
    console.log('flat tinted areas found', cand.length);
    for (const t of picks) {
      await p.getByRole('button', { name: 'Pick white balance from the photo' }).click(); await p.waitForTimeout(400);
      if (t === picks[0]) await p.screenshot({ path: S + '/shots/wb-armed.png' });
      await tap(t.u, t.v); const s2 = await state(); await p.getByRole('button', { name: 'Tint', exact: true }).click(); await p.waitForTimeout(300); const s3 = await state(); await p.getByRole('button', { name: 'Temp', exact: true }).click();
      console.log('pick', t.u, t.v, 'was', t.m, 'sd', t.sd.toFixed(1), 'now', (await patch(t.u, t.v)).m, s2.dial, s3.dial);
    }
    console.log(logs.filter(l => !/deprecated|willReadFrequently/.test(l)).slice(0, 8).join('\n')); await b.close(); return;
  }
  await tap(grey.u, grey.v); await say('tap, not armed');
  await p.getByRole('button', { name: 'Pick white balance from the photo' }).click(); await p.waitForTimeout(400); await say('armed');
  await p.getByRole('button', { name: 'Pick white balance from the photo' }).click(); await p.waitForTimeout(400); await say('put away');
  await p.getByRole('button', { name: 'Pick white balance from the photo' }).click(); await p.waitForTimeout(400);
  await tap(tint.u, tint.v); await say('picked tinted'); console.log('  there now', await at(tint.u, tint.v), 'was', tint.m);
  await p.screenshot({ path: S + '/shots/wb-picked.png' });
  await p.getByRole('button', { name: 'Pick white balance from the photo' }).click(); await p.waitForTimeout(400);
  await tap(grey.u, grey.v); await say('picked grey'); console.log('  there now', await at(grey.u, grey.v), 'was', grey.m);
  const menu = async (name) => { await p.getByRole('button', { name: /^WB · / }).click(); await p.waitForTimeout(400); const items = await p.evaluate(() => [...document.querySelectorAll('[role=menuitemradio]')].map(i => i.textContent.trim().replace(/\s+/g, ' ') + (i.getAttribute('aria-checked') === 'true' ? '*' : '')).join(' | ')); await p.getByRole('menuitemradio', { name: new RegExp('^' + name) }).click(); await p.waitForTimeout(W); return items; };
  console.log('menu:', await menu('Daylight')); await say('Daylight');
  await menu('Tungsten'); await say('Tungsten'); console.log('  grey spot', await at(grey.u, grey.v));
  await menu('As shot'); await say('As shot'); console.log('  grey spot', await at(grey.u, grey.v), 'was', grey.m);
  // turn Tint by the dial's keyboard, then back
  await p.getByRole('button', { name: 'Tint', exact: true }).click(); await p.waitForTimeout(400);
  const dial = p.locator('[role=slider]'); await dial.focus();
  for (let i = 0; i < 3; i++) await p.keyboard.press('ArrowRight'); await p.waitForTimeout(600); await say('Tint right x3');
  for (let i = 0; i < 3; i++) await p.keyboard.press('ArrowLeft'); await p.waitForTimeout(600); await say('Tint back');
  await p.getByRole('button', { name: 'Temp', exact: true }).click(); await p.waitForTimeout(400); await dial.focus();
  for (let i = 0; i < 4; i++) await p.keyboard.press('ArrowRight'); await p.waitForTimeout(1200); await say('Temp right x4');
  await openPhoto(false); await say('after reload');
  console.log(logs.filter(l => !/deprecated/.test(l)).slice(0, 12).join('\n'));
  await b.close();
})();

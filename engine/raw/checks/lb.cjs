// Step 4, headless: the Library's tiles follow the edit, the storage readout, deleting rejects, a reload.
const { chromium } = require('playwright');
const S = __dirname; let fails = 0; const ok = (name, pass, extra = '') => { if (!pass) fails++; console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? '  · ' + extra : ''}`); };
(async () => {
  const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 412, height: 915 } });
  const p = await ctx.newPage(), logs = []; p.on('console', (m) => { if (/error/i.test(m.type())) logs.push(m.text().slice(0, 300)); }); p.on('pageerror', (e) => logs.push('ERR ' + e.message));
  await p.goto((process.env.BASE || 'http://127.0.0.1:8080') + '/'); await p.waitForTimeout(3000);
  await p.goto((process.env.BASE || 'http://127.0.0.1:8080') + '/lab/editor/index.html?readback'); await p.waitForTimeout(5000);
  await p.getByRole('button', { name: 'Import' }).click(); await p.waitForTimeout(300);
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.getByText('Choose photos').click()]);
  await fc.setFiles([S + '/raf2/X-E4__fuji_xe4_32_lossless.RAF', S + '/raf/DSCF0021.RAF']);
  await p.waitForFunction(() => /Done · 2 photos/.test(document.body.textContent), null, { timeout: 120000 });
  const imp = await p.evaluate(() => [...document.querySelectorAll('#stage *')].filter((e) => !e.children.length && /Watch a folder|Later: Chrome/.test(e.textContent)).map((e) => e.textContent.trim()).join(' | '));
  await p.getByRole('button', { name: 'Import' }).click().catch(() => {}); await p.waitForTimeout(600);
  const lib = () => p.evaluate(() => ({ sub: document.querySelector('header div div:nth-child(2)')?.textContent || [...document.querySelectorAll('#stage div')].find((d) => /photos ·|reject|Delete/.test(d.textContent) && !d.children.length)?.textContent, tiles: [...document.querySelectorAll('[role=list] button img, button[aria-label] img')].map((i) => i.src.slice(0, 5) + ':' + i.naturalWidth).slice(0, 4), filters: [...document.querySelectorAll('button')].map((x) => x.textContent.trim().replace(/\s+/g, ' ')).filter((t) => /^(ALL|PICKS|RATED|EDITED|REJECTS) ?\d+$/.test(t)).join(' ') }));
  let l = await lib(); ok('two photos, with what they take on the phone', /2 of 2 photos .* (MB|GB) on this phone/.test(l.sub || ''), JSON.stringify(l)); ok('Watch a folder says it is not there yet', /Later: Chrome on Android/.test(imp), imp);
  const used0 = l.sub;
  await p.locator('button[aria-label^="X-E4"]').first().click(); await p.waitForFunction(() => document.querySelector('canvas[aria-label="The photo being edited"]')?.isConnected, null, { timeout: 120000 }); await p.waitForTimeout(8000);
  await p.evaluate(async () => { const s = await import('/lab/editor/app/session.js'); s.turn('Exposure', 1.2); s.turn('Saturation', -5); }); await p.waitForTimeout(9000);
  await p.getByRole('button', { name: /Back to (Photos|Library)/i }).first().click(); await p.waitForTimeout(2500);
  l = await lib(); const dark = await p.evaluate(async () => { const out = []; for (const i of document.querySelectorAll('button[aria-label] img')) { const c = new OffscreenCanvas(32, 32), x = c.getContext('2d'); x.drawImage(i, 0, 0, 32, 32); const d = x.getImageData(0, 0, 32, 32).data; let s = 0, sat = 0; for (let k = 0; k < d.length; k += 4) { s += d[k] + d[k + 1] + d[k + 2]; sat += Math.max(d[k], d[k + 1], d[k + 2]) - Math.min(d[k], d[k + 1], d[k + 2]); } out.push([i.closest('button').getAttribute('aria-label').slice(0, 6), i.naturalWidth, Math.round(s / d.length * 4 / 3), Math.round(sat / d.length * 4)]); } return out; });
  ok('the edited photo\'s tile is its edit (480 wide, colourless), and it counts as edited', dark.some((t) => t[0].startsWith('X-E4') && t[1] === 480 && t[3] < 6) && /EDITED ?1/.test(l.filters), JSON.stringify([dark, l.filters]));
  await p.getByRole('button', { name: /CULL/ }).first().click(); await p.waitForTimeout(400); await p.locator('button[aria-label^="DSCF0021"]').first().click(); await p.waitForTimeout(800);
  await p.getByRole('button', { name: /REJECT/ }).first().click(); await p.waitForTimeout(600); await p.getByRole('button', { name: /grid|Library|Back/i }).first().click().catch(() => {}); await p.waitForTimeout(800);
  if (/Culling on/.test((await lib()).sub || '')) { await p.getByRole('button', { name: /CULL/ }).first().click(); await p.waitForTimeout(500); }
  await p.evaluate(() => [...document.querySelectorAll('button')].find((x) => /^REJECTS/.test(x.textContent.trim()))?.click()); await p.waitForTimeout(700);
  l = await lib(); ok('Rejects offers to delete them', /1 reject · tap here to delete it/.test(l.sub || ''), l.sub);
  await p.evaluate(() => [...document.querySelectorAll('#stage [role=button]')].find((d) => /reject/.test(d.textContent))?.click()); await p.waitForTimeout(500);
  l = await lib(); ok('the first tap asks', /Delete 1 photo from this phone for good\? Tap again/.test(l.sub || ''), l.sub);
  await p.evaluate(() => [...document.querySelectorAll('#stage [role=button]')].find((d) => /Delete/.test(d.textContent))?.click()); await p.waitForTimeout(2500);
  l = await lib(); const left = await p.evaluate(async () => { const s = await import('/lab/editor/app/store.js'); const root = await navigator.storage.getDirectory(); const count = async (n) => { let k = 0; for await (const _ of (await root.getDirectoryHandle(n, { create: true })).keys()) k++; return k; }; return { photos: s.photos().map((x) => x.name.slice(0, 8)), raw: await count('raw'), jpg: await count('jpg'), thumb: await count('thumb') }; });
  ok('the second deletes it: record, RAF and JPEG gone, the other photo kept', left.photos.length === 1 && left.raw === 1 && left.jpg === 1 && /1 of 1 photos/.test(l.sub || '') && l.sub !== used0, JSON.stringify([left, l.sub]));
  await p.reload(); await p.waitForTimeout(6000); l = await lib();
  ok('after a reload: one photo, still showing its edit', /1 of 1 photos/.test(l.sub || '') && l.tiles.some((t) => t.endsWith(':480')), JSON.stringify(l));
  await p.screenshot({ path: `${S}/shots/lb-library.png` });
  console.log(logs.length ? 'console errors:\n' + logs.slice(0, 8).join('\n') : 'no console errors'); console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  await b.close();
})();

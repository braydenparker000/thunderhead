// Auto tone in the editor: node au.cjs   (FILES=dir/name,dir/name…  FULL=1 for the toggle and reload checks on the first)
const { chromium } = require('playwright'); const fs = require('fs');
const S = __dirname, W = Number(process.env.W || 4000);
const FILES = (process.env.FILES || 'raf/DSCF0021.RAF').split(',');
(async () => {
  const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader'] });
  let first = true;
  for (const path of FILES) {
    const FILE = path.split('/').pop(), tag = FILE.replace(/\W+/g, '_').slice(0, 20);
    const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1 });
    const p = await ctx.newPage(); const logs = []; p.on('pageerror', e => logs.push('ERR ' + e.message));
    const openPhoto = async (imp) => {
      await p.goto((process.env.BASE || 'http://127.0.0.1:8080') + '/lab/editor/index.html?readback'); await p.waitForTimeout(5000);
      if (imp) {
        await p.getByRole('button', { name: 'Import' }).click(); await p.waitForTimeout(300);
        const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.getByText('Choose photos').click()]);
        await fc.setFiles([S + '/' + path]);
        await p.waitForFunction(() => /Done/.test(document.body.textContent), null, { timeout: 90000 });
        await p.getByRole('button', { name: 'Import' }).click().catch(() => {});
      }
      await p.locator(`button[aria-label^="${FILE.slice(0, 8)}"]`).first().click();
      await p.waitForFunction(() => document.querySelector('canvas[aria-label="The photo being edited"]')?.isConnected, null, { timeout: 90000 });
      await p.waitForTimeout(2500);
      await p.locator('nav[aria-label="Edit sections"] button', { hasText: 'LIGHT' }).click(); await p.waitForTimeout(W);
    };
    const chips = () => p.evaluate(() => [...document.querySelectorAll('button.eng.fly')].map(c => c.textContent.trim().replace(/\s+/g, ' ')).join(' | ')
      + '  [' + [...document.querySelectorAll('[role=status]')].map(e => e.textContent.trim().replace(/\s+/g, ' ')).join(' / ') + ']');
    const shot = async (n) => { const u = await p.evaluate(() => { const c = document.querySelector('canvas[aria-label="The photo being edited"]')?.isConnected, s = 420 / Math.max(c.width, c.height), o = document.createElement('canvas'); o.width = Math.round(c.width * s); o.height = Math.round(c.height * s); o.getContext('2d').drawImage(c, 0, 0, o.width, o.height); return o.toDataURL('image/jpeg', 0.85); }); fs.writeFileSync(`${S}/shots/au-${tag}-${n}.jpg`, Buffer.from(u.split(',')[1], 'base64')); };
    const auto = async () => { await p.getByRole('button', { name: 'AUTO', exact: true }).click(); await p.waitForTimeout(300); const c = await chips(); await p.waitForTimeout(W); return c; };
    try {
      await openPhoto(true); await shot(0);
      console.log(tag.padEnd(21), 'auto  ', await auto()); await shot(1);
      if (first && process.env.FULL) {
        console.log(''.padEnd(21), 'again ', await auto());
        console.log(''.padEnd(21), 'third ', await auto());
        await p.getByRole('button', { name: 'Shadows', exact: true }).click(); await p.waitForTimeout(400); await p.locator('[role=slider]').focus(); await p.keyboard.press('ArrowRight'); await p.waitForTimeout(600);
        console.log(''.padEnd(21), 'moved ', await chips());
        console.log(''.padEnd(21), 'auto4 ', await auto());
        console.log(''.padEnd(21), 'auto5 ', await auto());
        await p.waitForTimeout(3000); console.log(''.padEnd(21), 'late  ', await chips());
        await openPhoto(false); console.log(''.padEnd(21), 'reload', await chips());
      }
    } catch (e) { console.log(tag, 'FAILED', String(e).slice(0, 200)); }
    if (logs.length) console.log(logs.join('\n'));
    first = false; await ctx.close();
  }
  await b.close();
})();

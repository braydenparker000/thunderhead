// The design's sample pages still play (no photo open): the Export and View boards' mock branches.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader'] });
  const p = await (await b.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: 'block' })).newPage(); const logs = [];
  p.on('console', (m) => { if (/error/i.test(m.type())) logs.push(m.text().slice(0, 200)); }); p.on('pageerror', (e) => logs.push('ERR ' + e.message));
  for (const page of ['export', 'viewing', 'crop', 'library']) {
    await p.goto((process.env.BASE || 'http://127.0.0.1:8080') + `/lab/editor/${page}/`); await p.waitForTimeout(2500);
    console.log(page, '→', (await p.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 230))));
    if (page === 'export') { await p.getByRole('button', { name: /SAVE BOTH/ }).click(); await p.waitForTimeout(4500); console.log(' after save:', await p.evaluate(() => (document.body.innerText.match(/(Saved to Downloads).{0,160}/) || ['not done'])[0].replace(/\s+/g, ' '))); }
    else if (page === 'library') { console.log(' library sample:', await p.evaluate(() => [...document.querySelectorAll('#stage div')].find((d) => /photos ·/.test(d.textContent) && !d.children.length)?.textContent)); }
    else if (page === 'crop') { await p.getByRole('button', { name: 'Auto', exact: true }).first().click(); await p.waitForTimeout(600); console.log(' crop sample:', await p.evaluate(() => [...document.querySelectorAll('span')].map((x) => x.textContent).find((t) => /^\d+ × \d+ · /.test(t)))); }
    else { const a = await p.evaluate(() => { const r = document.querySelector('[aria-label^="Photo"]').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }); await p.mouse.click(a[0], a[1]); await p.waitForTimeout(80); await p.mouse.click(a[0], a[1]); await p.waitForTimeout(900); console.log(' zoomed badge:', await p.evaluate(() => [...document.querySelectorAll('.glass')].some((g) => g.textContent.trim() === '100%'))); }
  }
  console.log(logs.filter((l) => !/Service Worker/.test(l)).join('\n') || 'no errors');
  await b.close();
})();

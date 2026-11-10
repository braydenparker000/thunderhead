// A sample page as designed (no photo): node sp.cjs <route> <out.png>
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: 'block' })).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (/error/i.test(m.type())) errs.push(m.text().slice(0, 200)); });
  await p.goto((process.env.BASE || 'http://127.0.0.1:8080') + `/lab/editor/${process.argv[2]}/`); await p.waitForTimeout(2500);
  await p.screenshot({ path: process.argv[3] }); console.log(errs.length ? errs.join('\n') : 'no errors'); await b.close();
})();

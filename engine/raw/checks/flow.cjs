const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 384, height: 740 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
  const title = () => p.evaluate(() => document.querySelector('#stage div div')?.innerText.slice(0, 40).replace(/\n/g, ' | '));
  await p.goto((process.env.BASE || 'http://127.0.0.1:8080') + '/lab/editor/'); await p.waitForTimeout(800);
  const log = [await title()];
  await p.getByRole('button', { name: 'CULL' }).click(); await p.waitForTimeout(300);
  await p.getByRole('button', { name: 'EDIT ›' }).click(); await p.waitForTimeout(600); log.push(await title());
  await p.getByRole('button', { name: 'Back to the tools' }).click(); await p.waitForTimeout(300);
  await p.screenshot({ path: 'shots/dock.png' });
  await p.locator('#dock [data-go=Crop]').click(); await p.waitForTimeout(600); log.push(await title());
  await p.getByRole('button', { name: 'Export' }).click(); await p.waitForTimeout(600); log.push(await title());
  await p.goBack(); await p.waitForTimeout(600); log.push(await title());
  await p.getByRole('button', { name: 'Back to Photos' }).click(); await p.waitForTimeout(600); log.push(await title());
  console.log(JSON.stringify(log, null, 1), JSON.stringify(errs));
  await b.close();
})();

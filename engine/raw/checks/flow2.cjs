const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 384, height: 740 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
  const title = () => p.evaluate(() => document.querySelector('#stage div div')?.innerText.slice(0, 30).replace(/\n/g, ' | '));
  await p.goto((process.env.BASE || 'http://127.0.0.1:8080') + '/lab/editor/'); await p.waitForTimeout(800);
  const log = [];
  await p.locator('#stage button[aria-label^="DSCF"]').first().click(); await p.waitForTimeout(600); log.push('tile, cull off -> ' + await title());
  await p.getByRole('button', { name: 'Back to Photos' }).click(); await p.waitForTimeout(600);
  await p.getByRole('button', { name: 'CULL' }).click(); await p.waitForTimeout(200);
  await p.locator('#stage button[aria-label^="DSCF"]').nth(2).click(); await p.waitForTimeout(500); log.push('tile, cull on -> ' + await title());
  await p.getByRole('button', { name: 'EDIT ›' }).click(); await p.waitForTimeout(600);
  // drag the dial and read the window right away
  const box = await p.locator('[role=slider][aria-label=Exposure]').boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await p.mouse.down();
  await p.mouse.move(box.x + box.width / 2 + 160, box.y + box.height / 2, { steps: 6 });
  log.push('window during drag: ' + await p.evaluate(() => { const r = document.querySelector('[role=status]'); return r.getAttribute('aria-label'); }));
  await p.screenshot({ path: 'shots/drag.png' }); await p.mouse.up();
  await p.getByRole('button', { name: 'Back to the tools' }).click(); await p.waitForTimeout(300);
  await p.locator('#dock [data-go=Versions]').click(); await p.waitForTimeout(600); log.push('versions -> ' + await title());
  await p.getByRole('button', { name: 'Back to the tools' }).click(); await p.waitForTimeout(300);
  log.push('dock open on versions: ' + await p.evaluate(() => !document.getElementById('dock').hidden));
  await p.locator('#dockveil').click({ position: { x: 20, y: 20 } }); await p.waitForTimeout(200);
  await p.getByRole('button', { name: 'Back to the editor' }).click(); await p.waitForTimeout(600); log.push('versions back -> ' + await title());
  console.log(log.join('\n'), '\nerrors', JSON.stringify(errs));
  await b.close();
})();

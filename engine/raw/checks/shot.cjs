const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 384, height: 740 }, deviceScaleFactor: 1 });
  const errs = [];
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  p.on('pageerror', e => errs.push('PAGE ' + e.message));
  for (const s of ['edit','crop','masks','looks','library','export','viewing','heal']) {
    await p.goto((process.env.BASE || 'http://127.0.0.1:8080') + '/lab/editor/' + s + '/');
    await p.waitForTimeout(900);
    await p.screenshot({ path: 'shots/' + s + '.png' });
  }
  await p.goto((process.env.BASE || 'http://127.0.0.1:8080') + '/lab/editor/edit/');
  await p.waitForTimeout(600);
  await p.getByRole('button', { name: 'COLOR' }).click().catch(e => errs.push('click ' + e.message));
  await p.mouse.move(206, 700); await p.mouse.down(); await p.mouse.move(300, 700, { steps: 8 }); await p.mouse.up();
  await p.waitForTimeout(700);
  await p.screenshot({ path: 'shots/edit2.png' });
  console.log(JSON.stringify(errs.slice(0, 12)));
  await b.close();
})();

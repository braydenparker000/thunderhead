import { start, opened } from './open.mjs';
const { browser, base, stop } = await start();
try {
  const { page, cdp } = await opened(browser, base, { W: 600, H: 400 });
  const pick = (face, adj) => page.evaluate(([face, adj]) => { const c = document.querySelector('#stage')._root.c; c.setState({ face, adj: { ...c.state.adj, [face]: adj } }); }, [face, adj]);
  const angle = () => page.evaluate(() => +document.querySelector('#stage [role=slider]').closest('dc-host')._inst.c.state.angle.toFixed(3));
  const wheel = () => page.evaluate(() => document.querySelector('#stage .wheelp')?.style.backgroundPosition);
  for (const [face, adj, px] of [['Detail', 'Noise', 8], ['Effects', 'Grain', 34], ['Detail', 'Radius', 20]]) {
    await pick(face, adj); await page.waitForTimeout(400);
    const box = await page.locator('#stage [role=slider]').first().boundingBox(), y = box.y + box.height / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y }] });
    for (let i = 1; i <= px; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 200 + i, y }] }); await page.waitForTimeout(12); }
    await page.waitForTimeout(300);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const log = [];
    for (const ms of [100, 500, 1000, 2000, 3000]) { await page.waitForTimeout(ms - (log.at(-1)?.[0] || 0)); log.push([ms, await angle(), await wheel()]); }
    console.log(adj, JSON.stringify(log));
  }
} finally { await stop(); }

// 1. Does the network give the same pixels for a place whichever window it falls in? (Seams between an export's pieces.)
// 2. What a dial's frame costs with the photo zoomed in: the fitted photo's pass and the full-size view's, apart.
import { withRaf, crop } from './rafkit.mjs';
await withRaf(async ({ page }) => {
  for (const best of [true, false]) { const t = best ? 'net' : 'usual'; await crop(page, `seam-${t}-a`, 3000, 2000, 448, 448, best); await crop(page, `seam-${t}-b`, 3200, 2100, 448, 448, best); }
  const cost = await page.evaluate(async () => {
    const photo = await import('/lab/editor/app/session.js'), big = photo.whole(), e = photo.eng, c = photo.current();
    const v = await big.view(1083, 1939, null, false, false, false);   // a 4 GB phone's screenful of sensor pixels
    await photo.alone(async () => { await photo.settle(); await v.region(3000, 1500, 1083, 1939); });
    const args = (k, more) => [c.values.Exposure + c.shotEv + k * 0.01, 1, { ...photo.dials(c.values, c.curve), masks: c.masks, baseEv: c.shotEv, ...more }];
    const time = async (more) => { const ms = []; for (let k = 1; k <= 6; k++) ms.push(await e.render(...args(k, more))); ms.sort((a, b) => a - b); return Math.round(ms[2]); };
    const out = { both: 0, viewOnly: 0, fittedOnly: 0 };
    await photo.alone(async () => { out.both = await time({}); out.viewOnly = await time({ fit: false }); v.rest(); out.fittedOnly = await time({}); });
    v.dispose();
    return out;
  });
  console.log('a dial frame on the software GPU, ms:', JSON.stringify(cost));
});

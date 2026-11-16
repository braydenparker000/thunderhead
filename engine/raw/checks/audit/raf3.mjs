// Usual demosaic against the network at the left edge, the centre and the right edge of a RAF: is the colour fringing the lens's?
import { withRaf, crop } from './rafkit.mjs';
const file = process.argv[2], tag = process.argv[3];
await withRaf(async ({ page }) => {
  const info = await page.evaluate(async () => { const s = await import('/lab/editor/app/store.js'), p = await import('/lab/editor/app/session.js'); return { shot: s.photos()[0].shot, line: p.kindLine(), size: p.shape(), noise: p.value('Noise') }; });
  console.log(JSON.stringify(info));
  const [W, H] = info.size, S = 448;
  for (const [name, x, y] of [['left', 120, H / 2 - S / 2], ['centre', W / 2 - S / 2, H / 2 - S / 2], ['right', W - S - 120, H / 2 - S / 2], ['corner', W - S - 150, 150]]) {
    await crop(page, `${tag}-${name}-usual`, Math.round(x), Math.round(y), S, S, false);
    await crop(page, `${tag}-${name}-net`, Math.round(x), Math.round(y), S, S, true);
  }
}, { file });

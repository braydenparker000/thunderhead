// Auto level pressed twice: does the second press keep the first's answer?
import { withRaf } from './rafkit.mjs';
await withRaf(async ({ page }) => {
  const idle = () => page.evaluate(async () => { const p = await import('/lab/editor/app/session.js'); for (let i = 0; i < 4000 && p.busy(); i++) await new Promise((r) => setTimeout(r, 25)); });
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('editor:open', { detail: 'Crop' }))); await page.waitForTimeout(900);
  const angle = () => page.evaluate(async () => (await import('/lab/editor/app/session.js')).geo()?.angle ?? 0);
  const lean = () => page.evaluate(async () => +(await (await import('/lab/editor/app/session.js')).level()).toFixed(2));
  console.log('as opened: angle', await angle(), 'the picture leans', await lean());
  for (let k = 1; k <= 3; k++) {
    await page.getByRole('button', { name: 'AUTO' }).first().tap(); await page.waitForTimeout(1500); await idle(); await page.waitForTimeout(800); await idle();
    console.log(`after AUTO ${k}: angle`, await angle(), 'the picture as cropped now leans', await lean());
  }
});

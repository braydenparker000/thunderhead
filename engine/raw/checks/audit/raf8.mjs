// Before/after on a cropped and edited photo; the View, Looks and Export boards on the real RAF.
import { withRaf, out } from './rafkit.mjs';
await withRaf(async ({ page }) => {
  const go = async (b) => { await page.evaluate((b) => document.dispatchEvent(new CustomEvent('editor:open', { detail: b })), b); await page.waitForTimeout(900); };
  const idle = async () => { await page.evaluate(async () => { const p = await import('/lab/editor/app/session.js'); for (let i = 0; i < 6000 && p.busy(); i++) await new Promise((r) => setTimeout(r, 25)); }); await page.waitForTimeout(400); };
  await page.evaluate(async () => { const p = await import('/lab/editor/app/session.js'); p.setValues({ Exposure: 0.7, Saturation: 40 }, '', 'audit'); p.setGeo({ quarter: 0, flipH: false, flipV: false, angle: 6, vertical: 0, horizontal: 0, scale: 0, rect: { x: 0.45, y: 0.3, w: 0.5, h: 0.6 }, aspect: 'Free', portrait: false }, 'audit'); });
  await idle();
  await go('Versions'); await idle(); await page.waitForTimeout(2500); await idle();
  await page.screenshot({ path: `${out}v-compare-cropped.png` });
  // hold the photo: the original
  const b = await page.locator('#stage [data-keep="photo"]').first().boundingBox();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x + b.width * 0.8, y: b.y + b.height / 2 }] });
  await page.waitForTimeout(1500); await idle();
  await page.screenshot({ path: `${out}v-hold-cropped.png` });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await go('Looks'); await idle(); await page.screenshot({ path: `${out}v-looks.png` });
  await go('Export'); await idle(); await page.screenshot({ path: `${out}v-export.png` });
});

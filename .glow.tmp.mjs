import { chromium } from 'playwright';
import { serve } from './scripts/serve.mjs';
const server = await serve(0); const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const out = process.argv[2];
for (const theme of ['light', 'dark']) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
  await page.addInitScript((t) => { try { localStorage.setItem('th-theme', t); } catch {} }, theme);
  await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "export const CONFIG = { api: '', build: 0, commit: 'dev', repo_url: '' };" }));
  await page.goto(base + '/', { waitUntil: 'load' }); await page.waitForTimeout(900);
  for (const [name, cls] of [['calm', 'calm breathe'], ['think', 'think'], ['gold', 'calm gold'], ['listen', 'listen']]) {
    await page.evaluate((c) => { const e = document.querySelector('#edge'); e.className = 'edge ' + c; }, cls);
    await page.waitForTimeout(1600);
    if (name === 'think') await page.evaluate(() => document.getAnimations().forEach((a) => { if (String(a.animationName) === 'think') { a.pause(); a.currentTime = 1600; } }));
    await page.screenshot({ path: `${out}/${theme}-${name}.png` });
  }
  await page.close();
}
await browser.close(); server.close();

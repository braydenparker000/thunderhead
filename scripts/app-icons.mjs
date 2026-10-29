// Renders the install icons in frontend/ui/ from frontend/icon.svg with Chromium: 192 and 512 px,
// plus a 512 px maskable copy (full-bleed background, the mark inside the 80% safe zone).
// The PNGs are committed; run after changing icon.svg: node scripts/app-icons.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const repo = fileURLToPath(new URL('../', import.meta.url));
const svg = readFileSync(`${repo}frontend/icon.svg`, 'utf8');
const data = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage();
async function render(size, file, maskable) {
  await page.setViewportSize({ width: size, height: size });
  const inner = maskable ? Math.round(size * 0.8) : size;
  await page.setContent(`<body style="margin:0;width:${size}px;height:${size}px;display:grid;place-items:center;background:${maskable ? 'linear-gradient(135deg,#cfe0f7,#e9dff3 55%,#f7e7d6)' : 'transparent'}"><img src="${data}" width="${inner}" height="${inner}"></body>`);
  await page.screenshot({ path: `${repo}frontend/ui/${file}`, omitBackground: !maskable });
}
await render(192, 'app-icon-192.png', false);
await render(512, 'app-icon-512.png', false);
await render(512, 'app-icon-maskable-512.png', true);
await browser.close();

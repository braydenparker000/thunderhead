// Opens the editor at a phone's size with a JPEG drawn by the page; shared by the review's scripts.
import { chromium } from 'playwright';
import { serve } from '../../../../scripts/serve.mjs';
export async function start() {
  const server = await serve(0), base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader'] });
  return { server, base, browser, stop: async () => { await browser.close(); server.close(); } };
}
export async function opened(browser, base, { W = 1200, H = 800, vw = 412, vh = 915, dpr = 1, board = 'Edit', draw = null } = {}) {
  const context = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: dpr, hasTouch: true, serviceWorkers: 'block', acceptDownloads: true });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
  await page.goto(`${base}/lab/editor/?readback`, { waitUntil: 'load' });
  await page.waitForSelector('#stage header');
  await page.evaluate(async ([W, H, board, draw]) => {
    const c = new OffscreenCanvas(W, H), g = c.getContext('2d');
    if (draw) new Function('g', 'W', 'H', draw)(g, W, H);
    else for (let y = 0; y < H; y += 40) for (let x = 0; x < W; x += 40) { g.fillStyle = `hsl(${(x / W) * 360} 50% ${30 + (((x + y) / 40) % 2) * 25}%)`; g.fillRect(x, y, 40, 40); }
    const blob = await c.convertToBlob({ type: draw ? 'image/png' : 'image/jpeg', quality: 0.9 });
    const store = await import('/lab/editor/app/store.js'), photo = await import('/lab/editor/app/session.js');
    await store.add([new File([blob], 'IMG_0009.jpg', { type: 'image/jpeg', lastModified: 1_700_000_000_000 })], () => {});
    await photo.open(store.photos()[0].id);
    document.dispatchEvent(new CustomEvent('editor:open', { detail: board }));
    for (let i = 0; i < 2400 && !(photo.ready && photo.whole() && !photo.busy()); i++) await new Promise((r) => setTimeout(r, 50));
    if (!photo.whole()) throw new Error('the photo did not open');
  }, [W, H, board, draw]);
  await page.waitForTimeout(500);
  return { context, page, errors, cdp: await context.newCDPSession(page) };
}

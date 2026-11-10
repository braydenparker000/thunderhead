// What a pinch does on the Edit board and on the View board, in a phone-sized touch browser (the released code).
const { chromium } = require('playwright');
const S = __dirname;
(async () => {
  const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 384, height: 780 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const p = await ctx.newPage(); const cdp = await ctx.newCDPSession(p);
  await p.goto((process.env.BASE || 'http://127.0.0.1:8080') + '/'); await p.waitForTimeout(3000);
  await p.goto((process.env.BASE || 'http://127.0.0.1:8080') + '/lab/editor/index.html?readback'); await p.waitForTimeout(5000);
  await p.getByRole('button', { name: 'Import' }).click(); await p.waitForTimeout(300);
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.getByText('Choose photos').click()]);
  await fc.setFiles([S + '/raf2/X-E4__fuji_xe4_32_lossless.RAF']);
  await p.waitForFunction(() => /Done/.test(document.body.textContent), null, { timeout: 90000 });
  await p.getByRole('button', { name: 'Import' }).click().catch(() => {});
  await p.locator('[role=list] button, button[aria-label$="RAF"], button[aria-label*="X-"]').first().click();
  await p.waitForFunction(() => document.querySelector('canvas[aria-label="The photo being edited"]')?.isConnected, null, { timeout: 120000 }); await p.waitForTimeout(8000);
  const state = () => p.evaluate(() => { const v = visualViewport, f = document.getElementById('frame'), c = document.querySelector('canvas[aria-label="The photo being edited"]')?.isConnected?.getBoundingClientRect(); return { pageZoom: +v.scale.toFixed(2), view: [Math.round(v.offsetLeft), Math.round(v.offsetTop), Math.round(v.width), Math.round(v.height)], frame: f.style.transform, photoBox: c ? [Math.round(c.left), Math.round(c.top), Math.round(c.width), Math.round(c.height)] : null, badge100: [...document.querySelectorAll('.glass')].some((g) => g.textContent.trim() === '100%') }; });
  const centre = () => p.evaluate(() => { const r = document.querySelector('[data-keep="photo"]').getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]; });
  const pinch = async (scaleFactor) => { const [x, y] = await centre(); await cdp.send('Input.synthesizePinchGesture', { x, y, scaleFactor, relativeSpeed: 600, gestureSourceType: 'touch' }); await p.waitForTimeout(1500); };
  console.log('EDIT board, before  :', JSON.stringify(await state()));
  // what Chrome on the phone does on a pinch here: it magnifies the page (the visual viewport shrinks)
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 }); await p.waitForTimeout(1500);
  console.log('page magnified 2x   :', JSON.stringify(await state())); await p.screenshot({ path: `${S}/shots/pz-edit-pagezoom.png` });
  await b.close();
})();

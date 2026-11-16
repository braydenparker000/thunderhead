// Twelve real RAFs in the Library: what its tiles cost to draw.
import { start } from './open.mjs';
import { readdirSync } from 'node:fs';
const dir = `${process.env.AUDIT_RAFS}/`, files = readdirSync(dir).map((f) => dir + f);
const { browser, base, stop } = await start();
try {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, hasTouch: true, serviceWorkers: 'block' });
  const page = await context.newPage();
  await page.goto(`${base}/lab/editor/?readback`, { waitUntil: 'load' });
  await page.waitForSelector('#stage header');
  await page.getByRole('button', { name: 'Import' }).click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByText('Choose photos', { exact: true }).click()]);
  const t0 = Date.now();
  await chooser.setFiles(files);
  await page.waitForFunction(() => /Done · \d+ photos? copied/.test(document.querySelector('#stage')?.textContent ?? ''), null, { timeout: 300_000 });
  console.log('12 RAFs copied in', Date.now() - t0, 'ms');
  // reload: the Library as it opens on a later visit
  await browser.startTracing(page, { categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'blink', 'cc'] });
  const t1 = Date.now();
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelectorAll('#stage img[src^="blob:"]').length >= 12, null, { timeout: 120_000 });
  const shown = Date.now() - t1;
  await page.waitForFunction(() => [...document.querySelectorAll('#stage img[src^="blob:"]')].every((im) => im.complete && im.naturalWidth > 0), null, { timeout: 120_000 });
  await page.waitForTimeout(1500);
  const ev = JSON.parse((await browser.stopTracing()).toString()).traceEvents;
  const dec = ev.filter((e) => /Decode Image|ImageDecodeTask|Decode LazyPixelRef/.test(e.name) && e.ph === 'X').map((e) => Math.round((e.dur || 0) / 1000));
  const info = await page.evaluate(async () => { const s = await import('/lab/editor/app/store.js'); const im = [...document.querySelectorAll('#stage img[src^="blob:"]')]; return { photos: s.photos().length, tiles: im.length, natural: [im[0].naturalWidth, im[0].naturalHeight], shownAt: [Math.round(im[0].getBoundingClientRect().width * devicePixelRatio)], usage: Math.round((await s.usage()) / 1e6) }; });
  console.log('Library after a reload: tiles in the page after', shown, 'ms;', JSON.stringify(info));
  console.log('image decodes:', dec.length, 'total ms', dec.reduce((a, b) => a + b, 0), 'each', dec.slice(0, 16).join(','));
  
} finally { await stop(); }

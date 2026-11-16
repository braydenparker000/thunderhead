// The real RAF open in the real editor, and a way to get any rectangle of it at full size as the editor makes it.
import { start } from './open.mjs';
import { writeFileSync } from 'node:fs';
export const RAF = process.env.AUDIT_RAF || '';   // a 40 MP X-Trans RAF kept OUTSIDE the repository (README.md)
export const out = `${process.env.AUDIT_OUT || '/tmp/audit'}/`;   // where pictures are written: never inside the repository
export async function withRaf(fn, { vw = 412, vh = 915, file = RAF } = {}) {
  const { browser, base, stop } = await start();
  try {
    const context = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1, hasTouch: true, serviceWorkers: 'block', acceptDownloads: true });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !/Service Worker/.test(m.text())) errors.push(`[${m.type()}] ${m.text()}`); });
    await page.goto(`${base}/lab/editor/?readback`, { waitUntil: 'load' });
    await page.waitForSelector('#stage header');
    await page.getByRole('button', { name: 'Import' }).click();
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByText('Choose photos', { exact: true }).click()]);
    await chooser.setFiles(file);
    await page.waitForFunction(() => /Done · \d+ photos? copied/.test(document.querySelector('#stage')?.textContent ?? ''), null, { timeout: 180_000 });
    await page.touchscreen.tap(380, 400); await page.waitForTimeout(300);
    await page.evaluate(async () => {
      const store = await import('/lab/editor/app/store.js'), photo = await import('/lab/editor/app/session.js');
      await photo.open(store.photos()[0].id);
      document.dispatchEvent(new CustomEvent('editor:open', { detail: 'Edit' }));
      for (let i = 0; i < 6000 && !(photo.ready && !photo.busy() && photo.whole()); i++) await new Promise((r) => setTimeout(r, 50));
      if (!photo.whole()) throw new Error('no full size');
    });
    await fn({ page, context, errors, cdp: await context.newCDPSession(page) });
    console.log('errors', JSON.stringify(errors));
  } finally { await stop(); }
}
/** A rectangle at full size, as PNG bytes. best: false the usual demosaic, true the network, 'once' the first look alone. `set`: values put on first. */
export async function crop(page, name, X, Y, w, h, best = false, set = null) {
  const r = await page.evaluate(async ([X, Y, w, h, best, set]) => {
    const photo = await import('/lab/editor/app/session.js'), big = photo.whole(), t = performance.now();
    if (set) { photo.setValues(set, '', 'audit'); for (let i = 0; i < 4000 && photo.busy(); i++) await new Promise((r) => setTimeout(r, 25)); }
    const v = await big.view(w, h, null, false, false, best);
    let im = null;
    await photo.alone(async () => { await photo.settle(); await v.region(X, Y, w, h); im = await v.read(); v.rest(); });
    const info = { net: v.net, lost: v.lost, ms: Math.round(performance.now() - t) };
    v.dispose();
    const c = new OffscreenCanvas(im.width, im.height); c.getContext('2d').putImageData(im, 0, 0);
    const b = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer()); let s = ''; for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192));
    return { ...info, w: im.width, h: im.height, png: btoa(s) };
  }, [X, Y, w, h, best, set]);
  writeFileSync(`${out}${name}.png`, Buffer.from(r.png, 'base64'));
  console.log(name, r.w, r.h, 'net', r.net, r.lost || '', r.ms, 'ms');
  return r;
}

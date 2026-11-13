// What the owner's phone showed of an export (2026-11-13), in the new editor at /lab/editor/: an export keeps the
// screen awake (app/save.js); a file that carries metadata says how it was made (app/export-note.js, written by
// engine/files.js on the export's thread, read back by scripts/export-note.mjs); and the Export board says how long
// an export should take from this phone's own past exports (app/eta.js), how long is left while it runs, and,
// when the network was stopped by the phone, that this export is made the standard way, with BEST AGAIN.
// The photo is a JPEG drawn by the test, on a software GPU.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { noteIn } from '../scripts/export-note.mjs';

const opts = { skip: Boolean(process.env.SITE_URL) && 'local only (a software GPU)', timeout: 600_000 };
let server, browser, base;
before(async () => {
  if (opts.skip) return;
  server = await serve(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const exe = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
  browser = await chromium.launch({ ...exe, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader'] });
});
after(async () => { await browser?.close(); server?.close(); });

/** The editor with a photo of W × H drawn by the page, open and its own pixels ready; `timings` kept first. */
async function opened(W, H, timings = []) {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true, serviceWorkers: 'block', acceptDownloads: true });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((t) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('th.editor.timings', JSON.stringify(t)); sessionStorage.setItem('seeded', '1'); } }, timings);
  await page.goto(`${base}/lab/editor/?readback`, { waitUntil: 'load' });
  await page.waitForSelector('#stage header');
  await page.evaluate(async ([W, H]) => {
    const c = new OffscreenCanvas(W, H), g = c.getContext('2d'), sky = g.createLinearGradient(0, 0, W, H);
    sky.addColorStop(0, '#102040'); sky.addColorStop(0.5, '#c08040'); sky.addColorStop(1, '#f0f0e0'); g.fillStyle = sky; g.fillRect(0, 0, W, H);
    ['#d02020', '#20a040', '#2040d0', '#e0d020'].forEach((col, i) => { g.fillStyle = col; g.fillRect((i + 0.3) * W / 5, H / 10, W / 8, W / 8); });
    const blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
    const store = await import('/lab/editor/app/store.js'), photo = await import('/lab/editor/app/session.js');
    await store.add([new File([blob], 'IMG_0031.jpg', { type: 'image/jpeg', lastModified: 1_700_000_000_000 })], () => {});
    await photo.open(store.photos()[0].id);
    for (let i = 0; i < 2400 && !photo.whole(); i++) await new Promise((res) => setTimeout(res, 50));
    if (!photo.whole()) throw new Error('the photo did not open');
  }, [W, H]);
  return { context, page, errors };
}

test('an export keeps the screen awake, and each file with metadata says how it was made', opts, async () => {
  const { context, page, errors } = await opened(1200, 800);
  const r = await page.evaluate(async () => {
    const save = await import('/lab/editor/app/save.js'), photo = await import('/lab/editor/app/session.js');
    // the screen's wake lock, as the page asks for it: when it is held and when it is let go
    const log = [];
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: async (kind) => { log.push(`request ${kind}`); return { release: async () => { log.push('release'); } }; } } });
    photo.setValues({ Exposure: 0.5, Contrast: 20 }, 'Exposure', 'Exposure'); await photo.draw();
    const base = { long: 99999, gps: false };
    const files = await save.save([{ ...base, fmt: 'JPEG', q: 100, meta: 'All', file: 'a.jpg' }, { ...base, fmt: 'PNG', q: 95, meta: 'Copyright only', file: 'a.png' },
      { ...base, fmt: 'TIFF 16', q: 95, meta: 'All', file: 'a.tif' }, { ...base, fmt: 'JPEG', q: 85, meta: 'None', file: 'b.jpg' }], () => { if (!log.includes('progress')) log.push('progress'); });
    const heads = await Promise.all(files.map(async (f) => [...new Uint8Array(await f.blob.slice(0, 8192).arrayBuffer())]));
    // the way the next export is made: the network stopped by the phone 23 hours ago is still off; 25 hours ago, back on
    const why = [];
    for (const hours of [23, 25]) { localStorage.setItem('th.editor.net', String(Date.now() - hours * 3600e3)); why.push(save.netWhy()); }
    save.bestAgain(); why.push(save.netWhy(), localStorage.getItem('th.editor.net'));
    return { log, heads, why };
  });
  assert.deepEqual(r.log, ['request screen', 'progress', 'release'], 'the screen held awake while it worked, and let go at the end');
  const notes = r.heads.map((h) => noteIn(new Uint8Array(h)));
  assert.equal(notes[3], '', 'metadata off: no note');
  for (const [k, q] of [[0, 100], [1, 95], [2, 95]]) {
    assert.ok(notes[k].length > 0 && notes[k].length < 1500, `file ${k}: ${notes[k].length} bytes`);
    const note = JSON.parse(notes[k]);
    assert.match(note.build, /^\d+\.\w+$/, 'the release: its build number and commit (config.js)');
    assert.deepEqual({ ...note, build: '' }, { th: 1, build: '', way: 'classic', values: { Exposure: 0.5, Contrast: 20 }, wb: 'As shot', profile: '', crop: false, masks: 0, spots: 0, q });
  }
  assert.ok(!notes.join('').includes('IMG_0031'), 'no file name');
  assert.deepEqual(r.why, ['off-stopped', 'on', 'on', null], 'a day, not a week; BEST AGAIN clears it');
  assert.deepEqual(errors, []);
  await context.close();
});

// this phone's past exports: the usual way 20 s a megapixel, the network 40 s
const past = [5, 6, 7].flatMap((mp) => [{ at: 1, kind: 'save', ms: 20_000 * mp, px: mp * 1e6, net: 0 }, { at: 1, kind: 'save', ms: 40_000 * mp, px: mp * 1e6, net: 1 }]);
const tell = (page) => page.evaluate(() => document.querySelector('#stage [data-tell="export"]')?.textContent.trim() ?? '');

test('the Export board says how long it should take, why it is not the best way, and how long is left', opts, async () => {
  const fresh = await opened(1500, 1000);
  await fresh.page.evaluate(() => document.dispatchEvent(new CustomEvent('editor:open', { detail: 'Export' })));
  await fresh.page.getByRole('button', { name: 'SAVE BOTH' }).waitFor();
  assert.equal(await tell(fresh.page), '', 'no past export: nothing is guessed');
  await fresh.context.close();

  const { context, page, errors } = await opened(1500, 1000, past);
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('editor:open', { detail: 'Export' })));
  await page.getByRole('button', { name: 'SAVE BOTH' }).waitFor();
  // both files at 1500 × 1000 (the Small one no larger than the photo): 3 MP at 20 s a megapixel
  await page.waitForFunction(() => /About 1 min, from this phone's past exports/.test(document.querySelector('#stage [data-tell="export"]')?.textContent ?? ''));
  // a RAF whose export by the network the phone cut off an hour ago: the standard method, said before saving
  await page.evaluate(async () => { localStorage.setItem('th.editor.net', String(Date.now() - 3600e3)); const photo = await import('/lab/editor/app/session.js'); photo.current().plain = false; photo.changed(); });
  await page.waitForFunction(() => /Best quality was stopped by the phone last time, so this export uses the standard method\. BEST AGAIN turns it back on\./.test(document.querySelector('#stage [data-tell="export"]')?.textContent ?? ''));
  assert.match(await tell(page), /About 1 min/, 'still the usual way\'s estimate');
  const again = page.getByRole('button', { name: 'Best quality again' });
  // 44 px of room for a finger, as Cancel has: the key answers 5 px above and below its 32 px
  const room = await again.evaluate((b) => { const r = b.getBoundingClientRect(), x = r.left + r.width / 2; return [r.height, r.width >= 44, [r.top - 5, r.bottom + 5].map((y) => b.contains(document.elementFromPoint(x, y)))]; });
  assert.deepEqual(room, [32, true, [true, true]]);
  await again.click();
  await page.waitForFunction(() => /About 2 min/.test(document.querySelector('#stage [data-tell="export"]')?.textContent ?? ''));
  assert.doesNotMatch(await tell(page), /stopped/, 'the network is on again, and its own estimate is said');
  assert.equal(await page.evaluate(() => localStorage.getItem('th.editor.net')), null);
  assert.equal(await again.count(), 0);
  // while it saves, the time left
  await page.evaluate(async () => { const photo = await import('/lab/editor/app/session.js'); photo.current().plain = true; photo.changed(); });
  await page.waitForFunction(() => /About 1 min/.test(document.querySelector('#stage [data-tell="export"]')?.textContent ?? ''));
  await page.getByRole('button', { name: 'SAVE BOTH' }).click();
  await page.waitForFunction(() => /^Saving · (\d+ min( \d+ s)?|\d+ s) left|^Saving · almost done/.test(document.querySelector('#stage [data-tell="export"]')?.textContent.trim() ?? ''), null, { polling: 50 });
  const during = await tell(page);
  await page.getByText(/Saved to Downloads/).waitFor({ timeout: 240_000 });
  assert.equal(await tell(page), '', 'done: the board says what was saved instead');
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('th.editor.timings')).filter((t) => t.kind === 'save').length);
  assert.equal(kept, past.length + 1, 'and this export is kept for the next estimate');
  console.log(`# while saving: "${during}"`);
  assert.deepEqual(errors, []);
  await context.close();
});

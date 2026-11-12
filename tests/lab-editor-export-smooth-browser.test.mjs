// An export in the new editor at /lab/editor/ keeps the page free (frontend/lab/engine/export.js, export-thread.js,
// export-worker.js): the page does the GPU's part and reads each band back; reducing, sharpening and writing the
// files happen on the export's own thread. The files are the same to the byte as when all of it is done on the
// page (the way kept for a phone where the thread cannot start). And an export can be given up: Cancel on the
// Export board leaves no file, no mark of an unfinished export, and the board ready to save again.
// The photos are JPEGs drawn by the test, on a software GPU; the files are the browser's real downloads.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { timing, until } from './fixtures/waits.mjs';

const opts = { skip: Boolean(process.env.SITE_URL) && 'local only (a software GPU)', timeout: 600_000 };
// EXPORT_ON_PAGE=1 makes the smoothness check below export the old way, all on the page, to show that it fails there.
const ON_PAGE = process.env.EXPORT_ON_PAGE === '1';
let server, browser, base;
before(async () => {
  if (opts.skip) return;
  server = await serve(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const exe = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
  browser = await chromium.launch({ ...exe, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader'] });
});
after(async () => { await browser?.close(); server?.close(); });

/** The editor with a photo of W × H drawn by the page (a sky, patches of colour, fine lines), open and its own pixels ready. */
async function opened(W, H) {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true, serviceWorkers: 'block', acceptDownloads: true });
  const page = await context.newPage(), errors = [], saved = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('download', (d) => saved.push(d));
  await page.goto(`${base}/lab/editor/?readback`, { waitUntil: 'load' });
  await page.waitForSelector('#stage header');
  await page.evaluate(async ([W, H]) => {
    const c = new OffscreenCanvas(W, H), g = c.getContext('2d'), sky = g.createLinearGradient(0, 0, W, H);
    sky.addColorStop(0, '#102040'); sky.addColorStop(0.5, '#c08040'); sky.addColorStop(1, '#f0f0e0'); g.fillStyle = sky; g.fillRect(0, 0, W, H);
    ['#d02020', '#20a040', '#2040d0', '#e0d020', '#808080', '#101010', '#f8f8f8'].forEach((col, i) => { g.fillStyle = col; g.fillRect((i + 0.3) * W / 8, H / 10, W / 10, W / 10); });
    g.strokeStyle = '#fff'; g.lineWidth = 1.5;
    for (let i = 0; i < 200; i++) { g.beginPath(); g.moveTo(i * W / 200, H / 2); g.lineTo(i * W / 200 + W / 10, H); g.stroke(); }
    const blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
    const store = await import('/lab/editor/app/store.js'), photo = await import('/lab/editor/app/session.js');
    await store.add([new File([blob], 'IMG_0007.jpg', { type: 'image/jpeg', lastModified: 1_700_000_000_000 })], () => {});
    await photo.open(store.photos()[0].id);
    for (let i = 0; i < 2400 && !photo.whole(); i++) await new Promise((res) => setTimeout(res, 50));
    if (!photo.whole()) throw new Error('the photo did not open');
  }, [W, H]);
  return { context, page, errors, saved };
}

test('the same export made on its own thread and on the page is the same to the byte', opts, async () => {
  const { context, page, errors } = await opened(1500, 1000);
  const r = await page.evaluate(async () => {
    const save = await import('/lab/editor/app/save.js');
    const base = { q: 90, meta: 'All', gps: false };
    const presets = [
      { ...base, fmt: 'JPEG', long: 1500, q: 95, file: 'a.jpg' }, { ...base, fmt: 'JPEG', long: 700, q: 85, sharpen: 'Screen', amt: 'Standard', file: 'a_small.jpg' },
      { ...base, fmt: 'PNG', long: 1100, sharpen: 'Print', amt: 'High', file: 'a.png' }, { ...base, fmt: 'TIFF 16', long: 640, file: 'a.tif' },
    ];
    const bytes = async (list) => Promise.all(list.map(async (f) => new Uint8Array(await f.blob.arrayBuffer())));
    const timing = () => JSON.parse(localStorage.getItem('th.editor.timings') || '[]').filter((t) => t.kind === 'save').at(-1);
    const off = await bytes(await save.save(presets, () => {})), offT = timing();
    const page = await bytes(await save.save(presets, () => {}, { worker: false })), pageT = timing();
    const again = await bytes(await save.save(presets, () => {})), againT = timing();
    const same = (a, b) => a.length === b.length && a.every((x, k) => x.length === b[k].length && x.every((v, i) => v === b[k][i]));
    return { sizes: off.map((b) => b.length), same: same(off, page), again: same(off, again), off: [offT.off, pageT.off, againT.off], heads: off.map((b) => [...b.subarray(0, 4)]) };
  });
  assert.deepEqual(r.off, [1, 0, 1], 'the first and last were made on the export\'s thread, the middle one on the page');
  assert.deepEqual(r.heads.map((h) => h.slice(0, 2)), [[0xff, 0xd8], [0xff, 0xd8], [0x89, 0x50], [0x49, 0x49]], 'two JPEGs, a PNG and a TIFF');
  assert.ok(r.sizes.every((n) => n > 1000), `files with pictures in them (${r.sizes})`);
  assert.equal(r.same, true, 'made on the export\'s thread, the files are the bytes made on the page');
  assert.equal(r.again, true, 'and the same again');
  assert.deepEqual(errors, []);
  await context.close();
});

// The longest the page may be held by one task while a large photo exports. Measured here (7728 × 1100, the width of
// the owner's 40 MP sensor; a full-size JPEG sharpened for print and a small one for a screen; 2026-11-12, this
// software GPU): on its own thread no task of the page's reached 50 ms (the browser reports none shorter) and the
// longest gap between frames was 17 ms (67 and 300 ms on busy runs, the software GPU's own); all on the page, the old way (EXPORT_ON_PAGE=1), a band
// held the page for 445 ms and the frames stopped for 417 ms. A machine twice as slow still sits on its own side.
const LONGEST = 250;
test('while a large photo exports, the page keeps drawing', opts, async () => {
  const { context, page, errors } = await opened(7728, 1100);
  const r = await page.evaluate(async (onPage) => {
    const save = await import('/lab/editor/app/save.js');
    const presets = [{ fmt: 'JPEG', long: 7728, q: 95, meta: 'All', gps: false, sharpen: 'Print', amt: 'High', file: 'big.jpg' }, { fmt: 'JPEG', long: 2048, q: 85, meta: 'All', gps: false, sharpen: 'Screen', amt: 'Standard', file: 'big_small.jpg' }];
    // every frame the page draws while the export runs, and the gaps between them; and the browser's own long tasks
    const gaps = [], long = [], began = performance.now();
    let on = true, last = began;
    const tick = (t) => { if (!on) return; gaps.push(t - last); last = t; requestAnimationFrame(tick); };
    const seen = new PerformanceObserver((l) => { for (const e of l.getEntries()) long.push(e.duration); });
    seen.observe({ type: 'longtask' });
    requestAnimationFrame((t) => { last = t; requestAnimationFrame(tick); });
    const files = await save.save(presets, () => {}, onPage ? { worker: false } : {});
    on = false; seen.disconnect();
    const t = JSON.parse(localStorage.getItem('th.editor.timings') || '[]').filter((x) => x.kind === 'save').at(-1);
    return { ms: performance.now() - began, files: files.map((f) => f.width), frames: gaps.length, gap: Math.max(...gaps), long: Math.max(0, ...long), longs: long.length, off: t.off, write: t.write };
  }, ON_PAGE);
  console.log(`# a 7728-wide export ${ON_PAGE ? 'all on the page' : 'on its own thread'}: ${Math.round(r.ms)} ms, ${r.frames} frames, the longest gap between them ${Math.round(r.gap)} ms; ${r.longs} long tasks, the longest ${Math.round(r.long)} ms; ${r.write} ms of writing`);
  assert.deepEqual(r.files, [7728, 2048]);
  assert.equal(r.off, ON_PAGE ? 0 : 1, 'where the writing was done');
  assert.ok(r.long < LONGEST, `no task held the page for ${LONGEST} ms or more (the longest: ${Math.round(r.long)} ms)`);
  // A gap between frames also measures the software GPU, which draws the frames on the same processors as the export
  // (300 ms seen on a busy machine with no long task at all), so it is told, and enforced only with TH_STRICT_TIMING=1.
  timing(r.gap < LONGEST, `the frames never stopped for ${LONGEST} ms or more (the longest gap: ${Math.round(r.gap)} ms)`);
  assert.deepEqual(errors, []);
  await context.close();
});

// An export the network was making, given up: not taken for the network failing (app/save.js leaves the network
// alone for a week after that). Needs the CC0 X-E5 sample (tests/photos-engine.test.mjs fetches it); skipped without it.
const RAF = join(tmpdir(), 'th-photos-engine-sample', 'xe5-8509.raf');
// It opens a forty-megapixel photo and develops its first band by the network on a software GPU: about six minutes, more
// than a part of CI may take, so it runs only when asked for (TH_LONG=1), never by chance of the sample being there.
test('a cancelled export by the network leaves the network on', { ...opts, skip: opts.skip || (!process.env.TH_LONG && 'a long test: TH_LONG=1 runs it') || (!existsSync(RAF) && 'the sample RAF is not here'), timeout: 900_000 }, async () => {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true, serviceWorkers: 'block', acceptDownloads: true });
  const page = await context.newPage(), errors = [], saved = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('download', (d) => saved.push(d));
  await page.goto(`${base}/lab/editor/?readback`, { waitUntil: 'load' });
  await page.waitForSelector('#stage header');
  const r = await page.evaluate(async (b64) => {
    const bin = atob(b64), a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    const store = await import('/lab/editor/app/store.js'), photo = await import('/lab/editor/app/session.js'), save = await import('/lab/editor/app/save.js');
    await store.add([new File([a], 'DSCF8509.RAF')], () => {});
    await photo.open(store.photos()[0].id);
    for (let i = 0; i < 3000 && !photo.whole(); i++) await new Promise((res) => setTimeout(res, 100));
    // the network can make this photo here (full.js `view`'s `net`), so an export of it is the network's
    const v = await photo.whole().view(64, 64, null, false, true, true), net = v.net; v.dispose();
    const stop = new AbortController();
    let heard = 0, err = null;
    // given up once its first band is done: the network is at work by then
    await save.save([{ fmt: 'JPEG', long: 99999, q: 90, meta: 'None', gps: false, file: 'DSCF8509.jpg' }], () => { heard++; stop.abort(); }, { signal: stop.signal }).catch((e) => { err = e; });
    return { net, heard, name: err?.name, cancelled: save.cancelled(err), mark: localStorage.getItem('th.editor.export'), off: localStorage.getItem('th.editor.net'), cut: save.cutOff(), saves: JSON.parse(localStorage.getItem('th.editor.timings') || '[]').filter((t) => t.kind === 'save').length };
  }, readFileSync(RAF).toString('base64'));
  assert.equal(r.net, true, 'the network makes this photo on this GPU');
  assert.deepEqual([r.heard, r.name, r.cancelled], [1, 'AbortError', true], 'given up after its first band, and told apart from a failure');
  assert.deepEqual([r.mark, r.off, r.cut, r.saves], [null, null, null, 0], 'no mark, the network not left alone, nothing cut off, no export kept in the timings');
  await new Promise((res) => setTimeout(res, 1000));
  assert.equal(saved.length, 0, 'nothing downloaded');
  assert.deepEqual(errors, []);
  await context.close();
});

test('Cancel gives an export up: no file, no mark, and the board saves again', opts, async () => {
  const { context, page, errors, saved } = await opened(2400, 1600);
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('editor:open', { detail: 'Export' })));
  await page.getByRole('button', { name: 'SAVE BOTH' }).click();
  // under way: a band or more done, the mark of an unfinished export kept
  await page.waitForFunction(() => /SAVING · [1-9]/.test(document.querySelector('#stage header')?.textContent ?? ''), null, { timeout: 120_000, polling: 50 });
  assert.notEqual(await page.evaluate(() => localStorage.getItem('th.editor.export')), null);
  const stop = page.getByRole('button', { name: 'Cancel the export' });
  // 44 px of room for a finger: the key answers 5 px above and below its 32 px
  const room = await stop.evaluate((b) => { const r = b.getBoundingClientRect(), x = r.left + r.width / 2; return [r.height, r.width >= 44, [r.top - 5, r.bottom + 5].map((y) => b.contains(document.elementFromPoint(x, y)))]; });
  assert.deepEqual(room, [32, true, [true, true]]);
  await stop.click();
  await page.getByText('Export cancelled').waitFor({ timeout: 60_000 });
  const after = await page.evaluate(() => ({ mark: localStorage.getItem('th.editor.export'), net: localStorage.getItem('th.editor.net'), head: document.querySelector('#stage header').textContent }));
  assert.deepEqual([after.mark, after.net], [null, null], 'no mark of an unfinished export, and the network not blamed');
  assert.match(after.head, /SAVE BOTH/);
  assert.doesNotMatch(after.head, /CANCEL/);
  // ready again: the next export makes both files, and they are the only downloads there are
  await page.getByRole('button', { name: 'SAVE BOTH' }).click();
  await page.getByText(/Saved to Downloads/).waitFor({ timeout: 240_000 });
  await until(() => saved.length >= 2, { message: 'the two downloads reached the test' });
  await new Promise((r) => setTimeout(r, 1000));   // anything late from the cancelled export would show by now
  assert.deepEqual(saved.map((d) => d.suggestedFilename()).sort(), ['IMG_0007.jpg', 'IMG_0007_small.jpg']);
  assert.equal(await page.evaluate(() => localStorage.getItem('th.editor.export')), null);
  assert.deepEqual(errors, []);
  await context.close();
});


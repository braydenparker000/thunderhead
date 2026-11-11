// What the camera wrote of each shot, and a series matched by it, in the new editor at /lab/editor/
// (frontend/lab/engine/exif.js `shot`, app/store.js, app/clip.js `matchOn`; engine/raw/ROADMAP.md stages 4 and 5).
// A photo's record keeps when it was taken by the camera's own clock, the camera, the lens and how it was shot;
// the line under its name says so. "Match the photos shown to the open one" then gives each the open photo's
// white balance and moves its Exposure by the stops between how the two were shot. The photos are JPEGs drawn by
// the test, each given an invented Exif block written with the engine's own writer.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

const opts = { skip: Boolean(process.env.SITE_URL) && 'local only (a software GPU)', timeout: 240_000 };
let server, browser, base;
before(async () => {
  if (opts.skip) return;
  server = await serve(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const exe = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
  browser = await chromium.launch({ ...exe, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader'] });
});
after(async () => { await browser?.close(); server?.close(); });

test('a photo keeps how it was shot, and a series is matched to the open photo by it', opts, async () => {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true, serviceWorkers: 'block' });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/lab/editor/?readback`, { waitUntil: 'load' });
  await page.waitForSelector('#stage header');
  // Four frames of one scene: the first as metered, one two stops under, one two stops over, one with no Exif at all.
  const files = await page.evaluate(async () => {
    const { block } = await import('/lab/engine/exif.js');
    const ascii = (tag, s) => ({ tag, type: 2, count: s.length + 1, data: Uint8Array.from([...s].map((c) => c.charCodeAt(0)).concat(0)) });
    const ratio = (tag, n, d) => ({ tag, type: 5, count: 1, data: new Uint8Array(Uint32Array.of(n, d).buffer) });
    const short = (tag, v) => ({ tag, type: 3, count: 1, data: new Uint8Array(Uint16Array.of(v).buffer) });
    const make = async (name, ink, exif) => {
      const c = new OffscreenCanvas(300, 240), g = c.getContext('2d'); g.fillStyle = ink; g.fillRect(0, 0, 300, 240); g.fillStyle = '#999'; g.fillRect(60, 60, 120, 90);
      const jpeg = new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 })).arrayBuffer());
      if (!exif) return { name, bytes: [...jpeg] };
      const tiff = block([ascii(0x010f, 'Made-up'), ascii(0x0110, 'Known'), { tag: 0x8769, type: 4, count: 1, data: new Uint8Array(4),
        sub: [ratio(0x829a, 1, exif.over), ratio(0x829d, 40, 10), short(0x8827, exif.iso), ascii(0x9003, exif.at), ratio(0x920a, 35, 1), ascii(0xa434, 'Known 35mm F2')] }]);
      const len = 2 + 6 + tiff.length;
      return { name, bytes: [0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 255, 0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff, ...jpeg.subarray(2)] };
    };
    return Promise.all([make('R.jpg', '#777', { over: 100, iso: 200, at: '2026:03:14 10:00:00' }), make('Under.jpg', '#333', { over: 400, iso: 200, at: '2026:03:14 10:00:05' }),
      make('Over.jpg', '#ccc', { over: 100, iso: 800, at: '2026:03:14 10:00:09' }), make('Bare.jpg', '#777', null)]);
  });
  await page.getByRole('button', { name: 'Import' }).click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByText('Choose photos').click()]);
  await chooser.setFiles(files.map((f) => ({ name: f.name, mimeType: 'image/jpeg', buffer: Buffer.from(f.bytes) })));
  await page.waitForFunction(() => /Done · \d/.test(document.querySelector('#stage')?.textContent ?? ''));
  assert.match(await page.textContent('#stage'), /Done · 4 photos copied/);
  const kept = await page.evaluate(async () => {
    const store = await import('/lab/editor/app/store.js'), photo = await import('/lab/editor/app/session.js');
    const by = (name) => store.photos().find((p) => p.name === name), r = by('R.jpg');
    await photo.open(r.id);
    photo.setValues({ Exposure: 0.5, Temp: 7000 }, 'Exposure', 'Exposure'); photo.custom(); await photo.draw(); await photo.saveNow();
    return { shot: r.shot, taken: [new Date(r.taken).getFullYear(), new Date(r.taken).getMonth(), new Date(r.taken).getHours()], stamped: r.stamp !== r.taken, bare: [by('Bare.jpg').shot, by('Bare.jpg').taken === by('Bare.jpg').stamp],
      line: photo.kindLine(), bareLine: photo.shotLine(by('Bare.jpg').shot), slow: photo.shotLine({ camera: '', lens: '', iso: 100, time: 2.5, f: 11, mm: 23.4 }), wb: photo.current().wb };
  });
  assert.deepEqual(kept.shot, { camera: 'Made-up Known', lens: 'Known 35mm F2', iso: 200, time: 0.01, f: 4, mm: 35 });
  assert.deepEqual([kept.taken, kept.stamped], [[2026, 2, 10], true], "its place in the Library is by the camera's clock; the file's own time is kept beside it");
  assert.deepEqual(kept.bare, [{ camera: '', lens: '', iso: 0, time: 0, f: 0, mm: 0 }, true], "with no Exif, the file's time stands");
  assert.deepEqual([kept.line, kept.bareLine, kept.slow], ['JPEG · 35 mm · f/4 · 1/100 · ISO 200', '', '23 mm · f/11 · 2.5 s · ISO 100']);
  assert.equal(kept.wb, 'Custom');
  // The sheet offers the match because a photo is open; a second tap runs it on the four shown.
  await page.getByText('Match the photos shown to the open one').click();
  await page.getByText('Match 4 photos? Tap again').click();
  await page.waitForFunction(() => /Done · matched 2 photos · 1 white balance only/.test(document.querySelector('#stage')?.textContent ?? ''), null, { timeout: 120_000 });
  const after = await page.evaluate(async () => {
    const store = await import('/lab/editor/app/store.js'), photo = await import('/lab/editor/app/session.js'), edits = await store.edits();
    return { open: photo.current()?.name, ...Object.fromEntries(['R.jpg', 'Under.jpg', 'Over.jpg', 'Bare.jpg'].map((name) => { const e = edits.get(store.photos().find((p) => p.name === name).id); return [name, [e.Exposure, e.Temp, e.wb, e.steps.at(-1).name]]; })) };
  });
  assert.equal(after.open, 'R.jpg', 'the open photo is open again');
  assert.deepEqual(after['R.jpg'], [0.5, 7000, 'Custom', 'Exposure'], 'and is as it was');
  assert.deepEqual(after['Under.jpg'], [2.5, 7000, 'Custom', 'Matched · R'], 'two stops less light: two stops more Exposure');
  assert.deepEqual(after['Over.jpg'], [-1.5, 7000, 'Custom', 'Matched · R'], 'two stops more gain: two stops less');
  assert.deepEqual(after['Bare.jpg'], [0, 7000, 'Custom', 'Matched · R'], 'no shooting data: the white balance alone');
  assert.deepEqual(errors, []);
  await context.close();
});

// A JPEG in the new editor at /lab/editor/ (frontend/lab/engine/picture.js; engine/raw/ROADMAP.md stage 5). A JPEG
// is a finished picture, not sensor data: it must come through the whole engine unchanged until something is
// moved, then edit, retouch and export as a RAF does. A JPEG can be made up where a RAF cannot, so this is also the
// one test that takes a photo through the real editor end to end on a GPU: the Library's store, the session, the
// fitted frame, the full-size view and an export. The picture here is drawn by the test.
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

test('a JPEG opens as it is, then edits, retouches and exports like any photo', opts, async () => {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true, serviceWorkers: 'block', acceptDownloads: true });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/lab/editor/?readback`, { waitUntil: 'load' });
  await page.waitForSelector('#stage header');
  const r = await page.evaluate(async () => {
    const W = 996, H = 660, c = new OffscreenCanvas(W, H), g = c.getContext('2d');
    const sky = g.createLinearGradient(0, 0, W, H);
    sky.addColorStop(0, '#102040'); sky.addColorStop(0.5, '#c08040'); sky.addColorStop(1, '#f0f0e0'); g.fillStyle = sky; g.fillRect(0, 0, W, H);
    ['#d02020', '#20a040', '#2040d0', '#e0d020', '#808080', '#101010', '#f8f8f8'].forEach((col, i) => { g.fillStyle = col; g.fillRect(40 + i * 130, 60, 100, 100); });
    g.strokeStyle = '#fff'; g.lineWidth = 1.5;
    for (let i = 0; i < 40; i++) { g.beginPath(); g.moveTo(40 + i * 9, 300); g.lineTo(140 + i * 9, 600); g.stroke(); }
    const blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.95 });
    // what the file holds once decoded: the truth every check compares with
    const bm = await createImageBitmap(blob), t = new OffscreenCanvas(W, H).getContext('2d'); t.drawImage(bm, 0, 0);
    const truth = t.getImageData(0, 0, W, H).data, at = (x, y) => [...truth.subarray((y * W + x) * 4, (y * W + x) * 4 + 3)];
    /** Mean and largest difference, in levels of 255, between a result and the truth's rectangle at (X, Y). */
    const off = (px, w, h, X, Y) => { let s = 0, m = 0; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let k = 0; k < 3; k++) { const d = Math.abs(px[(y * w + x) * 4 + k] - truth[((Y + y) * W + X + x) * 4 + k]); s += d; m = Math.max(m, d); } return { mean: s / (w * h * 3), most: m }; };
    const store = await import('/lab/editor/app/store.js'), photo = await import('/lab/editor/app/session.js'), save = await import('/lab/editor/app/save.js');
    const added = await store.add([new File([blob], 'IMG_0042.jpg', { type: 'image/jpeg', lastModified: 1_700_000_000_000 }), new File(['not a picture'], 'broken.jpg', { type: 'image/jpeg' })], () => {});
    const p = store.photos()[0];
    await photo.open(p.id);
    for (let i = 0; i < 400 && !photo.whole(); i++) await new Promise((res) => setTimeout(res, 50));
    const big = photo.whole(), out = { added, kind: p.kind, tile: store.urlNow(p.id).startsWith('blob:'), status: photo.current().status, line: photo.kindLine(), stem: photo.stem(p.name), looks: photo.looks().length,
      starts: [photo.value('Sharpening'), photo.value('Noise'), photo.value('Color noise'), photo.edited('Sharpening')], size: [big?.width, big?.height], shape: photo.shape(), history: photo.history().steps.map((s) => `${s.name} ${s.val}`) };
    // the fitted photo: the picture a third of its size
    const fit = await photo.pixels(), lin = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }, enc = (v) => 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
    let fs = 0, fm = 0;
    for (let y = 0; y < fit.height; y++) for (let x = 0; x < fit.width; x++) for (let k = 0; k < 3; k++) {
      let s = 0; for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) s += lin(truth[((y * 3 + j) * W + x * 3 + i) * 4 + k]);   // the mean of 3 × 3 in linear light
      const d = Math.abs(enc(s / 9) - fit.data[(y * fit.width + x) * 4 + k]); fs += d; fm = Math.max(fm, d);
    }
    out.fit = { w: fit.width, h: fit.height, mean: fs / (fit.width * fit.height * 3), most: fm };
    // its own pixels, as 100 % shows them
    const v = await big.view(600, 400, null, true), shot = async () => { let im; await photo.alone(async () => { await photo.settle(); await v.region(100, 40, 600, 400); im = await v.read(); }); return im; };
    const plain = await shot(); out.view = { w: plain.width, h: plain.height, ...off(plain.data, plain.width, plain.height, 100, 40) };
    // an export at full size, with nothing moved
    const [file] = await save.save([{ fmt: 'PNG', long: 99999, q: 0.9, meta: 'None', gps: false, file: 'IMG_0042.png' }], () => {});
    const ex = await createImageBitmap(file.blob), e2 = new OffscreenCanvas(ex.width, ex.height).getContext('2d'); e2.drawImage(ex, 0, 0);
    out.export = { w: ex.width, h: ex.height, ...off(e2.getImageData(0, 0, ex.width, ex.height).data, ex.width, ex.height, 0, 0) };
    const whole = e2.getImageData(0, 0, ex.width, ex.height).data;
    out.patches = [[90, 110], [220, 110], [350, 110], [480, 110], [610, 110], [740, 110], [870, 110], [20, 20], [500, 330], [980, 640], [300, 450]].map(([x, y]) => [at(x, y), [...whole.subarray((y * W + x) * 4, (y * W + x) * 4 + 3)]]);
    // an edit moves it; a reset of Sharpening goes back to a JPEG's own start, not a RAF's
    const mean = (im) => { let s = 0; for (let i = 0; i < im.data.length; i += 4) s += im.data[i + 1]; return s / (im.data.length / 4); };
    photo.setValues({ Exposure: 1, Sharpening: 60 }, 'Exposure', 'Exposure'); await photo.draw();
    const lit = await shot(); out.lit = [mean(plain), mean(lit)];
    photo.resetAll(['Exposure', 'Sharpening'], 'Reset'); await photo.draw();
    out.back = [photo.value('Exposure'), photo.value('Sharpening')];
    // retouching: a Clone spot on the plain ground takes the red patch's pixels (420 to the left, 120 up)
    photo.current().spots = [{ x: 510 / W, y: 230 / W, r: 12 / W, sx: 90 / W, sy: 110 / W, tool: 'Clone', feather: 0, opacity: 1 }]; await photo.draw();
    const healed = await shot(), px = (im, x, y) => [...im.data.subarray(((y - 40) * im.width + x - 100) * 4, ((y - 40) * im.width + x - 100) * 4 + 3)];
    out.spot = { was: px(plain, 510, 230), now: px(healed, 510, 230), source: at(90, 110), beside: [px(plain, 540, 230), px(healed, 540, 230)] };
    v.dispose();
    out.timings = JSON.parse(localStorage.getItem('th.editor.timings') || '[]');
    return out;
  });
  assert.deepEqual(r.added, { added: 1, had: 0, bad: 1 }, 'the JPEG is kept; a file that is no picture is counted, not kept');
  assert.equal(r.kind, 'jpeg');
  assert.equal(r.tile, true, 'its tile is a small copy of it');
  assert.equal(r.status, '');
  assert.deepEqual([r.line, r.stem, r.looks], ['JPEG', 'IMG_0042', 0], 'named as a JPEG, with no camera profiles offered');
  assert.deepEqual(r.starts, [0, 0, 0, false], 'no sharpening or noise reduction to start with: the camera did both');
  assert.deepEqual(r.history, ['Imported JPEG']);
  assert.deepEqual([r.size, r.shape], [[996, 660], [996, 660]]);
  assert.deepEqual([r.fit.w, r.fit.h], [332, 220]);
  assert.ok(r.fit.mean < 0.5 && r.fit.most < 2, `the fitted photo is the picture a third of its size (off by ${r.fit.mean} levels on average, ${r.fit.most} at most)`);
  assert.deepEqual([r.view.w, r.view.h], [600, 400]);
  assert.ok(r.view.mean < 0.5 && r.view.most <= 1, `at 100 % each pixel is the file's own, but for the last step's dither (off by ${r.view.mean} on average, ${r.view.most} at most)`);
  assert.deepEqual([r.export.w, r.export.h], [996, 660]);
  assert.ok(r.export.mean < 0.1 && r.export.most <= 1, `an export with nothing moved is the picture (off by ${r.export.mean} on average, ${r.export.most} at most)`);
  // strong colours too, which sit at the edge of what a screen shows: a table read between its points moved a deep blue by 28 levels
  for (const [was, now] of r.patches) assert.ok(was.every((v, k) => Math.abs(v - now[k]) <= 1), `a patch of ${was} came out ${now}`);
  assert.ok(r.lit[1] > r.lit[0] + 25, 'a stop of Exposure brightens it');
  assert.deepEqual(r.back, [0, 0]);
  for (let k = 0; k < 3; k++) {
    assert.ok(Math.abs(r.spot.now[k] - r.spot.source[k]) <= 3, `the spot shows its source (${r.spot.now} against ${r.spot.source})`);
    assert.ok(Math.abs(r.spot.beside[0][k] - r.spot.beside[1][k]) <= 1, 'and nothing beside it moved');
  }
  assert.ok(Math.abs(r.spot.was[0] - r.spot.now[0]) > 20, 'which is not what was there');
  // how long it took is kept as numbers for the owner's storage (app/timings.js): never the photo's name
  const kinds = r.timings.map((t) => t.kind);
  assert.deepEqual([kinds.includes('open'), kinds.includes('full'), kinds.includes('save')], [true, true, true], `timings kept: ${kinds}`);
  const opened = r.timings.find((t) => t.kind === 'open'), kept = r.timings.find((t) => t.kind === 'save');
  assert.deepEqual([opened.file, opened.px, opened.ms > 0, kept.files, kept.px, kept.kinds], ['jpeg', 996 * 660, true, 1, 996 * 660, 'PNG']);
  assert.ok(!JSON.stringify(r.timings).includes('IMG_0042'), 'no name among them');
  // an export says where its time went: developing, reading back, writing, and its first pieces a step at a time
  for (const k of ['gpu', 'read', 'write', 'demosaic', 'sharpen', 'warp', 'colour']) assert.ok(Number.isFinite(kept[k]) && kept[k] >= 0, `the export's ${k} time is kept (${kept[k]})`);
  assert.ok(kept.gpu > 0 && kept.colour > 0);
  assert.deepEqual(errors, []);
  await context.close();
});

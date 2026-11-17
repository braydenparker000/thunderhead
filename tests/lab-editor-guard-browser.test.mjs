// The editor kept safe on a small phone (2026-11-16, after a photo opened over and over on the owner's Galaxy A35): a
// photo whose graphics chip resets opens once more, light, and a second reset is only said (app/session.js); the GPU
// memory the editor holds is counted, heavy work that would not fit under the phone's budget is left, and an
// out-of-memory error lowers the budget for good (engine/gpu-memory.js); work that can wait waits for the frames and the
// fingers (engine/work.js); the better copy made for a photo is kept and taken on its next open (app/copy-kept.js); and
// the zoom's tiles made once are laid again from what is kept (app/zoom-tiles.js). Photos drawn by the test; a software GPU.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { until } from './fixtures/waits.mjs';

const opts = { skip: Boolean(process.env.SITE_URL) && 'local only (a software GPU)', timeout: 300_000 };
let server, browser, base;
before(async () => {
  if (opts.skip) return;
  server = await serve(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const exe = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
  browser = await chromium.launch({ ...exe, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader'] });
});
after(async () => { await browser?.close(); server?.close(); });

/** The editor with two made-up JPEGs, the first open. */
const editor = async (more = '') => {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true, serviceWorkers: 'block' });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/lab/editor/?readback${more}`, { waitUntil: 'load' });
  await page.waitForSelector('#stage header');
  await page.evaluate(async () => {
    const mk = async (name, hue) => { const c = new OffscreenCanvas(900, 600), g = c.getContext('2d'); for (let y = 0; y < 600; y += 6) for (let x = 0; x < 900; x += 6) { g.fillStyle = `hsl(${(hue + x / 5) % 360} 40% ${30 + ((x ^ y) & 12) * 3}%)`; g.fillRect(x, y, 6, 6); } return new File([await c.convertToBlob({ type: 'image/jpeg', quality: 0.92 })], name, { type: 'image/jpeg', lastModified: 1_700_000_000_000 + hue }); };
    const store = await import('/lab/editor/app/store.js'), p = await import('/lab/editor/app/session.js');
    await store.add([await mk('IMG_0081.jpg', 10), await mk('IMG_0082.jpg', 200)], () => {});
    await p.open(store.photos()[0].id); document.dispatchEvent(new CustomEvent('editor:open', { detail: 'Edit' }));
  });
  await until(() => page.evaluate(async () => { const p = await import('/lab/editor/app/session.js'); return p.ready && !!p.whole() && !p.busy(); }), { timeout: 120_000, message: 'the photo opens' });
  return { context, page, errors };
};
const kinds = (page, kind) => page.evaluate(async (k) => (await import('/lab/editor/app/timings.js')).kept().filter((x) => x.kind === k), kind);

test('a reset blames what was being made and opens the photo again with nothing left off; one soon after waits out the while; past three it is only said', opts, async () => {
  const { context, page, errors } = await editor('&calm=10000');   // (a while longer than the photo takes to open again here)
  const opens = async () => (await kinds(page, 'open')).length, was = await opens();
  // the chip resets while the copy is made again: it is blamed, and the photo opens again at once
  await page.evaluate(async () => { const w = await import('/lab/engine/work.js'); window.__done = w.doing('Building a sharper copy'); dispatchEvent(new Event('th-gpu-lost')); window.__done(); });
  await until(async () => (await opens()) === was + 1, { timeout: 120_000, message: 'opened again at once' });
  const first = await page.evaluate(async () => { const g = await import('/lab/engine/gentle.js'), p = await import('/lab/editor/app/session.js'); return { copy: g.level('copy'), share: g.share('copy'), status: p.current().status, light: 'light' in p }; });
  assert.deepEqual(first, { copy: 1, share: 0.5, status: '', light: false }, 'the copy goes gentler on this phone; nothing is left off and no lighter mode is said');
  // another within the while: said, and the photo opens again once the while is over
  await page.evaluate(() => dispatchEvent(new Event('th-gpu-lost')));
  await until(() => page.evaluate(async () => /opens again in \d+ s/.test((await import('/lab/editor/app/session.js')).current().status)), { message: 'the wait is said' });
  assert.equal(await opens(), was + 1, 'not at once');
  await until(async () => (await opens()) === was + 2, { timeout: 120_000, message: 'opened again once the while was over' });
  // a third opens again at once; a fourth is only said
  await until(() => page.evaluate(async () => (await import('/lab/editor/app/session.js')).ready));
  await page.evaluate(() => dispatchEvent(new Event('th-gpu-lost')));
  await until(async () => (await opens()) === was + 3, { timeout: 120_000, message: 'a third time' });
  await until(() => page.evaluate(async () => (await import('/lab/editor/app/session.js')).ready));
  await page.evaluate(() => dispatchEvent(new Event('th-gpu-lost')));
  await until(() => page.evaluate(async () => /keeps resetting/.test((await import('/lab/editor/app/session.js')).current().status)), { message: 'the fourth is said' });
  await page.waitForTimeout(2000);
  assert.equal(await opens(), was + 3, 'and the photo is not opened a fourth time on its own');
  const lost = await kinds(page, 'lost');
  assert.equal(lost[0].job, 'copy', 'what the first blamed');
  assert.deepEqual(lost.map((x) => [x.again, x.calm > 0]), [[1, false], [1, true], [1, false], [0, true]], 'each reset is in the timings: whether the photo opened again, whether it came within the while after the one before');
  assert.ok(lost.every((x) => x.since >= 0 && x.budgetMb > 0), 'with when and the memory');
  assert.deepEqual(errors, []);
  await context.close();
});

test('a job blamed for a reset hands the GPU half the pieces, grows back after three made whole, and the while after a reset is kept', opts, async () => {
  const page = await browser.newPage({ serviceWorkers: 'block' });
  await page.goto(`${base}/lab/editor/?readback&calm=400`, { waitUntil: 'load' });
  const r = await page.evaluate(async () => {
    const g = await import('/lab/engine/gentle.js'), out = { levels: [] };
    out.at0 = g.calmIn(); g.blame('starfish'); out.calm = g.calmIn() > 0; g.blame('starfish'); out.levels.push(g.level('starfish'), g.share('starfish'));
    for (let i = 0; i < 3; i++) g.went('starfish'); out.levels.push(g.level('starfish'));
    for (let i = 0; i < 9; i++) g.blame('copy'); out.most = g.level('copy');
    out.jobs = ['Building a sharper copy', 'Preparing Starfish', 'Loading Starfish', 'Loading full detail', ''].map(g.jobOf);
    await g.calm(); out.after = g.calmIn();
    out.kept = JSON.parse(localStorage.getItem('th.editor.gentle')).jobs.starfish.level;
    return out;
  });
  await page.close();
  assert.equal(r.at0, 0, 'no while without a reset');
  assert.equal(r.calm, true, 'a reset begins one');
  assert.deepEqual(r.levels, [2, 0.25, 1], 'two resets: a quarter; three made whole: a step back');
  assert.equal(r.most, 4, 'never past a sixteenth');
  assert.deepEqual(r.jobs, ['copy', 'prep', 'starfish', 'detail', 'none']);
  assert.equal(r.after, 0, 'the while ends');
  assert.equal(r.kept, 1, 'kept on the phone');
});

test('GPU memory is counted against the phone\'s budget: the copy made again is left where it would not fit, and running out lowers the budget for good', opts, async () => {
  const run = (budget) => browser.newPage({ serviceWorkers: 'block' }).then(async (page) => {
    await page.goto(`${base}/lab/engine/?readback${budget ? `&budget=${budget}` : ''}`, { waitUntil: 'load' });
    await page.waitForSelector('html[data-bench=ready]');
    const r = await page.evaluate(async () => {
      const { known } = await import('/lab/engine/known.js'), { engine } = await import('/lab/engine/gpu.js'), { full } = await import('/lab/engine/full.js'), { memory } = await import('/lab/engine/gpu-memory.js');
      const k = known(720), eng = await engine(document.createElement('canvas'), k, true), quick = k.proxy.slice(), big = await full(eng, k, k.mosaic.slice());
      const out = { made: k.proxy.some((v, i) => v !== quick[i]), used: memory.used, peak: memory.peak, budget: memory.budget };
      // the GPU says it ran out: the budget comes down, and stays down on this phone
      eng.gpu.device.dispatchEvent(new GPUUncapturedErrorEvent('uncapturederror', { error: new GPUOutOfMemoryError('a test') }));
      Object.assign(out, { after: memory.budget, kept: Number(localStorage.getItem('th.editor.gpuBudget')), oom: memory.oom });
      big?.dispose(); eng.dispose(); localStorage.removeItem('th.editor.gpuBudget');
      return out;
    });
    await page.close();
    return r;
  });
  const roomy = await run(0), tight = await run(20);
  assert.equal(roomy.made, true, 'with room, the copy is made again');
  assert.ok(roomy.used > 1 << 20 && roomy.peak >= roomy.used, `what is held is counted (${roomy.used} bytes, ${roomy.peak} at most)`);
  assert.equal(tight.made, false, 'with 20 MB to spare, it is left: the decoder\'s copy stays');
  assert.ok(tight.peak < 20 * 2 ** 20, `and the editor stayed under the budget (${(tight.peak / 2 ** 20).toFixed(1)} MB)`);
  assert.ok(roomy.after < roomy.budget && roomy.kept === roomy.after && roomy.oom === 1, `running out lowered the budget (${roomy.budget} → ${roomy.after}) and kept it`);
});

test('the copy made again goes in smaller tiles on a phone whose chip reset making it, and a while after a reset it is made later, the session told', opts, async () => {
  const page = await browser.newPage({ serviceWorkers: 'block' });
  await page.goto(`${base}/lab/engine/?readback&calm=1500`, { waitUntil: 'load' });
  await page.waitForSelector('html[data-bench=ready]');
  const r = await page.evaluate(async () => {
    const { known } = await import('/lab/engine/known.js'), { engine } = await import('/lab/engine/gpu.js'), { full } = await import('/lab/engine/full.js'), g = await import('/lab/engine/gentle.js');
    const tiles = () => performance.getEntriesByName('th:copy', 'mark').length, k = known(720), eng = await engine(document.createElement('canvas'), k, true);
    const made = async () => { delete k.meta.copyMade; const n = tiles(), big = await full(eng, k, k.mosaic.slice()); return { big, tiles: tiles() - n, at: !!k.meta.copyMade }; };
    const a = await made(); a.big?.dispose();
    localStorage.setItem('th.editor.gentle', JSON.stringify({ last: 0, jobs: { copy: { level: 2, ok: 0 } } }));   // two resets blamed on it, long ago
    const b = await made(); b.big?.dispose();
    g.blame('none');   // a reset just now: the copy waits out the while, and the session hears of it then
    let told = -1; k.meta.onCopy = (/** @type {Uint16Array} */ c) => { told = c.length; };
    const c = await made();
    for (let i = 0; i < 200 && told < 0; i++) await new Promise((res) => setTimeout(res, 50));
    c.big?.dispose(); eng.dispose(); localStorage.removeItem('th.editor.gentle');
    return { usual: a.tiles, gentle: b.tiles, made: [a.at, b.at, c.at], told: told === k.proxy.length };
  });
  await page.close();
  assert.ok(r.usual >= 1 && r.gentle >= 4 * r.usual, `a quarter of the tile's side: many more, smaller tiles (${r.usual} → ${r.gentle})`);
  assert.deepEqual(r.made, [true, true, false], 'made as the photo opens, but not in the while after a reset');
  assert.equal(r.told, true, 'made once the while was over, and the session told');
});

test('work that can wait waits for the frames and the fingers; the badge names the most pressing thing being made', opts, async () => {
  const page = await browser.newPage({ serviceWorkers: 'block' });
  await page.goto(`${base}/lab/editor/?readback`, { waitUntil: 'load' });
  const r = await page.evaluate(async () => {
    const w = await import('/lab/engine/work.js'), out = { order: [] };
    const a = w.hold(), b = w.hold(); let went = false; const t = w.turn().then(() => { went = true; });
    await new Promise((r) => setTimeout(r, 50)); out.whileHeld = went;
    a(); await new Promise((r) => setTimeout(r, 20)); out.oneLeft = went;
    b(); await t; out.after = went;
    const c = w.doing('Building a sharper copy'); out.order.push(w.making()); const d = w.doing('Loading Starfish'); out.order.push(w.making()); d(); out.order.push(w.making()); c(); out.order.push(w.making());
    return out;
  });
  assert.deepEqual([r.whileHeld, r.oneLeft, r.after], [false, false, true], 'it goes once nothing holds the GPU');
  assert.deepEqual(r.order, ['Building a sharper copy', 'Loading Starfish', 'Building a sharper copy', ''], 'the most pressing is named');
  await page.close();
});

test('the better copy made for a photo is kept and taken on its next open: nothing made again', opts, async () => {
  const { context, page, errors } = await editor();
  const r = await page.evaluate(async () => {
    const store = await import('/lab/editor/app/store.js'), p = await import('/lab/editor/app/session.js'), [a, b] = store.photos().map((x) => x.id);
    const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('copy', { create: true }), files = [];
    for (let i = 0; i < 100 && !files.includes(`${a}.v1`); i++) { files.length = 0; for await (const [n] of d.entries()) files.push(n); await new Promise((r) => setTimeout(r, 50)); }   // (kept in the background)
    const quiet = async () => { for (let i = 0; i < 2400 && !(p.ready && p.whole() && !p.busy()); i++) await new Promise((r) => setTimeout(r, 50)); };
    await p.open(b); await quiet();
    const marks = performance.getEntriesByName('th:copy', 'mark').length;
    await p.open(a); await quiet();
    return { kept: files.includes(`${a}.v1`), again: performance.getEntriesByName('th:copy', 'mark').length - marks };
  });
  assert.equal(r.kept, true, 'kept in the phone\'s own files');
  assert.equal(r.again, 0, 'opened again, it is taken, not made again');
  assert.deepEqual(errors, []);
  await context.close();
});

test('the zoom\'s tiles made at a scale for an edit are laid again from what is kept: a pan back makes none', opts, async () => {
  const page = await browser.newPage({ serviceWorkers: 'block' });
  await page.goto(`${base}/lab/editor/?readback`, { waitUntil: 'load' });
  const r = await page.evaluate(async () => {
    const { tiles, forget } = await import('/lab/editor/app/zoom-tiles.js'), ctx = new OffscreenCanvas(400, 300).getContext('2d');
    let made = 0; const make = async (x, y, w, h) => { made++; return { im: new ImageData(w, h), X: x, Y: y }; };
    const draw = (X, key) => tiles({ ctx: /** @type {any} */ (ctx), X, Y: 0, X1: X + 800, Y1: 600, p: 0.5, tw: 300, th: 300, key, make, mine: () => true });
    await draw(0, 'a'); const first = made; await draw(600, 'a'); const away = made; await draw(0, 'a'); const back = made; await draw(0, 'b');
    const out = { first, away, back, other: made }; forget(); return out;
  });
  assert.equal(r.first, 6, 'six tiles for the first view');
  assert.ok(r.away > r.first, 'a pan makes the tiles it has not');
  assert.equal(r.back, r.away, 'and back again makes none');
  assert.equal(r.other, r.back + 6, 'another edit is made anew');
  await page.close();
});

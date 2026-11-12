// Faults found by driving the new editor at /lab/editor/ as a phone does, each held here by driving the real boards
// (frontend/lab/editor/): a photo opening is named at once and never shows the design's sample; culling's EDIT ›
// opens the photo culled; Crop's frame and size follow Undo, which says what it took back, and its steps say what
// they did; the eyedropper's tap reaches the picker and its ask goes with its board; an empty Library and a Find with
// no match say so; Crop and Export give the size the export will have, and a JPEG is called a JPEG; the Import sheet
// goes at a tap outside it; small keys have room for a finger; a chip row fades where it runs on; and the small ones
// (an empty film badge, the cull counter, a JPEG's Profile face, Mine's count, Heal's dial, Versions' header). The
// photos are JPEGs drawn by the test, on a software GPU.
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

/** The editor at an empty Library, a phone's size and touch. */
async function launch() {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true, serviceWorkers: 'block' });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/lab/editor/?readback`, { waitUntil: 'load' });
  await page.waitForSelector('#stage header');
  return { context, page, errors, cdp: await context.newCDPSession(page) };
}
/** Made-up JPEGs, 600 × 400: a ground of `ink` with a warm light grey patch (for the eyedropper to make neutral). */
const drawn = (page, list) => page.evaluate((list) => Promise.all(list.map(async ([name, ink]) => {
  const c = new OffscreenCanvas(600, 400), g = c.getContext('2d'); g.fillStyle = ink; g.fillRect(0, 0, 600, 400); g.fillStyle = '#c4b4a0'; g.fillRect(90, 90, 120, 90);
  return { name, bytes: [...new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 })).arrayBuffer())] };
})), list);
/** Brought in through the Library's own Import sheet, which then closes at a tap outside it. */
async function bringIn(page, files) {
  await page.getByRole('button', { name: 'Import' }).click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByText('Choose photos', { exact: true }).click()]);
  await chooser.setFiles(files.map((f) => ({ name: f.name, mimeType: 'image/jpeg', buffer: Buffer.from(f.bytes) })));
  await page.waitForFunction((n) => new RegExp(`Done · ${n} photos? copied`).test(document.querySelector('#stage')?.textContent ?? ''), files.length);
}
const settle = (page) => page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {}))).then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))));
const tapOn = async (page, selector) => { const b = await page.locator(selector).first().boundingBox(); await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); };
const go = async (page, board) => { await page.evaluate((b) => document.dispatchEvent(new CustomEvent('editor:open', { detail: b })), board); await page.waitForTimeout(100); await settle(page); };
const ready = (page) => until(() => page.evaluate(async () => { const p = await import('/lab/editor/app/session.js'); return p.ready && !p.busy() && !!p.whole(); }), { timeout: 120_000, message: 'the photo opens' });
const text = (page, sel = '#stage') => page.evaluate((s) => (document.querySelector(s)?.textContent || '').replace(/\s+/g, ' '), sel);
/** A drag by a finger (CDP touch: pointer events of the touch kind). */
async function drag(cdp, [x0, y0], [x1, y1], steps = 10) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
  for (let i = 1; i <= steps; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + ((x1 - x0) * i) / steps, y: y0 + ((y1 - y0) * i) / steps }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
/** How far a finger can land from a key and still be on it: the hit box found with elementFromPoint along its middle
 * lines, and whether the whole 44 px square about that box's middle lands on the key. */
const hits = (page, selector, all = false) => page.evaluate(async ([selector, all]) => {
  const out = [];
  for (const el of all ? document.querySelectorAll(selector) : [document.querySelector(selector)]) {
    if (!el) { out.push({ selector, missing: true }); continue; }
    el.scrollIntoView({ block: 'nearest', inline: 'center' }); await new Promise((r) => requestAnimationFrame(r));
    const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const on = (x, y) => { const h = document.elementFromPoint(x, y); return !!h && (h === el || el.contains(h)); };
    const reach = (dx, dy) => { let d = 0; while (d < 90 && on(cx + dx * (d + 0.5), cy + dy * (d + 0.5))) d += 0.5; return d; };
    const L = reach(-1, 0), R = reach(1, 0), U = reach(0, -1), D = reach(0, 1), mx = cx + (R - L) / 2, my = cy + (D - U) / 2;
    const square = [[-21.5, -21.5], [21.5, -21.5], [-21.5, 21.5], [21.5, 21.5], [0, -21.5], [0, 21.5], [-21.5, 0], [21.5, 0]].every(([a, b]) => on(mx + a, my + b));
    out.push({ name: el.getAttribute('aria-label') || el.textContent.trim().slice(0, 12), w: L + R + 0.5, h: U + D + 0.5, square, seen: [Math.round(r.width), Math.round(r.height)] });
  }
  return out;
}, [selector, all]);
const roomy = (list, what) => { for (const k of list) assert.ok(!k.missing && k.w >= 44 && k.h >= 44 && k.square, `${what} ${k.name}: a ${k.w} × ${k.h} hit box (drawn ${k.seen}) should take a 44 px finger`); };

test('the Library: empty and no-match states, the Import sheet, culling into the editor, and a photo opening by its own name', opts, async () => {
  const { context, page, errors } = await launch();
  // Nothing imported yet: it says so and offers the import; no made-up roll, tile or count.
  await page.waitForFunction(() => /No photos yet/.test(document.querySelector('#stage')?.textContent ?? ''));
  const empty = await page.evaluate(() => ({ text: document.querySelector('#stage').textContent, tiles: document.querySelectorAll('#stage .vscroll img').length, sample: [...document.querySelectorAll('img')].some((i) => /sample\.jpg/.test(i.src)) }));
  assert.equal(empty.tiles, 0, 'no sample tiles');
  assert.equal(empty.sample, false);
  assert.doesNotMatch(empty.text, /30 of 30|shoots|DSCF/);
  assert.equal(await page.getByText('Choose photos', { exact: true }).count(), 1, 'the empty Library offers the import');
  roomy([...await hits(page, '#stage header button.hit'), ...await hits(page, '#stage nav[aria-label=Show] button', true)], 'Library');
  // The Import sheet: no row that does nothing; a tap outside it closes it and does nothing else.
  await page.getByRole('button', { name: 'Import' }).click();
  await page.waitForSelector('#stage [role=dialog]');
  assert.doesNotMatch(await text(page, '#stage [role=dialog]'), /Watch a folder/, 'the app does not offer what it cannot do');
  await page.touchscreen.tap(206, 600);
  await page.waitForSelector('#stage [role=dialog]', { state: 'detached' });
  const files = await drawn(page, [['IMG_0001.jpg', '#2a4a7a'], ['IMG_0002.jpg', '#7a4a2a']]);
  await bringIn(page, files);
  await page.touchscreen.tap(206, 600);   // outside the sheet: it goes, and nothing else happens
  await page.waitForSelector('#stage [role=dialog]', { state: 'detached' });
  assert.equal(await page.evaluate(async () => (await import('/lab/editor/app/session.js')).current()), null, 'the tap that closed the sheet opened nothing');
  // A real tile shows no empty film badge.
  const badges = await page.evaluate(() => [...document.querySelectorAll('#stage .vscroll button span')].filter((s) => !s.textContent.trim() && getComputedStyle(s).display !== 'none' && getComputedStyle(s).backgroundColor !== 'rgba(0, 0, 0, 0)').length);
  assert.equal(badges, 0, 'no empty pill on a tile');
  // A filter or a Find with nothing in it says so.
  await page.getByRole('button', { name: /REJECTS/ }).click();
  await page.waitForFunction(() => /No photos match/.test(document.querySelector('#stage')?.textContent ?? ''));
  await page.getByRole('button', { name: /^ALL/ }).click();
  await page.getByLabel('Find photos').fill('no such thing');
  await page.waitForFunction(() => /No photos match/.test(document.querySelector('#stage')?.textContent ?? ''));
  await page.getByLabel('Find photos').fill('');
  // A tile opens its photo: every frame from the tap names it (or names nothing yet), never the sample.
  await page.evaluate(() => { window.FRAMES = []; window.REC = true; const tick = () => { const s = document.querySelector('#stage'); window.FRAMES.push({ head: s?.querySelector('header')?.textContent.replace(/\s+/g, ' ') || '', opening: /Opening…/.test(s?.textContent || ''), sample: [...document.querySelectorAll('#frame img')].some((i) => /sample\.jpg/.test(i.src) && i.getClientRects().length) }); if (window.REC) requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
  await tapOn(page, '#stage .vscroll button[aria-label="IMG_0002"]');
  await ready(page);
  const frames = await page.evaluate(() => { window.REC = false; return window.FRAMES; });
  assert.ok(frames.length > 2, 'frames were seen');
  assert.ok(frames.every((f) => !/DSCF0412|23 mm · f\/5\.6/.test(f.head) && !f.sample), `never the sample: ${JSON.stringify(frames.find((f) => /DSCF|23 mm/.test(f.head) || f.sample))}`);
  assert.ok(frames.some((f) => /IMG_0002/.test(f.head) && f.opening), 'named, and opening, before it is ready');
  assert.match(await text(page, '#stage header'), /IMG_0002.*JPEG/);
  // Culling: EDIT › opens the photo on screen, not the one open before.
  await tapOn(page, '#stage [aria-label="Back to Photos"]');
  await page.getByRole('button', { name: 'CULL' }).click();
  await tapOn(page, '#stage .vscroll button[aria-label="IMG_0002"]');
  await page.waitForSelector('#stage [role=slider][aria-label="Move through the roll"]');
  const roll = page.locator('#stage [role=slider][aria-label="Move through the roll"]');
  await roll.press('ArrowRight');
  if (/IMG_0002/.test(await text(page, '#stage header'))) await roll.press('ArrowLeft');   // it was the last: the other way
  await page.waitForFunction(() => /IMG_0001\.jpg/.test(document.querySelector('#stage header')?.textContent ?? ''));
  const counter = await page.evaluate(() => [...document.querySelectorAll('#stage .glass')].map((g) => g.textContent.trim()).find((t) => /\d+ \/ \d+/.test(t)));
  assert.match(counter, /^\d+ \/ 2$/, `the cull counter ends with the count (${counter})`);
  // ... and while it opens, its camera JPEG (never the photo before) shows until the developed picture has been drawn.
  const before = await page.evaluate(async () => {
    const p = await import('/lab/editor/app/session.js'); window.FRAMES = []; window.REC = true;
    const tick = () => { const w = document.querySelector('#frame > div:first-child > .fillphoto'); window.FRAMES.push({ name: p.current()?.name, drawn: p.took.open > 0, el: w?.firstElementChild?.tagName, src: p.img.src }); if (window.REC) requestAnimationFrame(tick); };
    requestAnimationFrame(tick); return p.img.src;
  });
  await page.getByRole('button', { name: 'EDIT ›' }).click();
  await until(() => page.evaluate(async () => (await import('/lab/editor/app/session.js')).current()?.name === 'IMG_0001.jpg'), { message: 'EDIT › opened the photo culled' });
  await ready(page);
  // (the photo is ready in the task that puts its picture on: the frames are read once one has passed since, or a
  // quick machine stops looking before any frame saw the developed picture)
  const swap = (await page.evaluate(async () => { await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); window.REC = false; return window.FRAMES; })).filter((f) => f.name === 'IMG_0001.jpg');
  assert.ok(swap.some((f) => f.el === 'CANVAS') && swap.every((f) => f.el === 'IMG' || f.el === 'CANVAS'), `its JPEG (if a frame passed before it was developed), then its developed picture: ${swap.map((f) => f.el)}`);
  assert.ok(swap.every((f) => f.el !== 'CANVAS' || f.drawn), 'the picture is put on only once its first frame is drawn (not blank)');
  assert.ok(swap.every((f) => f.el !== 'IMG' || f.src !== before), 'never the photo before under its name');
  assert.equal(await page.evaluate(async () => (await import('/lab/editor/app/session.js')).current()?.name), 'IMG_0001.jpg', 'EDIT › opened the photo culled');
  assert.match(await text(page, '#stage header'), /IMG_0001/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('the boards: crop and Undo, the history, the eyedropper, sizes, keys, rows and small ones', opts, async () => {
  const { context, page, errors, cdp } = await launch();
  await bringIn(page, await drawn(page, [['IMG_0003.jpg', '#3a5a3a']]));
  await page.touchscreen.tap(206, 600);
  await page.waitForSelector('#stage [role=dialog]', { state: 'detached' });
  await tapOn(page, '#stage .vscroll button[aria-label="IMG_0003"]');
  await ready(page);
  await settle(page);
  // Edit: AUTO, the header's Export; the Profile face of a JPEG says why it has no profiles.
  roomy([...await hits(page, '#stage [aria-label="AUTO"]'), ...await hits(page, '#stage header button.hit')], 'Edit');
  const drum = page.locator('#stage [role=listbox][aria-label^="Sections"]');
  await drum.press('ArrowUp'); await page.waitForTimeout(400);
  assert.match(await text(page), /A JPEG has no camera profiles/);
  await drum.press('ArrowDown'); await page.waitForTimeout(300); await drum.press('ArrowDown'); await page.waitForTimeout(400); await settle(page);
  roomy(await hits(page, '#stage [role=toolbar] button[aria-label="R"], #stage [role=toolbar] button[aria-label="G"], #stage [role=toolbar] button[aria-label="B"]', true), 'Curve');
  await drum.press('ArrowDown'); await page.waitForTimeout(400); await settle(page);
  // Color: the eyedropper. Its tap on the photo sets the white balance, and its ask goes when it is done.
  await tapOn(page, '#stage [aria-label="Pick white balance from the photo"]');
  await page.waitForFunction(() => /Tap something white or grey/.test(document.querySelector('#stage')?.textContent ?? ''));
  const at = await page.evaluate(async () => { const z = await import('/lab/editor/app/zoom.js'), b = document.querySelector('#stage [data-keep="photo"]').getBoundingClientRect(), f = z.fitted(); return [b.left + f.left + (f.width * 150) / 600, b.top + f.top + (f.height * 135) / 400]; });
  await page.touchscreen.tap(at[0], at[1]);
  await until(() => page.evaluate(async () => (await import('/lab/editor/app/session.js')).history().steps.at(-1).name === 'White balance'), { message: 'the eyedropper set the white balance' });
  assert.equal(await page.evaluate(async () => (await import('/lab/editor/app/session.js')).current().wb), 'Custom');
  assert.doesNotMatch(await text(page), /Tap something white or grey/);
  assert.deepEqual(await page.evaluate(async () => (await import('/lab/editor/app/session.js')).history().steps.at(-1)), { name: 'White balance', val: 'Picked' });
  await tapOn(page, '#stage [aria-label="Pick white balance from the photo"]');
  await page.waitForFunction(() => /Tap something white or grey/.test(document.querySelector('#stage')?.textContent ?? ''));
  await tapOn(page, '#stage [aria-label="Back to the tools"]'); await tapOn(page, '#dock button[data-go="Looks"]'); await settle(page);
  assert.doesNotMatch(await text(page), /Tap something white or grey/, 'the ask went with the Edit board');
  // Looks: Mine counts the owner's own looks.
  await page.evaluate(async () => { const kept = await import('/lab/editor/app/looks.js'), photo = await import('/lab/editor/app/session.js'); await kept.addMine('Mine A', photo.state()); await kept.addMine('Mine B', photo.state()); photo.changed(); });
  await page.waitForFunction(() => [...document.querySelectorAll('#stage [role=listbox][aria-label^="Sections"] [role=option]')].some((o) => /^MINE2$/.test(o.textContent.trim())));
  // its drum turns between Presets and Mine, and Mine shows the owner's looks
  await page.locator('#stage [role=listbox][aria-label="Sections: Presets"]').press('ArrowDown');
  await page.waitForSelector('#stage [role=listbox][aria-label="My looks"] [role=option][aria-label="Mine B"]');
  await page.locator('#stage [role=listbox][aria-label="Sections: Mine"]').press('ArrowUp');
  await page.waitForSelector('#stage [role=listbox][aria-label="Presets"]');
  await go(page, 'Edit');
  await drum.press('ArrowDown'); await page.waitForTimeout(400); await settle(page);   // Color, as it was left, to Mixer
  roomy(await hits(page, '#stage [role=toolbar] button:has(span[style*="border-radius: 50%"])', true), 'Mixer swatch');
  // Undo says what it took back.
  await page.evaluate(async () => { const p = await import('/lab/editor/app/session.js'); p.turn('Exposure', 0.8); await p.draw(); });
  await tapOn(page, '#stage [aria-label="Undo"]');
  await page.waitForFunction(() => /Undid Exposure \+0\.80/.test(document.querySelector('#told')?.textContent ?? ''));
  // Crop: a corner pulled in, then Undo: the frame and its size go back at once; each step says what it did.
  await go(page, 'Crop');
  const frame = async () => page.evaluate(() => { const h = document.querySelector('#stage [aria-label="Drag the bottom right corner"]').parentElement.getBoundingClientRect(); return { box: [h.left, h.top, h.width, h.height].map(Math.round), view: document.querySelector('#stage [data-keep="photo"]').parentElement.style.transform, dims: [...document.querySelectorAll('#stage span')].map((s) => s.textContent).find((t) => /^\d+ × \d+ · [\d.]+ MP$/.test(t)) }; });
  const was = await frame();
  assert.match(was.dims, /^600 × 399 · 0\.2 MP$/);
  const corner = await page.locator('#stage [aria-label="Drag the bottom right corner"]').boundingBox();
  await drag(cdp, [corner.x + 22, corner.y + 22], [corner.x - 100, corner.y - 60]);
  await page.waitForTimeout(700);
  const cropped = await frame(), step = await page.evaluate(async () => (await import('/lab/editor/app/session.js')).history().steps.at(-1));
  assert.notDeepEqual([cropped.view, cropped.dims], [was.view, was.dims], 'the corner cropped the photo');
  assert.deepEqual(step, { name: 'Crop', val: cropped.dims.split(' · ')[0] }, 'the step says the size the crop leaves');
  await page.waitForTimeout(1600);   // the next change is a step of its own
  await tapOn(page, '#stage [aria-label="Undo"]');
  await page.waitForTimeout(700);
  assert.deepEqual(await frame(), was, 'the frame and its size followed Undo');
  assert.match(await text(page, '#told'), /Undid Crop \d+ × \d+/);
  const cdrum = page.locator('#stage [role=listbox][aria-label^="Sections"]');
  await cdrum.press('ArrowDown'); await page.waitForTimeout(300); await cdrum.press('ArrowDown'); await page.waitForTimeout(400); await settle(page);
  await tapOn(page, '#stage [role=toolbar] button[aria-label="⟳ 90°"]');
  await until(() => page.evaluate(async () => (await import('/lab/editor/app/session.js')).history().steps.at(-1).val === 'rotated'), { message: 'a turn is "rotated" in the history' });
  assert.match((await frame()).dims, /^399 × 600/);
  await page.waitForTimeout(1600);
  const turned = await page.locator('#stage [aria-label="Drag the bottom right corner"]').boundingBox();
  await drag(cdp, [turned.x + 22, turned.y + 22], [turned.x - 70, turned.y - 40]);
  await page.waitForTimeout(700);
  const kept = (await frame()).dims.split(' · ')[0];
  // Export: the same size as Crop said, which is the size the export develops; a JPEG is called one, and no byte count is guessed.
  await go(page, 'Export');
  await ready(page);
  const ex = await page.evaluate(async () => { const p = await import('/lab/editor/app/session.js'), card = document.querySelector('#stage [aria-label="Edit the Full export"]'); return { line: card.lastElementChild.textContent.trim(), who: document.querySelector('#stage header').textContent.replace(/\s+/g, ' '), big: `${p.whole().width} × ${p.whole().height}` }; });
  assert.equal(ex.line, kept, 'Export says what Crop said');
  assert.equal(ex.big, kept, 'and it is the size the export develops');
  assert.match(ex.who, /IMG_0003 · JPEG/);
  assert.doesNotMatch(ex.who + ex.line, /RAF|MB/);
  roomy(await hits(page, '#stage [role=switch]', true), 'Export switch');
  // Masks, Versions: their small keys; Versions' header names the photo and says no timings.
  await go(page, 'Masks');
  roomy([...await hits(page, '#stage [aria-label="Add mask"]'), ...await hits(page, '#stage [aria-label="Overlay"]')], 'Masks');
  await go(page, 'Versions');
  await page.waitForSelector('#stage [aria-label="Show clipped shadows and highlights"]');
  roomy(await hits(page, '#stage [aria-label="Show clipped shadows and highlights"]'), 'Histogram');
  assert.doesNotMatch(await text(page, '#stage header'), /opened in|sharp in| s$/);
  // Heal: the row fades where it runs on, and its last chip comes fully into view; the dial shows the chosen spot's own size.
  await page.evaluate(async () => { const heal = await import('/lab/editor/app/heal.js'); heal.add('Heal', 0.3, 0.3, 0.05, 0.5, 1); heal.add('Heal', 0.7, 0.6, 0.15, 0.5, 1); });
  await go(page, 'Heal');
  const row = await page.evaluate(async () => {
    const t = document.querySelector('#stage [role=toolbar]'), before = [t.dataset.more, getComputedStyle(t).maskImage || getComputedStyle(t).webkitMaskImage];
    t.scrollLeft = t.scrollWidth; t.dispatchEvent(new Event('scroll'));
    await new Promise((r) => setTimeout(r, 200));
    const last = [...t.querySelectorAll('button')].at(-1).getBoundingClientRect(), box = t.getBoundingClientRect(), round = document.querySelector('#stage [aria-label="Back to the tools"]').getBoundingClientRect();
    return { before, after: t.dataset.more, clear: last.left >= box.left && last.right <= box.right - 2 && last.right <= round.left, mask: getComputedStyle(t).maskImage || getComputedStyle(t).webkitMaskImage };
  });
  assert.match(row.before[0], /right/); assert.match(row.before[1], /calc\(100% - 40px\)/, 'a visible fade where it runs on');
  assert.doesNotMatch(row.after, /right/); assert.equal(row.clear, true, 'Clear all comes fully into view, clear of the round key');
  const dialText = () => page.evaluate(() => document.querySelector('#stage [role=status][aria-label^="Heal · Size"]')?.getAttribute('aria-label'));
  const big = await dialText();
  const ring = await page.evaluate(() => { const c = [...document.querySelectorAll('#stage svg circle')][0].getBoundingClientRect(); return [c.left + c.width / 2, c.top + c.height / 2]; });
  await page.touchscreen.tap(ring[0], ring[1]); await page.waitForTimeout(300);
  const small = await dialText(), px = (s) => Number(/Size (\d+)/.exec(s)?.[1]);
  assert.ok(px(big) > px(small) + 20, `the dial shows the chosen spot's size (${big} then ${small})`);
  assert.deepEqual(errors, []);
  await context.close();
});

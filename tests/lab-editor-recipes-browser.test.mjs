// The Weekly Fuji recipes card on the Looks board (frontend/lab/editor/app/recipes.js, boards/LooksPlate.js): first
// on the Presets face, a tap opens the recipes grouped by sensor (the owner's camera's first); a tap on one puts
// its profile and its settings on the open photo as one step of the history, says what is only near, and Undo
// takes it back. What is the photo's own (Exposure, the crop) stays. The strip makes its pictures as they come near.
// The photo here is a JPEG the test draws (a RAF needs a camera's file): it has no camera profiles, so the recipe says
// its film simulation has none here; which profile a film simulation is, is tested in lab-editor-recipes.test.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

const opts = { skip: Boolean(process.env.SITE_URL) && 'local only', timeout: 180_000 };
let server, browser, base;
before(async () => {
  if (opts.skip) return;
  server = await serve(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const exe = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
  browser = await chromium.launch({ ...exe, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader'] });
});
after(async () => { await browser?.close(); server?.close(); });

test('the card opens the recipes; one tapped is its profile and settings on the photo, said and undone', opts, async () => {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true, serviceWorkers: 'block' });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/lab/editor/?readback`, { waitUntil: 'load' });
  await page.waitForSelector('#stage header');
  const jpeg = await page.evaluate(async () => { const c = new OffscreenCanvas(240, 160), g = c.getContext('2d'); g.fillStyle = '#356'; g.fillRect(0, 0, 240, 160); g.fillStyle = '#c84'; g.fillRect(60, 40, 90, 70); return [...new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality: 0.8 })).arrayBuffer())]; });
  await page.evaluate(async (raf) => {
    const store = await import('/lab/editor/app/store.js'), photo = await import('/lab/editor/app/session.js');
    await store.add([new File([new Uint8Array(raf)], 'DSCF0007.JPG', { type: 'image/jpeg', lastModified: 1_700_000_000_000 })], () => {});
    await photo.open(store.photos()[0].id);
    for (let i = 0; i < 600 && !photo.ready; i++) await new Promise((r) => setTimeout(r, 50));
    photo.setValues({ Exposure: 0.5, Contrast: 30, Vibrance: 20 }, '', 'Three dials');
    document.dispatchEvent(new CustomEvent('editor:open', { detail: 'Looks' }));
  }, jpeg);
  const card = page.locator('#stage [role="option"][aria-label="Fuji recipes"]');
  await card.waitFor();
  await card.click();
  // the groups, the owner's camera's sensor first and chosen, and its recipes in the strip
  await page.waitForFunction(() => document.querySelectorAll('#stage [role="listbox"][aria-label^="Weekly Fuji recipes"] [role="option"]').length > 50);
  const seen = await page.evaluate(() => ({ strip: document.querySelector('#stage [role="listbox"][aria-label^="Weekly Fuji recipes"]').getAttribute('aria-label'),
    chips: [...document.querySelectorAll('#stage [role="toolbar"][aria-label="Weekly Fuji recipes"] button')].map((b) => [b.getAttribute('aria-label'), b.getAttribute('aria-pressed')]),
    tiles: document.querySelectorAll('#stage [role="listbox"][aria-label^="Weekly Fuji recipes"] [role="option"]').length, said: document.querySelector('#stage .plate [role="status"]')?.textContent }));
  assert.equal(seen.strip, 'Weekly Fuji recipes · X-Trans V');
  assert.deepEqual(seen.chips.slice(0, 3).map((c) => [c[0].replace(/\d+/, 'N'), c[1]]), [['Back to Presets', 'false'], ['X-Trans V: N recipes', 'true'], ['X-Trans IV: N recipes', 'false']]);
  assert.ok(seen.tiles >= 90, `${seen.tiles} recipes for X-Trans V`);
  assert.match(seen.said, /recipes by Ritchie Roesch, fujixweekly\.com/);
  // only the tiles in sight have their pictures made; scrolling makes more
  // (a tile not yet made shows the photo's own picture: the pictures made are the ones that differ from it)
  const own = await page.evaluate(async () => (await import('/lab/editor/app/session.js')).jpeg());
  const count = (o) => [...document.querySelectorAll('#stage [role="listbox"][aria-label^="Weekly Fuji recipes"] [role="option"] img')].filter((i) => i.src !== o).length;
  const atLeast = ([o, n]) => [...document.querySelectorAll('#stage [role="listbox"][aria-label^="Weekly Fuji recipes"] [role="option"] img')].filter((i) => i.src !== o).length >= n;
  await page.waitForFunction(atLeast, [own, 8]);
  await page.waitForTimeout(600);
  assert.equal(await page.evaluate(count, own), 8, 'eight pictures made before any scroll');
  await page.evaluate(() => { document.querySelector('#stage [role="listbox"][aria-label^="Weekly Fuji recipes"]').scrollLeft = 1400; });
  await page.waitForFunction(atLeast, [own, 20]);
  assert.ok(await page.evaluate(count, own) < 40, 'and not the whole strip');
  // 1960 Chrome: Eterna Bleach Bypass, DR400, grain Strong Large, Color Chrome Strong, Fluorescent 1 −2 Red −4 Blue,
  // Highlight −2, Shadow −1, Color +2, Sharpness −1, High ISO NR −4, Clarity −2
  await page.locator('#stage [role="option"][aria-label="1960 Chrome"]').click();
  await page.waitForFunction(() => /1960 Chrome/.test(document.querySelector('#stage .plate [role="status"]')?.textContent ?? ''));
  const worn = await page.evaluate(async () => {
    const photo = await import('/lab/editor/app/session.js'), st = photo.state(), h = photo.history();
    return { v: st.values, wb: st.wb, film: photo.looks().find((l) => l.id === photo.look())?.label, step: h.steps[h.at].name, said: document.querySelector('#stage .plate [role="status"]').textContent,
      on: document.querySelector('#stage [role="option"][aria-label="1960 Chrome"]').getAttribute('aria-selected') };
  });
  assert.deepEqual([worn.v.Highlights, worn.v.Whites, worn.v.Shadows, worn.v.Blacks, worn.v.Saturation, worn.v.Sharpening, worn.v.Clarity, worn.v.Grain, worn.v['Grain size'], worn.v.Chrome, worn.v['Chrome Blue'], worn.v['Mix Red Lum']],
    [-44, -8, 12, 4, 12, 32, -16, 36, 60, 100, 0, 0], 'grain Strong Large, Color Chrome Strong on their own controls; the mixer left alone');
  assert.deepEqual([worn.wb, worn.v.Temp, worn.v.Tint], ['Custom', 6600, 16], 'Fluorescent 1 (6300 K, tint 25), then two steps warmer and six towards green');
  assert.deepEqual([worn.v.Exposure, worn.v.Contrast, worn.v.Vibrance], [0.5, 0, 0], "Exposure is the photo's own; the look's other dials go back to their start");
  assert.deepEqual([worn.step, worn.on], ['Recipe · 1960 Chrome', 'true']);
  assert.match(worn.said, /^1960 Chrome · near only: Dynamic Range 400 · not here: Exposure compensation, Eterna Bleach Bypass$/);
  // Undo takes the whole recipe back in one step
  await page.evaluate(async () => (await import('/lab/editor/app/session.js')).undo());
  const back = await page.evaluate(async () => { const st = (await import('/lab/editor/app/session.js')).state(); return [st.values.Contrast, st.values.Vibrance, st.values.Grain, st.values['Grain size'], st.values.Chrome, st.wb]; });
  assert.deepEqual(back, [30, 20, 0, 25, 0, 'As shot']);
  // another group, and back to the Presets
  await page.locator('#stage [aria-label^="X-Trans IV:"]').click();
  await page.waitForFunction(() => document.querySelector('#stage [role="listbox"][aria-label="Weekly Fuji recipes · X-Trans IV"]')?.querySelectorAll('[role="option"]').length > 150);
  await page.locator('#stage [aria-label="Back to Presets"]').click();
  await page.locator('#stage [aria-label="Import looks"]').waitFor();
  assert.equal(await page.locator('#stage [role="listbox"][aria-label="Presets"] [role="option"]').count(), 1, 'the card alone: no .cube looks on this phone');
  assert.deepEqual(errors, []);
  await context.close();
});

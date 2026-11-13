// The two Autos of the new editor at /lab/editor/, driven as a phone does. Auto white balance (engine/autowhite.js,
// app/adjust.js), from the Edit board's white balance menu: a photo with a warm cast over a grey patch comes out with
// the patch neutral, as one step that Undo takes back, and the hint line says what it set; a photo with nothing
// neutral in it keeps the camera's white and says so. Auto for the Light controls says what it moved, in its hint and
// its step, and a second tap with nothing to move says that. The photos are JPEGs drawn by the test, the cast made
// with the engine's own colour temperature (dcp.js), on a software GPU.
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

const settle = (page) => page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {}))).then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))));
const tapOn = async (page, selector) => { const b = await page.locator(selector).first().boundingBox(); await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); };
const ready = (page) => until(() => page.evaluate(async () => { const p = await import('/lab/editor/app/session.js'); return p.ready && !p.busy() && !!p.whole(); }), { timeout: 120_000, message: 'the photo opens' });
const text = (page, sel = '#stage') => page.evaluate((s) => (document.querySelector(s)?.textContent || '').replace(/\s+/g, ' '), sel);
const last = (page) => page.evaluate(async () => { const h = (await import('/lab/editor/app/session.js')).history(); return { ...h.steps[h.at], count: h.steps.length }; });
/** The grey patch's mean colour as the photo now shows it (0..255), from its middle. */
const patch = (page) => page.evaluate(async () => {
  const p = await import('/lab/editor/app/session.js'); await p.draw(); const im = await p.pixels(), s = [0, 0, 0]; let n = 0;
  for (let y = Math.round(im.height * 0.35); y < im.height * 0.6; y++) for (let x = Math.round(im.width * 0.3); x < im.width * 0.55; x++, n++) for (let c = 0; c < 3; c++) s[c] += im.data[(y * im.width + x) * 4 + c];
  return s.map((v) => v / n);
});

test('Auto white balance makes a grey under a warm light neutral, as a step Undo takes back; with nothing neutral it says so', opts, async () => {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true, serviceWorkers: 'block' });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/lab/editor/?readback`, { waitUntil: 'load' });
  await page.waitForSelector('#stage header');
  // Made-up JPEGs, 600 × 400. Warm.jpg: a dark grey ground, a light grey patch and four colour patches, all under a
  // 4300 K light (a JPEG's camera is linear sRGB, white at D65). Leaves.jpg: greens only, in daylight.
  const files = await page.evaluate(async () => {
    const { neutralFor } = await import('/lab/engine/dcp.js'), { XYZ_TO_SRGB } = await import('/lab/engine/picture.js');
    const cam = { cm1: XYZ_TO_SRGB, cm2: null, t1: 6504, t2: 6504 }, enc = (v) => Math.round(255 * Math.min(1, v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));
    const ink = (light, c) => { const n = neutralFor(cam, light, 0), k = 1 / Math.max(...n); return `rgb(${[0, 1, 2].map((i) => enc(n[i] * k * c[i])).join(',')})`; };
    const make = async (name, light, ground, rects) => {
      const cv = new OffscreenCanvas(600, 400), g = cv.getContext('2d'); g.fillStyle = ink(light, ground); g.fillRect(0, 0, 600, 400);
      for (const [x, y, w, h, c] of rects) { g.fillStyle = ink(light, c); g.fillRect(x, y, w, h); }
      return { name, bytes: [...new Uint8Array(await (await cv.convertToBlob({ type: 'image/jpeg', quality: 0.95 })).arrayBuffer())] };
    };
    return [await make('Warm.jpg', 4300, [0.12, 0.12, 0.12], [[150, 120, 210, 150, [0.45, 0.45, 0.45]], [20, 20, 90, 70, [0.5, 0.06, 0.05]], [490, 20, 90, 70, [0.06, 0.4, 0.08]], [20, 310, 90, 70, [0.05, 0.08, 0.5]], [490, 310, 90, 70, [0.6, 0.5, 0.05]]]),
      await make('Leaves.jpg', 5500, [0.05, 0.18, 0.03], [[100, 80, 200, 150, [0.12, 0.4, 0.06]], [350, 200, 200, 150, [0.2, 0.5, 0.1]]])];
  });
  await page.getByRole('button', { name: 'Import' }).click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByText('Choose photos', { exact: true }).click()]);
  await chooser.setFiles(files.map((f) => ({ name: f.name, mimeType: 'image/jpeg', buffer: Buffer.from(f.bytes) })));
  await page.waitForFunction(() => /Done · 2 photos copied/.test(document.querySelector('#stage')?.textContent ?? ''));
  await page.touchscreen.tap(206, 600);
  await page.waitForSelector('#stage [role=dialog]', { state: 'detached' });
  await tapOn(page, '#stage .vscroll button[aria-label="Warm"]');
  await ready(page);
  await settle(page);
  const cast = await patch(page);
  assert.ok(cast[0] - cast[2] > 30, `as shot the patch is warm (${cast.map(Math.round)})`);
  // the Color face, its white balance menu, Auto (beside As shot)
  const drum = page.locator('#stage [role=listbox][aria-label^="Sections"]');
  await drum.press('ArrowDown'); await page.waitForTimeout(300); await drum.press('ArrowDown'); await page.waitForTimeout(400); await settle(page);
  await tapOn(page, '#stage [role=toolbar] [aria-label="White balance"]');
  await page.waitForSelector('#stage [role=menu][aria-label="White balance"]');
  const items = await page.evaluate(() => [...document.querySelectorAll('#stage [role=menuitemradio]')].map((b) => [...b.querySelectorAll('span')].map((s) => s.textContent.trim()).join(' ')));
  assert.match(items[0], /^As shot 6,[0-9]{3} K$/);
  assert.match(items[1], /^Auto 4,[0-9]{3} K$/, `Auto stands beside As shot, with what it reads (${items})`);
  await page.getByRole('menuitemradio', { name: /^Auto/ }).click();
  await until(async () => (await last(page)).name === 'White balance · Auto', { message: 'Auto set the white balance' });
  const set = await page.evaluate(async () => { const p = await import('/lab/editor/app/session.js'); return { wb: p.current().wb, temp: p.value('Temp'), tint: p.value('Tint'), shot: p.shotWb() }; });
  const step = await last(page), neutral = await patch(page), hint = await text(page);
  console.log(`Auto white balance: ${set.temp} K, tint ${set.tint} (as shot ${set.shot}); the patch ${cast.map(Math.round)} → ${neutral.map((v) => v.toFixed(1))}`);
  assert.equal(set.wb, 'Auto');
  assert.ok(Math.abs(set.temp - 4300) <= 250, `Temp near the light's 4300 K (${set.temp})`);
  assert.ok(Math.max(...neutral) - Math.min(...neutral) <= 3, `the grey patch is neutral within 3 of 255: ${neutral.map((v) => v.toFixed(1))}`);
  assert.equal(step.val, `Temp ${set.temp.toLocaleString('en-US')} K · Tint ${set.tint > 0 ? '+' : set.tint < 0 ? '−' : ''}${Math.abs(set.tint)}`);
  assert.ok(hint.includes(`Auto: ${step.val}`), `the hint line says what it set (${hint})`);
  // Auto again: nothing new to do, no new step
  await page.evaluate(async () => (await import('/lab/editor/app/session.js')).setWb('Auto'));
  assert.equal((await last(page)).count, step.count, 'a second Auto with nothing to change is no step');
  // the header's Undo: back to as shot, said
  await tapOn(page, '#stage [aria-label="Undo"]');
  await page.waitForFunction(() => /Undid White balance · Auto Temp/.test(document.querySelector('#told')?.textContent ?? ''));
  const undone = await page.evaluate(async () => { const p = await import('/lab/editor/app/session.js'); return [p.current().wb, p.value('Temp'), p.value('Tint')]; });
  assert.deepEqual(undone, ['As shot', ...set.shot]);
  const back = await patch(page);
  assert.ok(back.every((v, i) => Math.abs(v - cast[i]) <= 1), `the patch is as warm as before (${back.map(Math.round)})`);
  // Leaves: no neutrals; the camera's white is kept and the hint says why
  const leaves = await page.evaluate(async () => {
    const store = await import('/lab/editor/app/store.js'), p = await import('/lab/editor/app/session.js');
    await p.open(store.photos().find((x) => x.name === 'Leaves.jpg').id); await p.draw();
    const steps = p.history().steps.length; p.setWb('Auto');
    return { wb: p.current().wb, temp: p.value('Temp'), shot: p.shotWb()[0], status: p.current().status, steps: p.history().steps.length - steps };
  });
  assert.deepEqual(leaves, { wb: 'As shot', temp: leaves.shot, shot: leaves.shot, status: "Auto: kept the camera's white, nothing neutral to go by", steps: 0 });
  assert.deepEqual(errors, []);
  await context.close();
});

test('Auto for the Light controls says what it moved, and a second tap that there is nothing to change', opts, async () => {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true, serviceWorkers: 'block' });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/lab/editor/?readback`, { waitUntil: 'load' });
  await page.waitForSelector('#stage header');
  // a dark photo: a near-black ground and a dim grey patch, so Auto has something to bring up
  const file = await page.evaluate(async () => {
    const cv = new OffscreenCanvas(600, 400), g = cv.getContext('2d'); g.fillStyle = '#141414'; g.fillRect(0, 0, 600, 400); g.fillStyle = '#5a5a5a'; g.fillRect(150, 120, 210, 150); g.fillStyle = '#f4f4f4'; g.fillRect(500, 30, 40, 30);
    return { name: 'Dark.jpg', bytes: [...new Uint8Array(await (await cv.convertToBlob({ type: 'image/jpeg', quality: 0.95 })).arrayBuffer())] };
  });
  await page.getByRole('button', { name: 'Import' }).click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByText('Choose photos', { exact: true }).click()]);
  await chooser.setFiles([{ name: file.name, mimeType: 'image/jpeg', buffer: Buffer.from(file.bytes) }]);
  await page.waitForFunction(() => /Done · 1 photo copied/.test(document.querySelector('#stage')?.textContent ?? ''));
  await page.touchscreen.tap(206, 600);
  await page.waitForSelector('#stage [role=dialog]', { state: 'detached' });
  await tapOn(page, '#stage .vscroll button[aria-label="Dark"]');
  await ready(page);
  await settle(page);
  const was = await last(page);
  await tapOn(page, '#stage [aria-label="AUTO"]');
  await until(async () => (await last(page)).name === 'Auto', { message: 'Auto made a step' });
  const step = await last(page), hint = await text(page), values = await page.evaluate(async () => { const p = await import('/lab/editor/app/session.js'); return ['Exposure', 'Contrast', 'Highlights', 'Shadows', 'Whites', 'Blacks'].map((k) => [k, p.text(k), p.value(k)]); });
  console.log(`Auto: ${step.val}`);
  const parts = step.val.split(' · ');
  assert.ok(parts.length >= 1 && parts.length <= 4, `one to four of them (${step.val})`);
  assert.equal(step.count, was.count + 1);
  assert.match(parts[0], /^Exposure \+\d\.\d\d$/, 'a dark photo: Exposure moved most');
  for (const part of parts) { const [, name, shown] = /^(\w+) (.+)$/.exec(part); assert.equal(shown, values.find((v) => v[0] === name)[1], `${name} as the plate shows it`); }
  for (const [name, , v] of values) if (!parts.some((x) => x.startsWith(`${name} `)) && parts.length < 4) assert.equal(v, 0, `${name}, unnamed, did not move`);
  assert.ok(hint.includes(`Auto: ${step.val}`), `the hint line says it (${hint})`);
  await tapOn(page, '#stage [aria-label="AUTO"]');
  await page.waitForFunction(() => /Auto: nothing to change/.test(document.querySelector('#stage')?.textContent ?? ''));
  assert.equal((await last(page)).count, step.count, 'and makes no step');
  await tapOn(page, '#stage [aria-label="Undo"]');
  await page.waitForFunction((val) => (document.querySelector('#told')?.textContent ?? '') === `Undid Auto ${val}`, step.val);
  assert.equal(await page.evaluate(async () => (await import('/lab/editor/app/session.js')).value('Exposure')), 0);
  assert.deepEqual(errors, []);
  await context.close();
});

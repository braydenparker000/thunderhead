// The Looks panel in Chromium (PHOTOS.md, Looks), against a mock API, on a synthetic JPEG drawn in the
// page, at 390×844: three looks in their sections with live thumbnails; tap applies one (the recipe put)
// and the toast's Undo puts the edit back; Amount scales its change from 0 to 200 %; Save as a look keeps
// the current edit; two synthetic .xmp presets import (their group a chip, the skipped keys counted);
// a pasted recipe lands in Recipes with its film simulation and credit; a long press renames. No real
// preset, recipe or photograph: every one is invented here.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { until } from './fixtures/waits.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (mocked API)', timeout: 180_000 };
const TOKEN = `th1_${'P'.repeat(43)}abcdef`;
const A = '0192aaaa-bbbb-7ccc-8ddd-eeeeffff0011';
const SHOTS = process.env.TH_SHOTS;
const BASE = { Exposure2012: 0.8, Vibrance: 25, CropAngle: 3 };
const look = (id, o) => ({ id: `0192aaaa-bbbb-7ccc-8ddd-eeee0000${id}`, tag: null, film: null, credit: null, created_at: 1, updated_at: 1, ...o });
const LOOKS = [
  look('0001', { name: 'Soft evening', source: 'mine', panels: ['light'], recipe: { Exposure2012: -0.5, Contrast2012: 20 } }),
  look('0002', { name: 'Invented fade', source: 'xmp', tag: 'Invented pack', panels: ['effects'], recipe: { GrainAmount: 40 } }),
  look('0003', { name: 'Example chrome', source: 'recipe', film: 'Classic Chrome', panels: ['light', 'color', 'effects', 'detail'], recipe: { Saturation: -20, Shadows2012: -15 } }),
];
const XMP = (name, group, attrs) => `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/" crs:PresetType="Normal" ${attrs}>
<crs:Name><rdf:Alt><rdf:li xml:lang="x-default">${name}</rdf:li></rdf:Alt></crs:Name>
<crs:Group><rdf:Alt><rdf:li xml:lang="x-default">${group}</rdf:li></rdf:Alt></crs:Group>
</rdf:Description></rdf:RDF></x:xmpmeta>`;
const state = { recipe: { ...BASE }, looks: [...LOOKS], puts: [], senses: [], jpeg: Buffer.alloc(0), preview: Buffer.alloc(0) };
const photo = () => ({ id: A, drive_id: 'drive-file-1', name: 'IMG_0001.JPG', format: 'jpeg', bytes: state.jpeg.length, width: 1500, height: 1000, sha256: 'c'.repeat(64), camera: 'Example Camera', film: null, taken_at: Date.UTC(2026, 9, 3, 9), day: '2026-10-03', rating: 0, flag: null, preview: true, edited: true, deleted_at: null, created_at: 1 });
let site, mock, flat, base;

before(async () => {
  if (live) return;
  mock = createServer(async (req, res) => {
    const cors = { 'Access-Control-Allow-Origin': req.headers.origin ?? '', 'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, TH-Client', Vary: 'Origin' };
    if (req.method === 'OPTIONS') return res.writeHead(204, cors).end();
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks).toString();
    const json = (status, value) => res.writeHead(status, { ...cors, 'Content-Type': 'application/json' }).end(JSON.stringify(value));
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return json(401, { error: { code: 'unauthorized', message: 'x', request_id: '' } });
    const path = new URL(req.url, 'http://x').pathname;
    if (path.startsWith('/v1/senses/batches/')) { const { events } = JSON.parse(body); state.senses.push(...events); return json(200, { accepted: events.length, rejected: [] }); }
    if (path === '/v1/settings') return json(200, { 'owner.tz': 'UTC', min_client: 0 });
    // The Worker's looks (backend/src/areas/photos/looks.ts), newest first.
    if (path === '/v1/photos/looks' && req.method === 'GET') return json(200, { items: state.looks });
    if (path === '/v1/photos/looks' && req.method === 'PUT') {
      const items = JSON.parse(body).items.map((l) => ({ tag: null, film: null, credit: null, ...l, created_at: Date.now(), updated_at: Date.now() }));
      state.puts.push(...items);
      state.looks = [...items.slice().reverse(), ...state.looks.filter((l) => !items.some((i) => i.id === l.id))];
      return json(201, { items, created: items.length });
    }
    const lid = path.match(/^\/v1\/photos\/looks\/([0-9a-f-]{36})$/)?.[1];
    if (lid && req.method === 'PATCH') { const l = state.looks.find((x) => x.id === lid); Object.assign(l, JSON.parse(body)); return json(200, { look: l }); }
    if (lid && req.method === 'DELETE') { state.looks = state.looks.filter((x) => x.id !== lid); return json(200, { ok: true }); }
    if (path === `/v1/photos/${A}/preview`) return res.writeHead(200, { ...cors, 'Content-Type': 'image/jpeg' }).end(state.preview);
    if (path === `/v1/photos/${A}/versions`) return json(200, { items: [] });
    if (path === `/v1/photos/${A}/recipe` && req.method === 'PUT') { state.recipe = JSON.parse(body).recipe; return json(200, { photo: photo(), recipe: state.recipe, changed: true }); }
    if (path === `/v1/photos/${A}`) return json(200, { photo: photo(), recipe: state.recipe });
    json(404, { error: { code: 'not_found', message: 'x', request_id: '' } });
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  site = await serve(0, { api: `http://127.0.0.1:${mock.address().port}` });
  base = `http://127.0.0.1:${site.address().port}`;
  const exe = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
  flat = await chromium.launch({ ...exe, args: ['--disable-features=WebGPU'] });
  const browser = flat;
  // The synthetic photo: colour bands over a grey ramp, drawn by the browser and encoded as JPEG.
  const page = await browser.newPage();
  const draw = async (w, h) => Buffer.from(await page.evaluate(async ([w, h]) => {
    const c = new OffscreenCanvas(w, h), g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, w, 0);
    ['#c0392b', '#f1c40f', '#27ae60', '#2980b9', '#8e44ad'].forEach((col, i) => grad.addColorStop(i / 4, col));
    g.fillStyle = grad; g.fillRect(0, 0, w, h * 0.6);
    const grey = g.createLinearGradient(0, 0, w, 0); grey.addColorStop(0, '#050505'); grey.addColorStop(1, '#fafafa');
    g.fillStyle = grey; g.fillRect(0, h * 0.6, w, h * 0.4);
    return [...new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 })).arrayBuffer())];
  }, [w, h]));
  state.jpeg = await draw(1500, 1000);
  state.preview = await draw(1024, 683);
  await page.close();
});
after(async () => { await flat?.close(); site?.close(); mock?.close(); });

async function open(b, path, device = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 }) {
  const context = await b.newContext({ ...device, hasTouch: true, acceptDownloads: true });
  await context.addInitScript(() => Object.assign(window, { showSaveFilePicker: undefined, showDirectoryPicker: undefined })); // Android: no save dialog
  await context.route('https://www.googleapis.com/drive/v3/files/**', (route) => route.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Content-Length', 'Content-Type': 'application/octet-stream' }, body: state.jpeg }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && /Content Security Policy|Refused|Uncaught|shader|WebGPU/i.test(m.text())) errors.push(m.text()); });
  await page.goto(`${base}/no-such-page`);
  await page.evaluate((token) => new Promise((resolve, reject) => {
    const req = indexedDB.open('th-auth', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => {
      const tx = req.result.transaction('kv', 'readwrite');
      tx.objectStore('kv').put({ session_id: 's1', token, signed_in_at: Date.now(), username: 'example-owner' }, 'session');
      tx.oncomplete = () => { req.result.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }), TOKEN);
  await page.goto(`${base}${path}`, { waitUntil: 'load' });
  return { context, page, errors };
}
const shot = async (page, name) => { if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: `${SHOTS}/photos-looks-${name}.png` }); } };
const recipe = (page) => page.evaluate(() => document.querySelector('.editor').recipe());
const count = (page, n, message) => until(() => page.evaluate((n) => document.querySelector('.lpanel')?.dataset.count === String(n), n), { message });
const section = async (page, id) => { await page.locator(`.echip[data-tool="${id}"]`).click(); await page.locator(`.lpanel[data-section="${id}"]`).waitFor(); };

test('looks: apply with undo, amount, save, import two presets, paste a recipe, rename', opts, async () => {
  const { page, errors } = await open(flat, `/photos/?edit=${A}`);
  await until(() => page.evaluate(() => Number(document.querySelector('.editor')?.dataset.frames) > 0), { timeout: 30_000, message: 'the editor never drew' });
  await shot(page, 'open');
  await page.locator('.epanel[data-id="looks"]').click();
  await count(page, 1, 'Mine did not show its look');
  await until(() => page.locator('.lcard .vthumb canvas').count().then((n) => n === 1), { timeout: 30_000, message: 'no live thumbnail' });
  const strip = await page.locator('.estrip').boundingBox();
  assert.ok(strip.x >= 0 && strip.x + strip.width <= 390.5, `eight panels fit: ${JSON.stringify(strip)}`);
  await shot(page, 'mine');
  // Tap: the look's Light replaces the photo's, the rest kept; Undo puts the edit back.
  await page.locator('.lcard', { hasText: 'Soft evening' }).click();
  assert.deepEqual(await recipe(page), { Exposure2012: -0.5, Contrast2012: 20, Vibrance: 25, CropAngle: 3 });
  await until(() => state.recipe.Contrast2012 === 20, { message: 'the look was not saved' });
  await page.locator('.toast button', { hasText: 'Undo' }).click();
  await until(() => JSON.stringify(state.recipe) === JSON.stringify(BASE), { message: 'Undo did not put the edit back' });
  // Amount: 0 is the photo as it was, 200 % twice the look's change (held inside the range).
  await page.locator('.lcard', { hasText: 'Soft evening' }).click();
  const dial = page.locator('.slider[data-key="LookAmount"] .strack');
  await dial.waitFor();
  const d = await dial.boundingBox();
  await page.mouse.move(d.x + d.width / 2, d.y + d.height / 2);
  await page.mouse.down();
  await page.mouse.move(d.x - 40, d.y + d.height / 2, { steps: 5 });
  await page.mouse.up();
  assert.deepEqual(await recipe(page), BASE);
  await page.mouse.move(d.x + 10, d.y + d.height / 2);
  await page.mouse.down();
  await page.mouse.move(d.x + d.width + 40, d.y + d.height / 2, { steps: 8 });
  await page.mouse.up();
  assert.deepEqual(await recipe(page), { Exposure2012: -1.8, Contrast2012: 40, Vibrance: 25, CropAngle: 3 });
  assert.match(await page.locator('.slider[data-key="LookAmount"] .snum').innerText(), /^200%$/);
  await until(() => state.recipe.Contrast2012 === 40, { message: 'the amount was not saved' });
  await shot(page, 'amount');
  // Save as a look: the current edit's chosen panels, white balance kept relative.
  await page.locator('.lsave').click();
  await page.locator('.lsheet .vname').fill('Invented bright');
  await page.locator('.lsheet .crow[data-panel="color"]').click();
  await shot(page, 'save-sheet');
  await page.locator('.lsheet .xgo').click();
  await count(page, 2, 'the saved look did not show');
  assert.deepEqual(state.puts.at(-1), { ...state.puts.at(-1), name: 'Invented bright', source: 'mine', panels: ['light', 'effects', 'detail'], recipe: { Exposure2012: -1.8, Contrast2012: 40 } });
  // Import two presets from Files: names and groups kept, crop and unknown keys skipped and counted.
  await section(page, 'xmp');
  await count(page, 1, 'Imported did not show its look');
  await page.locator('.limport').click();
  await page.locator('.lfile').setInputFiles([
    { name: 'first.xmp', mimeType: 'application/rdf+xml', buffer: Buffer.from(XMP('Invented warm', 'Invented pack', 'crs:Exposure2012="+0.30" crs:Vibrance="15" crs:WhiteBalance="Custom" crs:Temperature="6000" crs:Tint="+4" crs:CropTop="0.1" crs:SomethingNew="3"')) },
    { name: 'second.xmp', mimeType: 'application/rdf+xml', buffer: Buffer.from(XMP('Invented grain', 'Other pack', 'crs:GrainAmount="35" crs:Clarity2012="-10"')) },
  ]);
  await count(page, 3, 'the two presets did not import');
  assert.match(await page.locator('.toast').innerText(), /Imported 2 looks, 2 settings skipped/);
  const warm = state.puts.find((l) => l.name === 'Invented warm');
  assert.deepEqual({ tag: warm.tag, panels: warm.panels, recipe: warm.recipe }, { tag: 'Invented pack', panels: ['light', 'color'], recipe: { Exposure2012: 0.3, Vibrance: 15, WhiteBalance: 'Custom', Temperature: 6000, Tint: 4 } });
  assert.equal(await page.locator('.lcard', { hasText: 'Invented grain' }).locator('.lchip').innerText(), 'Other pack');
  await shot(page, 'imported');
  // Paste a recipe: read leniently, kept with its film simulation and credit.
  await section(page, 'recipe');
  await page.locator('.limport').click();
  await page.locator('.ltext').fill('film simulation: Classic Chrome\nDR: DR200\nHighlight: -1\nShadow: +1\nColour: +2\nNR: -4\nGrain: Strong/Large\nCCE: Weak\nWB: Auto, +2 Red & -4 Blue\nISO: up to 3200');
  await until(async () => /Reads 9 settings, 1 line skipped\. Classic Chrome is kept as a name/.test(await page.locator('.lread').innerText()), { message: 'the recipe was not read' });
  await page.locator('.lsheet .vname').nth(1).fill('An invented page title');
  await shot(page, 'paste-recipe');
  await page.locator('.lsheet .xgo').click();
  await count(page, 2, 'the pasted recipe did not show');
  const r = state.puts.at(-1);
  assert.deepEqual({ name: r.name, source: r.source, film: r.film, credit: r.credit }, { name: 'Classic Chrome recipe', source: 'recipe', film: 'Classic Chrome', credit: 'An invented page title' });
  assert.deepEqual({ h: r.recipe.Highlights2012, s: r.recipe.Shadows2012, sat: r.recipe.Saturation, g: r.recipe.GrainAmount, size: r.recipe.GrainSize, t: r.recipe.Temperature, tint: r.recipe.Tint }, { h: -25, s: -15, sat: 20, g: 50, size: 50, t: 5995, tint: -6 });
  // A long press: rename.
  const card = await page.locator('.lcard', { hasText: 'Example chrome' }).boundingBox();
  await page.mouse.move(card.x + card.width / 2, card.y + card.height / 2);
  await page.mouse.down();
  await page.locator('.lsheet').waitFor();
  await page.mouse.up();
  await page.locator('.lsheet .vname').fill('Example chrome, renamed');
  await page.locator('.lsheet .seg', { hasText: 'Rename' }).click();
  await until(() => page.locator('.lcard', { hasText: 'Example chrome, renamed' }).count().then((n) => n === 1), { message: 'the rename did not show' });
  await section(page, 'camera');
  assert.match(await page.locator('.lpanel .eline').innerText(), /learn from RAW\+JPEG pairs in a later release/);
  await until(() => state.senses.filter((e) => e.type === 'photo.look').length >= 2, { timeout: 20_000, message: 'no photo.look senses' });
  for (const s of state.senses.filter((e) => e.type === 'photo.look')) { assert.equal(s.ref ?? null, null); assert.deepEqual(s.data, { source: 'mine', panels: 1 }); }
  assert.ok(state.senses.some((e) => e.type === 'photo.edit' && e.data.panel === 'looks'));
  assert.deepEqual(errors.filter((e) => !/cannot present/.test(e)), []);
});

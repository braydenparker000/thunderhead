// The editor's flight recorder (th/report/journal.js, 2026-11-17): each event its own record in IndexedDB as it
// happens; a photo's open and its full-size pixels, and each heavy job the badge names, recorded as they begin and end;
// the phone and its graphics chip; and a visit that never closed found by the next, with what it left running. A photo
// drawn by the test, on a software GPU.
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

/** Every event and session the recorder keeps on this page's phone. @param {import('playwright').Page} page */
const kept = (page) => page.evaluate(async () => {
  const j = await import('/th/report/journal.js'), d = await j.db(), all = (/** @type {string} */ store) => new Promise((r) => { const q = /** @type {IDBDatabase} */ (d).transaction(store).objectStore(store).getAll(); q.onsuccess = () => r(q.result); });
  return { events: /** @type {any[]} */ (await all('events')), sessions: /** @type {any[]} */ (await all('sessions')), visit: j.visit() };
});

test('a visit is recorded as it goes: the open and the full-size pixels begun and ended, the phone and its chip; a visit that never closed is found by the next', opts, async () => {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true, serviceWorkers: 'block' });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/lab/editor/?readback`, { waitUntil: 'load' });
  await page.waitForSelector('#stage header');
  await page.evaluate(async () => {
    const c = new OffscreenCanvas(1500, 1000), g = c.getContext('2d');
    for (let y = 0; y < 1000; y += 25) for (let x = 0; x < 1500; x += 25) { g.fillStyle = `hsl(${(x / 1500) * 360} 40% ${30 + ((x + y) % 50)}%)`; g.fillRect(x, y, 25, 25); }
    const store = await import('/lab/editor/app/store.js'), p = await import('/lab/editor/app/session.js');
    await store.add([new File([await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 })], 'IMG_0071.jpg', { type: 'image/jpeg', lastModified: 1_700_000_000_000 })], () => {});
    await p.open(store.photos()[0].id); document.dispatchEvent(new CustomEvent('editor:open', { detail: 'Edit' }));
  });
  await until(() => page.evaluate(async () => { const p = await import('/lab/editor/app/session.js'); return p.ready && !!p.whole() && !p.busy(); }), { timeout: 120_000, message: 'the photo opens' });
  await until(async () => (await kept(page)).events.some((e) => e.kind === 'full'), { message: 'its full-size pixels recorded' });
  const a = await kept(page), mine = a.events.filter((e) => e.s === a.visit), kinds = mine.map((e) => `${e.kind}${e.job ? `:${e.job}` : ''}`);
  for (const k of ['begin:open', 'end:open', 'open', 'begin:full', 'end:full', 'full', 'phone', 'gpu']) assert.ok(kinds.includes(k), `${k} in ${kinds}`);
  assert.ok(kinds.indexOf('begin:open') < kinds.indexOf('end:open'), 'begun before it ended');
  assert.ok(mine.every((e, i) => i === 0 || e.n > mine[i - 1].n), 'in order');
  assert.ok(a.sessions.some((s) => s.id === a.visit && s.closed === 0), 'the visit is open while the page is');
  // a visit before that never closed, the sharper copy begun and not ended: the next visit finds it
  await page.evaluate(async () => {
    const j = await import('/th/report/journal.js'); await j.tx(['events', 'sessions'], 'readwrite', (t) => {
      t.objectStore('sessions').put({ id: 'gone000001', at: Date.now() - 60_000, build: '', cores: 8, memory: 4, hidden: 0, closed: 0 });
      t.objectStore('events').add({ s: 'gone000001', n: 1, at: Date.now() - 59_000, t: 1000, kind: 'begin', job: 'open' });
      t.objectStore('events').add({ s: 'gone000001', n: 2, at: Date.now() - 58_000, t: 2000, kind: 'end', job: 'open', outcome: 'done', ms: 1000 });
      t.objectStore('events').add({ s: 'gone000001', n: 3, at: Date.now() - 57_000, t: 3000, kind: 'begin', job: 'copy' });
    });
  });
  const was = a.visit;
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#stage header');
  await until(async () => (await kept(page)).events.some((e) => e.s === 'gone000001' && e.kind === 'died'), { message: 'the visit that never closed is found' });
  const b = await kept(page), died = b.events.find((e) => e.s === 'gone000001' && e.kind === 'died');
  assert.deepEqual([died.job, died.hidden], ['copy', 0], 'with what it left running, and that it was in use');
  assert.ok(b.sessions.find((s) => s.id === 'gone000001').died, 'and marked so');
  assert.equal(b.sessions.find((s) => s.id === was)?.closed, 1, 'the visit the page left closed as it went: not counted as died');
  assert.ok(!b.events.some((e) => e.s === was && e.kind === 'died'));
  assert.deepEqual(errors, []);
  await context.close();
});

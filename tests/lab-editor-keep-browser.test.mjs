// Nothing lost in the editor at /lab/editor/ (engine/raw/ROADMAP.md stage 1; app/store.js, app/save.js): the browser is
// asked to keep the photos for good; a set picked again after an import was cut off copies only what is missing;
// a file a cut-off import left with no record is cleared; and an export the page did not live to finish is
// offered again in the Library, once. Synthetic RAFs (tests/fixtures/make-raf.mjs: an invented JPEG in a RAF
// header); the engine's decoding is tested elsewhere, so its wasm is not served.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { makeRaf } from './fixtures/make-raf.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only', timeout: 120_000 };
let server, browser, base;
before(async () => {
  if (live) return;
  server = await serve(0);
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => { await browser?.close(); server?.close(); });

async function open() {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true, serviceWorkers: 'block' });
  await context.route('**/*.wasm', (route) => route.abort());
  const page = await context.newPage();
  await page.goto(`${base}/lab/editor/`, { waitUntil: 'load' });
  await page.waitForSelector('#stage header');
  return { context, page };
}
/** An invented picture as JPEG bytes, drawn by the browser. */
const drawJpeg = (page) => page.evaluate(async () => {
  const c = new OffscreenCanvas(240, 160), g = c.getContext('2d');
  g.fillStyle = '#243'; g.fillRect(0, 0, 240, 160); g.fillStyle = '#fc6'; g.fillRect(60, 40, 120, 80);
  return [...new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality: 0.8 })).arrayBuffer())];
});
/** Adds RAFs by name through the editor's own store; returns what `add` said. */
const add = (page, raf, names) => page.evaluate(async ({ raf, names }) => {
  const store = await import('/lab/editor/app/store.js');
  const files = names.map((n, i) => new File([new Uint8Array(raf)], n, { lastModified: 1_700_000_000_000 + i * 1000 }));
  return store.add(files, () => {});
}, { raf, names });
const rawFiles = (page) => page.evaluate(async () => { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('raw', { create: true }), out = []; for await (const k of d.keys()) out.push(k); return out.sort(); });

test('a set picked again copies only what is missing, and leftovers of a cut-off import are cleared', opts, async () => {
  const { context, page } = await open();
  const raf = [...makeRaf(Uint8Array.from(await drawJpeg(page)))];
  assert.deepEqual(await add(page, raf, ['DSCF0001.RAF', 'DSCF0002.RAF']), { added: 2, had: 0, bad: 0 });
  // The import "was cut off" after two of three: the same three picked again copy one.
  assert.deepEqual(await add(page, raf, ['DSCF0001.RAF', 'DSCF0002.RAF', 'DSCF0003.RAF']), { added: 1, had: 2, bad: 0 });
  assert.equal((await rawFiles(page)).length, 3);
  // A file with no record (the page closed between the copy and the record) goes; the photos stay.
  const state = await page.evaluate(async () => {
    const store = await import('/lab/editor/app/store.js');
    const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('raw');
    const w = await (await d.getFileHandle('00000000-dead-4000-8000-000000000000.raf', { create: true })).createWritable();
    await w.write(new Uint8Array(64)); await w.close();
    await store.sweep();   // an hour's grace: a copy another tab is making now is left alone
    const fresh = []; for await (const k of d.keys()) fresh.push(k);
    await store.sweep(0);
    const after = []; for await (const k of d.keys()) after.push(k);
    return { fresh: fresh.length, after: after.length, kept: typeof store.kept() };
  });
  assert.deepEqual(state, { fresh: 4, after: 3, kept: 'boolean' });
  await context.close();
});

test('an export the page did not live to finish is offered again in the Library, once', opts, async () => {
  const { context, page } = await open();
  const raf = [...makeRaf(Uint8Array.from(await drawJpeg(page)))];
  await add(page, raf, ['DSCF0042.RAF']);
  const id = await page.evaluate(async () => (await import('/lab/editor/app/store.js')).photos()[0].id);
  // As a closed page leaves it: the mark the export sets before it starts, never cleared.
  await page.evaluate((id) => localStorage.setItem('th.editor.export', JSON.stringify({ id, name: 'DSCF0042.RAF' })), id);
  await page.reload({ waitUntil: 'load' });
  const sub = page.locator('#stage [role=button]', { hasText: 'did not finish' });
  await sub.waitFor();
  assert.match(await sub.textContent(), /^The export of DSCF0042 did not finish · tap here to carry on$/);
  assert.equal(await page.evaluate(() => localStorage.getItem('th.editor.export')), null, 'offered once');
  await sub.click();
  // The Export board, on that photo.
  await page.waitForFunction(() => /Export/.test(document.querySelector('#stage header')?.textContent ?? '') && history.state?.name === 'Export');
  // A mark for a photo that is gone says nothing.
  await page.evaluate(() => localStorage.setItem('th.editor.export', JSON.stringify({ id: 'gone', name: 'X.RAF' })));
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#stage header');
  await page.waitForFunction(() => /photos? ·/.test(document.querySelector('#stage')?.textContent ?? ''));
  assert.equal(await page.locator('#stage', { hasText: 'did not finish' }).count(), 0);
  await context.close();
});

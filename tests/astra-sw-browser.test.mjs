// Astra's saved copy of itself (frontend/astra/sw.js) in a real Chromium with the worker on: the first
// visit saves the app; it starts with no signal; a release that changed one small file fetches that file
// and copies the rest; the Reload offer stays; a page opened on release A still gets A's version of a
// module it imports later, after the update to B and a worker restart; a page's query is never a key.
// A small server in front of serve() answers /release.json and /astra/files.json for the release the
// test names, and a probe module that differs between releases A and B.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { astraFiles, fileHash } from '../scripts/astra/files.mjs';
import { until, outlast } from './fixtures/waits.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (the test serves its own releases)' };
const PROBE = 'src/sw-probe.js';
const probe = (r) => `export const release = '${r}';\n`;
// A module worker as the subtitle engine starts one: it is served from its page's release too.
const WORKER = 'src/sw-probe-worker.js', worker = `import {release} from './sw-probe.js?worker';\npostMessage(release);\n`;
let inner, front, browser, base, files;
const state = { release: 'A', up: true, asked: [] };

before(async () => {
  if (live) return;
  ({ files } = await astraFiles(fileURLToPath(new URL('../frontend/astra/', import.meta.url))));
  inner = await serve(0, {});
  front = createServer((req, res) => {
    if (!state.up) { req.socket.destroy(); return; }
    const path = new URL(req.url, 'http://x').pathname;
    state.asked.push(req.url);
    const send = (type, body) => res.writeHead(200, { 'content-type': type }).end(body);
    if (path === '/release.json') return send('application/json', JSON.stringify({ commit: '0'.repeat(40), components: { astra: { tree: state.release } } }));
    if (path === '/astra/files.json') return send('application/json', JSON.stringify({ tree: state.release, files: { ...files, [PROBE]: fileHash(probe(state.release)), [WORKER]: fileHash(worker) } }));
    if (path === `/astra/${PROBE}`) return send('text/javascript', probe(state.release));
    if (path === `/astra/${WORKER}`) return send('text/javascript', worker);
    req.pipe(request({ port: inner.address().port, path: req.url, method: req.method, headers: req.headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); }));
  });
  await new Promise((r) => front.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${front.address().port}`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => {
  await browser?.close();
  front?.close();
  inner?.close();
});

/** Every key in Astra's release caches, by cache. */
const saved = (page) => page.evaluate(async () => {
  const out = {};
  for (const name of await caches.keys()) if (name.startsWith('astra-app-')) out[name] = (await (await caches.open(name)).keys()).map((r) => r.url);
  return out;
});
const started = (page) => page.waitForFunction(() => document.querySelector('.astra') && !document.getElementById('launch'), null, { timeout: 15_000 });
const imported = (page) => page.evaluate(async (p) => (await import(`/astra/${p}?${Math.random()}`)).release, PROBE);

test('saved whole, opens offline, updates by the changed file alone, and a page keeps its release', opts, async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript(() => localStorage.setItem('astra.dev.sw', '1'));
  const errors = [];
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));

  // The first visit saves the app's own files (not vendor/ it did not use, nor docs) under release A.
  await page.goto(`${base}/astra/`);
  await started(page);
  const whole = Object.keys(files).filter((p) => !p.startsWith('vendor/') && !p.endsWith('.md')).length + 2;
  await until(async () => (await saved(page))['astra-app-A']?.length >= whole, { message: 'the app was not saved whole' });
  assert.ok((await saved(page))['astra-app-A'].every((u) => !u.includes('/vendor/') && !u.endsWith('.md')));

  // No signal: it starts from the saved copy.
  state.up = false;
  await page.reload();
  await started(page);
  state.up = true;

  // Release B changes the probe alone. Another page finds it; only the list and the probe are fetched.
  state.release = 'B'; state.asked = [];
  const other = await context.newPage();
  await other.goto(`${base}/astra/`);
  const offer = page.locator('.toast.show', { hasText: 'Astra has been updated' });
  await offer.waitFor({ timeout: 15_000 });
  assert.deepEqual(state.asked.filter((u) => u.startsWith('/astra/')).sort(), ['/astra/files.json', `/astra/${PROBE}`]);
  await outlast(page, 4500);
  assert.ok(await offer.isVisible(), 'the offer stays until it is taken or put off');
  assert.equal(await offer.getByRole('button', { name: 'Reload' }).count(), 1);

  // The worker is stopped (as Chrome does when idle): the page that started on A still gets A's module.
  const cdp = await context.newCDPSession(page);
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');
  assert.equal(await imported(page), 'A');
  assert.equal(await page.evaluate((p) => new Promise((r) => { new Worker(`/astra/${p}`, {type: 'module'}).onmessage = (e) => r(e.data); }), WORKER), 'A', 'a worker it starts: A');
  const fresh = await context.newPage();
  await fresh.goto(`${base}/astra/`);
  await started(fresh);
  assert.equal(await imported(fresh), 'B', 'a page opened now is on B');
  await cdp.send('ServiceWorker.stopAllWorkers');
  assert.equal(await imported(page), 'A', 'still A after another restart');

  // Later puts the offer off.
  await offer.getByRole('button', { name: 'Later' }).click();
  await until(async () => !(await offer.count()), { message: 'Later did not put the offer off' });

  // A page opened with a query: no key anywhere holds one, and the query is never asked for again.
  await fresh.goto(`${base}/astra/lab/?src=${encodeURIComponent('https://cdn.example/a.m3u8?token=example')}`);
  await until(async () => Object.values(await saved(fresh)).flat().some((u) => u.endsWith('/astra/lab/')), { message: 'the lab page was not saved' });
  for (const url of Object.values(await saved(fresh)).flat()) assert.ok(!url.includes('?'), url);
  assert.deepEqual(errors, []);
  await context.close();
});

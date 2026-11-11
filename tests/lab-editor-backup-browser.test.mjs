// The editor's backup to the owner's Drive (frontend/lab/editor/app/backup.js; the Library at /lab/editor/ offers it,
// Photos' page runs it: frontend/apps/photos/backup-screen.js; engine/raw/ROADMAP.md stage 1). Nothing depends on
// it: signed out, the editor works and the Library only says to sign in. Signed in, an original brought straight
// into the editor goes through Photos' own import (registered with the Worker, uploaded to Drive) and the photo
// knows itself by its library id; its edit, rating and flag go as one small file named for that id, replaced when
// the edit changes. On a phone with nothing kept, Photos' Edit brings the original and that edit back. The
// editor's own page reaches nothing outside the site throughout. A mock API and a fake Drive; synthetic RAFs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { makeRaf } from './fixtures/make-raf.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (mocked API)', timeout: 180_000 };
const TOKEN = `th1_${'B'.repeat(43)}abcdef`;
/** What the mock Worker and the fake Drive hold. */
const W = { photos: new Map(), calls: [] }, D = { files: new Map(), sessions: new Map(), n: 0 };
let site, mock, browser, base;

before(async () => {
  if (live) return;
  mock = createServer(async (req, res) => {
    const cors = { 'Access-Control-Allow-Origin': req.headers.origin ?? '', 'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, TH-Client', Vary: 'Origin' };
    if (req.method === 'OPTIONS') return res.writeHead(204, cors).end();
    const chunks = []; for await (const c of req) chunks.push(c);
    const json = (status, value) => res.writeHead(status, { ...cors, 'Content-Type': 'application/json' }).end(JSON.stringify(value));
    const path = new URL(req.url, 'http://x').pathname, id = /^\/v1\/photos\/([0-9a-f-]{36})/.exec(path)?.[1];
    W.calls.push(`${req.method} ${path}`);
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return json(401, { error: { code: 'unauthorized', message: 'x', request_id: '' } });
    if (path.startsWith('/v1/senses/batches/')) return json(200, { accepted: 0, rejected: [] });
    if (path === '/v1/photos/upload-token') return json(200, { access_token: 'fake-drive-token', expires_at: Date.now() + 3e6, folder_id: 'folder-1' });
    if (path === '/v1/photos/pending') return json(200, { items: [] });
    if (path === '/v1/settings') return json(200, { 'owner.tz': 'UTC', min_client: 0 });
    if (path === '/v1/photos') return json(200, { days: [{ day: '2026-10-03', count: W.photos.size, photos: [...W.photos.values()] }], next: null });
    if (id && req.method === 'PUT' && path.endsWith('/preview')) return json(200, { photo: W.photos.get(id) });
    if (id && req.method === 'PUT') {
      const b = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      W.photos.set(id, { id, drive_id: b.drive_id, name: b.name, format: b.format, bytes: b.bytes, sha256: b.sha256, camera: b.camera, film: b.film, width: b.width, height: b.height,
        taken_at: b.taken_at, day: '2026-10-03', rating: 0, favorite: false, flag: null, pair_id: null, preview: false, created_at: Date.now() });
      return json(200, { photo: W.photos.get(id) });
    }
    if (id && req.method === 'GET') return W.photos.has(id) ? json(200, { photo: W.photos.get(id), recipe: {} }) : json(404, { error: { code: 'not_found', message: 'x', request_id: '' } });
    json(404, { error: { code: 'not_found', message: 'x', request_id: '' } });
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  site = await serve(0, { api: `http://127.0.0.1:${mock.address().port}` });
  base = `http://127.0.0.1:${site.address().port}`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => { await browser?.close(); site?.close(); mock?.close(); });

/** A context with the fake Drive; signed in unless told not to be. */
async function open(signedIn = true) {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true, serviceWorkers: 'block' });
  const head = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Location, Range, Content-Length' };
  await context.route('https://www.googleapis.com/**', (route) => {
    const req = route.request(), url = new URL(req.url()), ok = (body, more = {}) => route.fulfill({ status: 200, headers: { ...head, 'Content-Type': 'application/json', ...more }, body: typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body) });
    const session = /^\/upload\/session\/(\d+)$/.exec(url.pathname)?.[1], file = /\/files\/([^/]+)$/.exec(url.pathname)?.[1];
    if (session) { const s = D.sessions.get(session), id = `drive-${session}`; D.files.set(id, { name: s.name, bytes: req.postDataBuffer() ?? Buffer.alloc(0), puts: 1 }); return ok({ id }); }
    assert.equal(req.headers().authorization, 'Bearer fake-drive-token');
    if (req.method() === 'POST' && url.searchParams.get('uploadType') === 'resumable') { const n = String(++D.n); D.sessions.set(n, JSON.parse(req.postData())); return ok({}, { Location: `https://www.googleapis.com/upload/session/${n}` }); }
    if (req.method() === 'PATCH' && file) { const f = D.files.get(file); if (!f) return route.fulfill({ status: 404, headers: head, body: '{}' }); f.bytes = req.postDataBuffer(); f.puts++; return ok({ id: file }); }
    if (req.method() === 'GET' && file) { const f = D.files.get(file); return f ? route.fulfill({ status: 200, headers: { ...head, 'Content-Type': 'application/octet-stream' }, body: f.bytes }) : route.fulfill({ status: 404, headers: head, body: '{}' }); }
    if (req.method() === 'GET') { const name = /name = '([^']+)'/.exec(url.searchParams.get('q') ?? '')?.[1]; return ok({ files: [...D.files].filter(([, f]) => f.name === name).map(([id]) => ({ id })) }); }
    route.fulfill({ status: 400, headers: head, body: '{}' });
  });
  await context.route('**/*.wasm', (route) => route.abort());
  const page = await context.newPage();
  await page.goto(`${base}/no-such-page`);
  if (signedIn) await page.evaluate((token) => new Promise((resolve, reject) => {
    const req = indexedDB.open('th-auth', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => { const tx = req.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put({ session_id: 's1', token, signed_in_at: Date.now(), username: 'example-owner' }, 'session'); tx.oncomplete = () => { req.result.close(); resolve(); }; tx.onerror = () => reject(tx.error); };
  }), TOKEN);
  return { context, page };
}
const editor = async (page) => { await page.goto(`${base}/lab/editor/`, { waitUntil: 'load' }); await page.waitForSelector('#stage header'); };
const drawJpeg = (page) => page.evaluate(async () => {
  const c = new OffscreenCanvas(240, 160), g = c.getContext('2d');
  g.fillStyle = '#324'; g.fillRect(0, 0, 240, 160); g.fillStyle = '#9cf'; g.fillRect(40, 30, 160, 100);
  return [...new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality: 0.8 })).arrayBuffer())];
});
const add = (page, raf, names) => page.evaluate(async ({ raf, names }) => {
  const store = await import('/lab/editor/app/store.js');
  await store.add(names.map((n, i) => new File([new Uint8Array(raf)], n, { lastModified: 1_700_000_000_000 + i * 60_000 })), () => {});
  return store.photos().map((p) => ({ id: p.id, name: p.name }));
}, { raf, names });
const state = (page) => page.evaluate(async () => { const b = await (await import('/lab/editor/app/backup.js')).state(); return { signedIn: b.signedIn, originals: b.originals.length, bytes: b.bytes, edits: b.edits.length }; });

test('signed out, the editor works and the Library only says to sign in; its page reaches nothing outside the site', opts, async () => {
  const { context, page } = await open(false);
  const outside = [];
  page.on('request', (r) => { if (!r.url().startsWith(base) && !r.url().startsWith('blob:') && !r.url().startsWith('data:')) outside.push(r.url()); });
  await editor(page);
  const raf = [...makeRaf(Uint8Array.from(await drawJpeg(page)))];
  await add(page, raf, ['DSCF0001.RAF']);
  assert.deepEqual(await state(page), { signedIn: false, originals: 1, bytes: raf.length, edits: 0 });
  await page.reload({ waitUntil: 'load' }); await page.waitForSelector('#stage header');
  await page.click('#stage button:has-text("Import")');
  await page.locator('#stage', { hasText: 'Back up to Drive' }).locator('text=Sign in on the home screen first. The editor works without it').waitFor();
  const before = W.calls.length;
  await page.click('text=Back up to Drive');
  await page.waitForTimeout(400);
  assert.equal(new URL(page.url()).pathname, '/lab/editor/', 'it stays where it is');
  assert.equal(W.calls.length, before, 'the Worker was not asked');
  assert.deepEqual(outside, []);
  assert.doesNotMatch(await page.$eval('meta[http-equiv="Content-Security-Policy"]', (m) => m.content), /https?:/, "the editor's page names no outside host");
  await context.close();
});

test('signed in: originals go through Photos, each edit as one small file, replaced when it changes; a bare phone gets both back', opts, async () => {
  const { context, page } = await open();
  await editor(page);
  const raf = [...makeRaf(Uint8Array.from(await drawJpeg(page)))];
  const [second, first] = await add(page, raf, ['DSCF0011.RAF', 'DSCF0012.RAF']);   // newest first
  await page.evaluate(async ({ id }) => { const store = await import('/lab/editor/app/store.js'); await store.saveEdit(id, { Exposure: 0.7, wb: 'As shot' }); await store.update(id, { rating: 4, flag: 'pick' }); }, first);
  assert.deepEqual(await state(page), { signedIn: true, originals: 2, bytes: raf.length * 2, edits: 0 });
  // The Library's Import sheet offers it, with what there is to back up.
  await page.reload({ waitUntil: 'load' }); await page.waitForSelector('#stage header');
  await page.click('#stage button:has-text("Import")');
  const row = page.locator('#stage', { hasText: 'Back up to Drive' }).locator('text=/2 originals \\(.* MB\\) to back up/');
  await row.waitFor();
  // Photos' page does it, says how it went, and comes straight back.
  await Promise.all([page.waitForURL(`${base}/photos/?backup`), page.click('text=Back up to Drive')]);
  await page.waitForFunction(() => /Backed up · 2 originals and 1 edit/.test(document.querySelector('#photos')?.textContent ?? ''), null, { timeout: 60_000 });
  await page.waitForURL(`${base}/lab/editor/`);
  await page.waitForSelector('#stage header');
  // Photos' library has both, each with its original in Drive; each photo here knows itself by its library id.
  assert.equal(W.photos.size, 2);
  const here = await page.evaluate(async () => (await import('/lab/editor/app/store.js')).photos().map((p) => ({ id: p.id, name: p.name, source: p.source, editFile: p.editFile })));
  for (const p of here) {
    const lib = W.photos.get(p.source.slice(7));
    assert.equal(lib.name, p.name);
    assert.equal(D.files.get(lib.drive_id).bytes.length, raf.length, 'the whole original is in Drive');
  }
  const mine = here.find((p) => p.id === first.id), side = D.files.get(mine.editFile);
  assert.equal(side.name, `${mine.source.slice(7)}.thunderhead-edit.json`);
  assert.deepEqual(JSON.parse(side.bytes.toString('utf8')), { v: 1, name: 'DSCF0011.RAF', taken: 1_700_000_000_000, rating: 4, flag: 'pick', edit: { Exposure: 0.7, wb: 'As shot' } });
  assert.equal(here.find((p) => p.id === second.id).editFile, undefined, 'a photo with no edit, rating or flag has no file');
  assert.deepEqual(await state(page), { signedIn: true, originals: 0, bytes: 0, edits: 0 });
  // The edit changes: it is to back up again, and the same file in Drive is replaced.
  await page.evaluate(async ({ id }) => (await import('/lab/editor/app/store.js')).saveEdit(id, { Exposure: 1, wb: 'As shot' }), first);
  assert.equal((await state(page)).edits, 1);
  await page.reload({ waitUntil: 'load' }); await page.waitForSelector('#stage header');
  await page.click('#stage button:has-text("Import")');
  await page.locator('#stage', { hasText: 'Back up to Drive' }).locator('text=1 edit to back up').waitFor();
  await Promise.all([page.waitForURL(`${base}/photos/?backup`), page.click('text=Back up to Drive')]);
  await page.waitForURL(`${base}/lab/editor/`);
  await page.waitForSelector('#stage header');
  assert.equal(JSON.parse(side.bytes.toString('utf8')).edit.Exposure, 1);
  assert.equal([...D.files.values()].filter((f) => f.name.endsWith('.thunderhead-edit.json')).length, 1, 'one file, replaced');
  assert.equal((await state(page)).edits, 0);
  await context.close();

  // A phone with nothing kept: Photos' Edit brings the original back from Drive, and the edit with it.
  const bare = await open();
  const photosId = mine.source.slice(7);
  await bare.page.goto(`${base}/photos/?photo=${photosId}`, { waitUntil: 'load' });
  await bare.page.waitForSelector('.view .vedit');
  await Promise.all([bare.page.waitForURL(/\/lab\/editor\/\?open=[0-9a-f-]{36}&from=photos$/), bare.page.click('.view .vedit')]);
  const back = await bare.page.evaluate(async () => {
    const store = await import('/lab/editor/app/store.js'), id = new URLSearchParams(location.search).get('open');
    const db = await new Promise((res, rej) => { const r = indexedDB.open('th-editor'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const p = await new Promise((res) => { const q = db.transaction('photos').objectStore('photos').get(id); q.onsuccess = () => res(q.result); });
    db.close();
    return { edit: await store.loadEdit(id), rating: p.rating, flag: p.flag, source: p.source, editFile: p.editFile };
  });
  assert.deepEqual(back, { edit: { Exposure: 1, wb: 'As shot' }, rating: 4, flag: 'pick', source: `photos:${photosId}`, editFile: mine.editFile });
  await bare.context.close();
});

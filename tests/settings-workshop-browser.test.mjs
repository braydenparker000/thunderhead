// Settings › Files for the workshop (MENU-AND-SETTINGS.md §6.9), in Chromium at 390×844 against a
// mocked Worker that keeps pieces as the real one does (API.md §11.27): a file goes up in pieces,
// each with its own SHA-256; one that stops part way says so, and the same file chosen again sends
// only the rest; the pieces joined are the file; a file already there is not sent again; Remove
// asks first, then takes it. And home's own file there, the editor's timings (th/workshop/timings.js).
// Invented bytes only.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { API, mockApi, TOKEN } from './fixtures/mock-api.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (mocked API)' };
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'Authorization, Content-Type, TH-Client, TH-File-Name, TH-Sha256', 'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE' };
const PART = 1024;
let server, browser, base;
before(async () => {
  if (live) return;
  server = await serve(0, { api: API });
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => { await browser?.close(); server?.close(); });

/** The mocked Worker's workshop: files by id, each with its pieces; `fail` refuses a piece once. */
async function workshop(page) {
  const w = { files: new Map(), puts: [], deletes: [], fail: null };
  const reply = (route, status, body) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  await page.route(new RegExp(`^${API}/v1/workshop`), async (route) => {
    const req = route.request(), url = new URL(req.url()), [, , , id, , n] = url.pathname.split('/');
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    if (req.headers().authorization !== `Bearer ${TOKEN}`) return reply(route, 401, { error: { code: 'unauthorized' } });
    if (req.method() === 'GET') {
      const items = [...w.files.entries()].map(([fid, f]) => ({ id: fid, name: f.name, bytes: f.bytes, parts: Math.ceil(f.bytes / PART), have: [...f.pieces.keys()].sort((a, b) => a - b), at: f.at }));
      return reply(route, 200, { items, bytes: items.reduce((s, f) => s + [...w.files.get(f.id).pieces.values()].reduce((t, b) => t + b.length, 0), 0), limit: 1024 * 1024, part_bytes: PART });
    }
    if (req.method() === 'DELETE') { w.deletes.push(id); const had = w.files.delete(id); return reply(route, had ? 200 : 404, had ? { removed: 1 } : { error: { code: 'not_found' } }); }
    const body = req.postDataBuffer() ?? Buffer.alloc(0), h = req.headers();
    w.puts.push(Number(n));
    if (w.fail === Number(n)) { w.fail = null; return reply(route, 422, { error: { code: 'validation' } }); }
    if (createHash('sha256').update(body).digest('hex') !== h['th-sha256']) return reply(route, 422, { error: { code: 'validation' } });
    const f = w.files.get(id) ?? { name: decodeURIComponent(h['th-file-name']), bytes: Number(url.searchParams.get('bytes')), pieces: new Map(), at: Date.UTC(2026, 10, 12, 9) };
    f.pieces.set(Number(n), body);
    w.files.set(id, f);
    return reply(route, 200, { n: Number(n), have: [...f.pieces.keys()].sort((a, b) => a - b) });
  });
  return w;
}

/** Signed in on home against the mocked Worker, with `kept` in this phone's storage first. */
async function home(kept = {}, path = '/') {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', timezoneId: 'UTC', locale: 'en-GB' });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((k) => { try { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('th.p.sent', '1'); for (const [key, v] of Object.entries(k)) localStorage.setItem(key, v); } } catch {} }, kept);
  await mockApi(page, {});
  const w = await workshop(page);
  await page.goto(`${base}/no-such-page`);
  await page.evaluate((token) => new Promise((resolve) => { const req = indexedDB.open('th-auth', 1); req.onupgradeneeded = () => req.result.createObjectStore('kv'); req.onsuccess = () => { const tx = req.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put({ session_id: 's1', token, signed_in_at: Date.now(), username: 'example-owner' }, 'session'); tx.oncomplete = () => { req.result.close(); resolve(); }; }; }), TOKEN);
  await page.goto(`${base}${path}`, { waitUntil: 'load' });
  await page.waitForSelector('html[data-signed-in]');
  return { page, context, errors, w };
}

test('a file goes to the workshop in pieces, goes on from where it stopped, and can be removed', opts, async () => {
  const { page, context, errors, w } = await home();
  // From Settings, by its row.
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('th:open', { detail: { name: 'settings' } })));
  await page.click('.spage.in [data-page="workshop"]');
  await page.waitForFunction(() => [...document.querySelectorAll('.spage.in .page-title')].some((h) => h.textContent === 'Files for the workshop'));
  await page.waitForSelector('#workshop-files .sempty');
  assert.equal(await page.textContent('#workshop-files .sempty'), 'Nothing sent yet.');
  assert.ok((await page.$eval('#workshop-pick', (b) => b.getBoundingClientRect().height)) >= 44, 'the button is a full touch target');

  const bytes = Buffer.from(Uint8Array.from({ length: 2 * PART + 300 }, (_, i) => (i * 31) % 251));
  const file = { name: 'DSCF0042.RAF', mimeType: 'application/octet-stream', buffer: bytes };
  const line = (re) => page.waitForFunction((s) => new RegExp(s).test(document.querySelector('#workshop-line')?.textContent ?? ''), re.source);
  // The third piece is refused once: the file stops, and says where it is.
  w.fail = 3;
  await page.setInputFiles('#workshop-file', file);
  await line(/stopped part way/);
  assert.deepEqual(w.puts, [1, 2, 3]);
  await page.waitForSelector('#workshop-files [data-file]');
  assert.match(await page.textContent('#workshop-files [data-file] .row-detail'), /^2 of 3 pieces in\./);
  // Chosen again: only the rest goes, and the pieces joined are the file.
  await page.setInputFiles('#workshop-file', file);
  await line(/DSCF0042\.RAF: sent\./);
  assert.deepEqual(w.puts, [1, 2, 3, 3]);
  const [stored] = [...w.files.values()];
  assert.deepEqual([stored.name, stored.bytes], ['DSCF0042.RAF', bytes.length]);
  assert.ok(Buffer.concat([1, 2, 3].map((n) => stored.pieces.get(n))).equals(bytes), 'the pieces joined are the file, byte for byte');
  await page.waitForFunction(() => /sent 12 Nov/.test(document.querySelector('#workshop-files [data-file] .row-detail')?.textContent ?? ''));
  assert.equal(await page.textContent('#workshop-files [data-file] .row-detail'), '2 KB · sent 12 Nov');
  assert.equal(await page.textContent('#workshop-room'), '2 KB of 1 MB used. Files stay until you remove them.');
  assert.equal(await page.isHidden('#workshop-bar'), true);
  // Already there: nothing is sent. An empty file is refused in words.
  await page.setInputFiles('#workshop-file', [file, { name: 'empty.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(0) }]);
  await line(/already there\..*empty\.bin: That file is empty\./);
  assert.equal(w.puts.length, 4);
  // Remove asks first.
  await page.click('#workshop-files [data-file] button');
  await page.waitForSelector('.csheet');
  assert.equal(await page.textContent('.csheet h2'), 'Remove this file?');
  await page.click('.csheet .btn.danger');
  await page.waitForSelector('#workshop-files .sempty');
  assert.equal(w.deletes.length, 1);
  assert.equal(w.files.size, 0);
  assert.deepEqual(errors, []);
  await context.close();
});

test('home passes the editor’s timings on: known fields only, one file, the one before removed, and not when switched off', opts, async () => {
  const at = Date.UTC(2026, 10, 12, 8);
  const timings = [{ at, kind: 'open', ms: 8127, file: 'raf', decode: 1399, pool: 5000, name: 'DSCF0042.RAF' }, { at: at + 1, kind: 'save', ms: 57685, files: 1, px: 39806928, kinds: 'JPEG' }];
  const { page, context, errors, w } = await home({ 'th.editor.timings': JSON.stringify(timings) });
  const send = () => page.evaluate(() => import('/th/workshop/timings.js').then((m) => m.sendTimings()));
  await send();
  assert.equal(w.files.size, 1);
  const [[first, f]] = [...w.files.entries()], said = JSON.parse(f.pieces.get(1).toString('utf8'));
  assert.equal(f.name, 'editor-timings.json');
  assert.deepEqual(said.timings, [{ kind: 'open', at, ms: 8127, decode: 1399, pool: 5000, file: 'raf' }, { kind: 'save', at: at + 1, ms: 57685, px: 39806928, files: 1, kinds: 'JPEG' }]);
  assert.deepEqual([said.v, typeof said.build, typeof said.agent, typeof said.cores], [1, 'string', 'string', 'number']);
  // Nothing new, or too soon: nothing goes.
  await send();
  assert.equal(w.puts.length, 1);
  // A new timing, six hours on: a new file, and the one before is removed.
  await page.evaluate((t) => {
    const all = JSON.parse(localStorage.getItem('th.editor.timings')); all.push({ at: t, kind: 'full', ms: 2100 }); localStorage.setItem('th.editor.timings', JSON.stringify(all));
    const sent = JSON.parse(localStorage.getItem('th.workshop.timings')); sent.when -= 7 * 60 * 60_000; localStorage.setItem('th.workshop.timings', JSON.stringify(sent));
  }, at + 2);
  await send();
  assert.deepEqual([w.puts.length, w.deletes, w.files.size], [2, [first], 1]);
  assert.equal(JSON.parse([...w.files.values()][0].pieces.get(1).toString('utf8')).timings.length, 3);
  // Switched off in Settings › Privacy and data: nothing goes, however new.
  await page.evaluate((t) => {
    localStorage.setItem('th.s.privacy.editor_timings', 'false');
    const all = JSON.parse(localStorage.getItem('th.editor.timings')); all.push({ at: t, kind: 'full', ms: 1900 }); localStorage.setItem('th.editor.timings', JSON.stringify(all));
    const sent = JSON.parse(localStorage.getItem('th.workshop.timings')); sent.when -= 7 * 60 * 60_000; localStorage.setItem('th.workshop.timings', JSON.stringify(sent));
  }, at + 3);
  await send();
  assert.equal(w.puts.length, 2);
  assert.deepEqual(errors, []);
  await context.close();
});

test('/settings/workshop/ opens the page itself', opts, async () => {
  const { page, context, errors } = await home({}, '/settings/workshop/');
  await page.waitForFunction(() => [...document.querySelectorAll('.spage.in .page-title')].some((h) => h.textContent === 'Files for the workshop'));
  await page.waitForSelector('#workshop-pick');
  assert.deepEqual(errors, []);
  await context.close();
});

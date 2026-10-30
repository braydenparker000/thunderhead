// Guitar's data move (P6) in Chromium: on the staged page (its CSP gains the API host), the ported
// app's own sources module asks the new Worker with the owner's session when signed in on this site
// (search, a sample), and the old Worker as before when not. Mock API; the old host is answered by
// the test; no network.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (mocked API)' };
const OLD = 'https://jarvis-hub-api.braydenparker999.workers.dev';
const TOKEN = `th1_${'B'.repeat(43)}abcdef`;
let site, mock, browser, base, api;
const seen = [];

before(async () => {
  if (live) return;
  mock = createServer((req, res) => {
    const cors = { 'Access-Control-Allow-Origin': req.headers.origin ?? '', Vary: 'Origin' };
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...cors, 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Allow-Headers': 'Authorization' });
      return res.end();
    }
    seen.push({ path: req.url, auth: req.headers.authorization ?? '' });
    if (req.url.startsWith('/v1/guitar/search')) {
      res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ results: [{ songId: 77, title: 'Romanza', artist: 'Anonymous', tracks: [] }] }));
    }
    if (req.url.startsWith('/v1/guitar/sounds/')) {
      res.writeHead(200, { ...cors, 'Content-Type': 'audio/mpeg' });
      return res.end(Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 7]));
    }
    res.writeHead(404, { ...cors, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 'not_found', message: 'Not found.', details: { reason: 'Not found' } } }));
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  api = `http://127.0.0.1:${mock.address().port}`;
  site = await serve(0, { api });
  base = `http://127.0.0.1:${site.address().port}`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => { await browser?.close(); site?.close(); mock?.close(); });

async function open(signedIn) {
  const context = await browser.newContext();
  const old = [];
  await context.route(`${OLD}/**`, (route) => {
    old.push(new URL(route.request().url()).pathname);
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ results: [{ songId: 1, title: 'From the old Worker', artist: 'Old', tracks: [] }] }) });
  });
  await context.route('**/assets/drive-config.json', (r) => r.fulfill({ contentType: 'application/json', body: '{}' }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && /Content Security Policy|Refused/i.test(m.text())) errors.push(m.text()); });
  await page.goto(`${base}/no-such-page`);
  if (signedIn)
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
  await page.goto(`${base}/guitar/`, { waitUntil: 'load' });
  return { page, context, old, errors };
}

test('signed in: Guitar’s sources ask the new Worker with the session; its CSP allows it', opts, async () => {
  const { page, context, old, errors } = await open(true);
  const r = await page.evaluate(async () => {
    const m = await import('/guitar/sources.js');
    const found = await m.search('romanza', 'songsterr');
    const sample = new Uint8Array(await m.sample('acoustic_guitar_nylon', 'E2'));
    return { found, first: [...sample.slice(0, 3)] };
  });
  assert.deepEqual(r.found.songsterr.results.map((x) => x.title), ['Romanza']);
  assert.deepEqual(r.first, [0x49, 0x44, 0x33]);
  assert.ok(seen.some((s) => s.path === '/v1/guitar/search?q=romanza' && s.auth === `Bearer ${TOKEN}`), JSON.stringify(seen));
  assert.ok(seen.some((s) => s.path === '/v1/guitar/sounds/acoustic_guitar_nylon/E2.mp3'));
  assert.deepEqual(old, [], 'the old Worker was not asked');
  assert.deepEqual(errors, []);
  await context.close();
});

test('signed out: the old Worker as before, and the session is never invented', opts, async () => {
  seen.length = 0;
  const { page, context, old } = await open(false);
  const titles = await page.evaluate(async () => {
    const m = await import('/guitar/sources.js');
    return (await m.search('romanza', 'songsterr')).songsterr.results.map((x) => x.title);
  });
  assert.deepEqual(titles, ['From the old Worker']);
  assert.deepEqual(old, ['/guitar/search']);
  assert.deepEqual(seen, [], 'nothing reached the new Worker');
  // Reading the session never created the database.
  assert.equal(await page.evaluate(async () => (await indexedDB.databases()).some((d) => d.name === 'th-auth')), false);
  await context.close();
});

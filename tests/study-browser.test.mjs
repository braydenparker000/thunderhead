// Study's page in Chromium (STUDY.md §3.1, §5, §6), against a mock API and a mock private bucket
// that answers only signed range requests: the empty shelf; adding a PDF (its title and cover read
// on the phone, the part sent, the upload completed, "Waiting to be read"); the reader drawing its
// pages from 256 KB ranges, the printed page numbers in the pill, "Go to page", the place saved,
// a 403 signed again once; the search, its snippets as text with marks; and a verse (the invented
// table of tests/study/table.json): its card in the search, its page with the owner's copy, the
// link out with no opener or referrer, "Cited in your books" and a highlight. No CSP or page errors.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { makePdf } from './fixtures/make-pdf.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (mocked API)' };
const BUCKET = 'https://f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0.r2.cloudflarestorage.com';
const TOKEN = `th1_${'C'.repeat(43)}abcdef`;
const PDF = makePdf({ pages: 6, filler: 600_000 });
let site, mock, browser, base, api;
const state = { books: [], files: new Map(), signs: 0, positions: [], parts: [], deny: 0, ranges: [], tables: [] };
const TABLE = readFileSync(new URL('./study/table.json', import.meta.url), 'utf8');

const book = (over) => ({
  author: null, kind: 'book', language: 'eng', pdf_pages: null, sha256: null, state_reason: null, added_at: Date.now(),
  updated_at: Date.now(), ingested_at: null, duplicate_of: null, position: null, ...over,
});

before(async () => {
  if (live) return;
  mock = createServer(async (req, res) => {
    const cors = {
      'Access-Control-Allow-Origin': req.headers.origin ?? '',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, TH-Client, If-None-Match',
      'Access-Control-Expose-Headers': 'ETag',
      Vary: 'Origin',
    };
    if (req.method === 'OPTIONS') return res.writeHead(204, cors).end();
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const json = (status, value) => res.writeHead(status, { ...cors, 'Content-Type': 'application/json' }).end(JSON.stringify(value));
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return json(401, { error: { code: 'unauthorized', message: 'x', request_id: '' } });
    const url = new URL(req.url, 'http://x');
    const path = url.pathname;
    let m;
    if (req.method === 'GET' && path === '/v1/library/books') return json(200, { items: state.books });
    if (req.method === 'POST' && path === '/v1/library/books') {
      const r = JSON.parse(body.toString());
      const b = book({ id: r.id, title: r.title, author: r.author, bytes: r.bytes, state: 'uploading', parts: [] });
      state.books.unshift(b);
      return json(201, { book: b, upload: { part_bytes: 50 * 1024 * 1024, parts: 1 } });
    }
    if ((m = /^\/v1\/library\/books\/([^/]+)\/parts\/(\d+)$/.exec(path))) {
      state.parts.push([m[1], Number(m[2]), body.length, req.headers['content-type']]);
      state.files.set(m[1], new Uint8Array(body));
      const b = state.books.find((x) => x.id === m[1]);
      b.parts = [1];
      return json(200, { n: 1, parts: [1] });
    }
    if ((m = /^\/v1\/library\/books\/([^/]+)\/complete$/.exec(path))) {
      const b = state.books.find((x) => x.id === m[1]);
      delete b.parts;
      Object.assign(b, { state: 'queued', read_pages: 0 });
      return json(200, { book: b });
    }
    if ((m = /^\/v1\/library\/books\/([^/]+)$/.exec(path))) {
      const b = state.books.find((x) => x.id === m[1]);
      return b ? json(200, { book: b }) : json(404, { error: { code: 'not_found', message: 'x', request_id: '' } });
    }
    if ((m = /^\/v1\/library\/positions\/([^/]+)$/.exec(path))) {
      const p = { ...JSON.parse(body.toString()), device: 's1' };
      state.positions.push(p);
      const b = state.books.find((x) => x.id === m[1]);
      if (b && (!b.position || b.position.at < p.at)) b.position = p;
      return json(200, { position: p });
    }
    if (path === '/v1/media/sign') {
      const { refs } = JSON.parse(body.toString());
      const id = refs[0].slice(5);
      state.signs++;
      return json(200, { items: [{ ref: refs[0], url: `${BUCKET}/thunderhead-private/books/${id}.pdf?X-Amz-Signature=s${state.signs}`, expires_at: Date.now() + 3 * 3600_000 }], errors: [] });
    }
    if (path === '/v1/library/search')
      return json(200, {
        items: [
          { book_id: state.books[0]?.id, pdf_page: 3, page_label: '2', snippet: 'about the <mark>morning</mark> light &lt;img src=x onerror=alert(1)&gt;', score: -1 },
        ],
        next: null,
        not_ready: 1,
      });
    if (path === '/v1/library/scripture') {
      state.tables.push(req.headers['if-none-match'] ?? null);
      if (req.headers['if-none-match'] === '"t1"') return res.writeHead(304, { ...cors, ETag: '"t1"' }).end();
      return res.writeHead(200, { ...cors, 'Content-Type': 'application/json', ETag: '"t1"' }).end(TABLE);
    }
    if (path === '/v1/library/scripture/text/a/3') return json(200, { code: 'a', chapter: 3, verses: { 11: 'Not this one.', 12: 'An invented verse twelve.' } });
    if (path === '/v1/library/verses/a/3') {
      const all = url.searchParams.get('all') === '1';
      const id = state.books[0]?.id;
      const cited = Array.from({ length: all ? 12 : 10 }, (_, i) => ({
        book_id: id, title: 'A Synthetic Commentary', pdf_page: i + 1, page_label: String(i + 1), block: 2, line: `Block ${i + 1} on the verse.`, weight: 3,
      }));
      const now = Date.now();
      const h = { id: 'h1', book_id: id, pdf_page: 4, quote: 'the heart of it', prefix: '', suffix: '', rects: null, color: 'gold', note: 'A note of mine.', ref: 'verse:a/3/12', created_at: now, updated_at: now, deleted_at: null };
      return json(200, { ref: `verse:a/3/${url.searchParams.get('v')}`, cited, total: 12, highlights: [h] });
    }
    json(404, { error: { code: 'not_found', message: 'x', request_id: '' } });
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  api = `http://127.0.0.1:${mock.address().port}`;
  site = await serve(0, { api });
  base = `http://127.0.0.1:${site.address().port}`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => {
  await browser?.close();
  site?.close();
  mock?.close();
});

async function open(path) {
  const context = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2 });
  // A Chrome without the newest built-ins (CI's, or an older phone's): pdf.js must bring its own.
  await context.addInitScript(() => {
    delete Map.prototype.getOrInsertComputed;
    delete Map.prototype.getOrInsert;
    delete Math.sumPrecise;
    delete Uint8Array.fromBase64;
    delete Uint8Array.prototype.toBase64;
  });
  // The private bucket: only signed links, ranges answered with 206, one 403 when asked to.
  await context.route(`${BUCKET}/**`, async (route) => {
    const r = route.request();
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges, ETag' };
    if (r.method() === 'OPTIONS')
      return route.fulfill({ status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'GET, HEAD', 'Access-Control-Allow-Headers': 'Range' } });
    const url = new URL(r.url());
    if (!url.searchParams.get('X-Amz-Signature')) return route.fulfill({ status: 403, headers: cors });
    if (state.deny > 0) {
      state.deny--;
      return route.fulfill({ status: 403, headers: cors });
    }
    const id = /books\/([^/]+)\.pdf$/.exec(url.pathname)[1];
    const file = state.files.get(id);
    const [, a, b] = /bytes=(\d+)-(\d+)/.exec(r.headers().range ?? '') ?? [];
    state.ranges.push([Number(a), Number(b)]);
    const slice = file.subarray(Number(a), Number(b) + 1);
    return route.fulfill({
      status: 206,
      headers: { ...cors, 'Content-Range': `bytes ${a}-${Number(a) + slice.length - 1}/${file.length}`, 'Content-Type': 'application/pdf' },
      body: Buffer.from(slice),
    });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && /Content Security Policy|Refused|Uncaught/i.test(m.text())) errors.push(m.text());
  });
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
  return { page, context, errors };
}

test('the empty shelf, then a PDF added: title and cover from the file, the part sent, waiting to be read', opts, async () => {
  const { page, context, errors } = await open('/study/');
  await page.getByText('Your books will live here. Add a PDF to start.').waitFor();
  const dir = mkdtempSync(join(tmpdir(), 'study-'));
  const file = join(dir, 'Some_file_name.pdf');
  writeFileSync(file, PDF);
  await page.locator('input[type=file]').first().setInputFiles(file);
  await page.getByText('Added. It will be read tonight.').waitFor({ timeout: 15_000 });
  assert.equal(state.books[0].title, 'A Synthetic Commentary');
  assert.equal(state.books[0].author, 'Nobody');
  assert.deepEqual(state.parts.map((p) => [p[1], p[2], p[3]]), [[1, PDF.length, 'application/octet-stream']]);
  assert.deepEqual([...state.files.get(state.books[0].id)].slice(0, 8), [...PDF.slice(0, 8)]);
  await page.getByText('Waiting to be read').waitFor();
  // The cover was drawn on the phone from the first page.
  assert.match(await page.locator('.book .cover img').getAttribute('src'), /^data:image\/jpeg;base64,/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('the reader: ranges from the signed link, printed page numbers, Go to page, the place saved, a 403 signed again', opts, async () => {
  const b = state.books[0];
  Object.assign(b, { state: 'ready', pdf_pages: 6, read_pages: undefined });
  state.deny = 1;
  const signsBefore = state.signs;
  const { page, context, errors } = await open('/study/');
  await page.getByText('A Synthetic Commentary').first().click();
  await page.waitForURL(/\/study\/\?book=/);
  await page.waitForFunction(() => document.querySelectorAll('.pg canvas').length >= 3 && [...document.querySelectorAll('.pg canvas')].every((c) => c.width > 0));
  assert.equal(await page.locator('.pg').count(), 6);
  assert.equal(await page.locator('.pill').textContent(), 'p. i');
  // More than one range: the filler pushes the pages past the first 256 KB.
  assert.ok(state.ranges.length >= 2, JSON.stringify(state.ranges));
  assert.ok(state.ranges.every(([a, z]) => z - a + 1 <= 262_144));
  assert.ok(state.signs - signsBefore >= 2, 'a 403 was signed again');
  // The text layer holds the page's words (selection and screen readers).
  await page.waitForFunction(() => document.querySelector('.pg .textLayer')?.textContent.includes('synthetic book'));
  // The canvas is drawn, not blank.
  const inked = await page.evaluate(() => {
    const c = document.querySelector('.pg canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let dark = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 128) dark++;
    return dark;
  });
  assert.ok(inked > 50, `dark pixels: ${inked}`);
  // Go to page: the printed "2" is PDF page 3.
  await page.locator('.pill').click();
  await page.locator('#goto').fill('2');
  await page.getByRole('button', { name: 'Go', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.pill')?.textContent === 'p. 2');
  // The place goes to the Worker (2 s after the page settles).
  await page.waitForFunction(() => true, null, { timeout: 100 });
  for (let i = 0; i < 40 && !state.positions.some((p) => p.pdf_page === 3); i++) await page.waitForTimeout(100);
  assert.ok(state.positions.some((p) => p.pdf_page === 3), JSON.stringify(state.positions));
  // The signed link is never in the address.
  assert.doesNotMatch(page.url(), /r2\.cloudflarestorage|Signature/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('opening again starts at the saved place; search shows snippets as text, grouped by book', opts, async () => {
  const { page, context, errors } = await open(`/study/?book=${state.books[0].id}`);
  await page.waitForFunction(() => document.querySelector('.pill')?.textContent === 'p. 2');
  await page.goto(`${base}/study/?q=morning`);
  await page.locator('.hit').first().waitFor();
  assert.equal(await page.locator('.hit mark').textContent(), 'morning');
  assert.match(await page.locator('.hit p').textContent(), /<img src=x onerror=alert\(1\)>/);
  assert.equal(await page.locator('.hit img').count(), 0);
  assert.equal(await page.locator('.hit small').textContent(), 'p. 2');
  await page.getByText("1 book is still being read and isn't searchable yet.").waitFor();
  await page.locator('.hit').first().click();
  await page.waitForURL(/book=.*&p=3/);
  await page.waitForFunction(() => document.querySelector('.pill')?.textContent === 'p. 2');
  assert.deepEqual(errors, []);
  await context.close();
});

test('a verse: its card first in the search, its page with the owner’s copy, the link out, cited blocks, a highlight', opts, async () => {
  const { page, context, errors } = await open(`/study/?q=${encodeURIComponent('Book A 3:12 light')}`);
  await page.locator('.vcard').waitFor();
  assert.equal(await page.locator('.vcard b').textContent(), 'Book A 3:12');
  // The text search still runs under it.
  await page.locator('.hit').first().waitFor();
  await page.locator('.vcard').click();
  await page.waitForURL(/\/study\/\?verse=a\/3\/12$/);
  await page.getByText('Cited in your books (12)').waitFor();
  assert.equal(await page.locator('.verse h1').textContent(), 'Book A 3:12');
  assert.equal(await page.locator('.vtext').textContent(), 'An invented verse twelve.');
  const out = page.getByRole('link', { name: 'Open in the scripture app' });
  assert.equal(await out.getAttribute('href'), 'https://scripture.example/alpha/book-a/3?id=p12#p12');
  assert.equal(await out.getAttribute('target'), '_blank');
  assert.equal(await out.getAttribute('rel'), 'noopener noreferrer');
  const rows = page.locator('.verse .cited').first().locator('.hit');
  assert.equal(await rows.count(), 10);
  await page.getByRole('button', { name: 'Show all 12' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.verse .cited')[0].querySelectorAll('.hit').length === 12);
  assert.equal(await rows.first().locator('b').textContent(), 'A Synthetic Commentary · p. 1');
  await page.getByText('Your highlights and notes').waitFor();
  assert.equal(await page.locator('.hit.mark.gold .hnote').textContent(), 'A note of mine.');
  // A cited block opens the reader at its page and block.
  await rows.nth(2).click();
  await page.waitForURL(/book=.*&p=3&b=2$/);
  // The table came once, then by its ETag.
  assert.equal(state.tables[0], null);
  await page.goBack();
  await page.waitForURL(/verse=a\/3\/12$/);
  await page.getByText('Cited in your books (12)').waitFor();
  assert.ok(state.tables.includes('"t1"'), JSON.stringify(state.tables));
  assert.deepEqual(errors, []);
  await context.close();
});

test('signing out drops Study’s covers, places and uploads with the rest', opts, async () => {
  const { page, context } = await open('/study/');
  await page.locator('.book').first().waitFor();
  const had = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
  assert.ok(had.includes('th-study'), JSON.stringify(had));
  await page.evaluate(async () => (await import('/th/session.js')).wipe());
  const left = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
  assert.ok(!left.includes('th-study') && !left.includes('th-auth'), JSON.stringify(left));
  await context.close();
});

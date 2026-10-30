import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { serve } from './scripts/serve.mjs';
import { makePdf } from './tests/fixtures/make-pdf.mjs';
const OUT = process.argv[2];
const BUCKET = 'https://f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0.r2.cloudflarestorage.com';
const TOKEN = `th1_${'C'.repeat(43)}abcdef`;
const PDF = makePdf({ pages: 8, text: (n) => `Chapter ${n}. The light of morning falls across the valley.` });
const now = Date.now();
const mk = (id, title, author, state, over = {}) => ({ id, title, author, kind: 'book', language: 'eng', bytes: PDF.length, pdf_pages: 412, sha256: null, state, state_reason: null, added_at: now, updated_at: now, ingested_at: null, duplicate_of: null, position: null, ...over });
const ids = Array.from({ length: 7 }, (_, i) => `0190${i}000-0000-7000-8000-00000000000${i}`);
const books = [
  mk(ids[0], 'A Synthetic Commentary on Book A', 'Nobody', 'ready', { position: { pdf_page: 212, scroll_frac: 0, at: now - 1000, device: 's' } }),
  mk(ids[1], 'Notes on the Gamma Letters', 'A. Writer', 'ready', { position: { pdf_page: 40, scroll_frac: 0, at: now - 5000, device: 's' } }),
  mk(ids[2], 'Sayings and Notes, Annotated', null, 'extracting', { read_pages: 120 }),
  mk(ids[3], 'An Invented Handbook', 'Nobody', 'indexing', { paused: true, read_pages: 300 }),
  mk(ids[4], 'A Locked File', null, 'failed', { state_reason: 'This PDF is password-protected. Remove the password and add it again.' }),
  mk(ids[5], 'Delta Studies', 'Someone Else', 'queued', { read_pages: 0 }),
  mk(ids[6], 'Half Uploaded', null, 'uploading', { parts: [1] }),
];
const mock = createServer(async (req, res) => {
  const cors = { 'Access-Control-Allow-Origin': req.headers.origin ?? '', 'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, TH-Client' };
  if (req.method === 'OPTIONS') return res.writeHead(204, cors).end();
  for await (const _ of req);
  const json = (s, v) => res.writeHead(s, { ...cors, 'Content-Type': 'application/json' }).end(JSON.stringify(v));
  const p = new URL(req.url, 'http://x').pathname;
  let m;
  if (p === '/v1/library/books') return json(200, { items: books });
  if ((m = /^\/v1\/library\/books\/([^/]+)$/.exec(p))) return json(200, { book: books.find((b) => b.id === m[1]) });
  if (p === '/v1/media/sign') return json(200, { items: [{ ref: 'book:x', url: `${BUCKET}/thunderhead-private/books/x.pdf?X-Amz-Signature=s`, expires_at: now + 9e6 }], errors: [] });
  if (p.startsWith('/v1/library/positions')) return json(200, { position: {} });
  if (p === '/v1/library/search') return json(200, { items: [
    { book_id: ids[0], pdf_page: 214, page_label: '212', snippet: '…where the <mark>morning</mark> light falls across the valley and the river turns slowly toward the sea…', score: -2 },
    { book_id: ids[0], pdf_page: 30, page_label: '28', snippet: '…in the <mark>morning</mark> the writer returns to the same question…', score: -1.5 },
    { book_id: ids[1], pdf_page: 41, page_label: null, snippet: 'Every <mark>morning</mark> begins with a short reading.', score: -1 }], next: null, not_ready: 3 });
  json(404, {});
});
await new Promise((r) => mock.listen(0, '127.0.0.1', r));
const site = await serve(0, { api: `http://127.0.0.1:${mock.address().port}` });
const base = `http://127.0.0.1:${site.address().port}`;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const only = process.argv[3] ?? 'lib,search,reader,menu';
for (const theme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: theme });
  await ctx.route(`${BUCKET}/**`, (route) => {
    const r = route.request();
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Range' } });
    const [, a, b] = /bytes=(\d+)-(\d+)/.exec(r.headers().range);
    const s = PDF.subarray(Number(a), Number(b) + 1);
    return route.fulfill({ status: 206, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Content-Range', 'Content-Range': `bytes ${a}-${Number(a) + s.length - 1}/${PDF.length}` }, body: Buffer.from(s) });
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('ERR', e.message));
  await page.goto(`${base}/x`);
  await page.evaluate(([token, theme]) => { localStorage.setItem('th-theme', theme); return new Promise((res) => { const q = indexedDB.open('th-auth', 1); q.onupgradeneeded = () => q.result.createObjectStore('kv'); q.onsuccess = () => { const t = q.result.transaction('kv', 'readwrite'); t.objectStore('kv').put({ session_id: 's1', token, signed_in_at: Date.now(), username: 'o' }, 'session'); t.oncomplete = () => { q.result.close(); res(); }; }; }); }, [TOKEN, theme]);
  if (only.includes('lib')) {
    await page.goto(`${base}/study/`);
    await page.locator('.book').first().waitFor();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/lib-${theme}.png` });
    await page.evaluate(() => document.querySelector('.lib').scrollTo(0, 600));
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${OUT}/lib2-${theme}.png` });
  }
  if (only.includes('search')) {
    await page.goto(`${base}/study/?q=morning`);
    await page.locator('.hit').first().waitFor();
    await page.screenshot({ path: `${OUT}/search-${theme}.png` });
  }
  if (only.includes('reader')) {
    await page.goto(`${base}/study/?book=${ids[0]}&p=3`);
    await page.waitForFunction(() => [...document.querySelectorAll('.pg canvas')].filter((c) => c.width > 0).length >= 2);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/reader-${theme}.png` });
  }
  if (only.includes('menu')) {
    await page.locator('.ib[aria-label="Book menu"]').click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/menu-${theme}.png` });
  }
  await ctx.close();
}
await browser.close(); site.close(); mock.close();

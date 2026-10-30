// The Podcasts data move in Chromium (frontend/th/podcasts/bridge.js in the real podcasts/sw.js):
// with the owner signed in, the unchanged app's requests to the old Worker are answered from a mock
// new Worker with the session. Browse and search list shows; a show's feed, passed through, is read
// on the phone into its episodes; "Play latest" plays a real Opus file through range requests; a
// refusal reaches the app in its old shape; signed out, the old Worker answers as before. Apple's
// directory (which the app also asks from the phone) is blocked. Local only; no network.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

// The worker's own requests (its fallback to the old Worker) go through the context's routes too.
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1';
const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (mocked API)' };
const OLD = 'https://jarvis-hub-api.braydenparker999.workers.dev';
const FEED = 'https://feeds.example.org/history.xml';
const TONE = readFileSync(new URL('./fixtures/tone.opus', import.meta.url));
const TOKEN = `th1_${'A'.repeat(43)}abcdef`;
const RSS = `<?xml version="1.0"?><rss><channel><title>History &amp; Sound</title><itunes:author>Host</itunes:author>${Array.from(
  { length: 45 },
  (_, i) => `<item><title>Episode ${45 - i}</title><guid>ep-${45 - i}</guid><itunes:duration>3</itunes:duration><enclosure url="https://media.example.org/${45 - i}.opus" type="audio/ogg"/></item>`,
).join('')}</channel></rss>`;
let site, mock, browser, base, api;
const seen = { paths: [], auth: new Set(), ranges: [] };

before(async () => {
  if (live) return;
  mock = createServer((req, res) => {
    const cors = { 'Access-Control-Allow-Origin': req.headers.origin ?? '', Vary: 'Origin' };
    const url = new URL(req.url, 'http://x');
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...cors, 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Allow-Headers': 'Authorization, Range, If-Range', 'Access-Control-Max-Age': '60' });
      return res.end();
    }
    seen.paths.push(url.pathname + url.search);
    seen.auth.add(req.headers.authorization ?? '');
    const json = (status, body) => res.writeHead(status, { ...cors, 'Content-Type': 'application/json' }).end(JSON.stringify(body));
    if (url.pathname === '/v1/podcasts/directory')
      return json(200, { shows: [{ id: '1', title: 'History & Sound', feedUrl: FEED, author: 'Host', artwork: '', genres: [] }] });
    if (url.pathname === '/v1/podcasts/feed' && url.searchParams.get('url') === FEED)
      return res.writeHead(200, { ...cors, 'Content-Type': 'application/xml' }).end(RSS);
    if (url.pathname === '/v1/podcasts/feed')
      return json(502, { error: { code: 'upstream', message: 'An upstream service failed.', details: { reason: 'This podcast feed is unavailable. Try again later.' }, request_id: 'r' } });
    if (url.pathname === '/v1/podcasts/audio') {
      const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '');
      seen.ranges.push(req.headers.range ?? 'none');
      const head = { ...cors, 'Content-Type': 'audio/ogg', 'Accept-Ranges': 'bytes', 'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges' };
      if (!range) return res.writeHead(200, { ...head, 'Content-Length': String(TONE.length) }).end(TONE);
      const a = Number(range[1]);
      const b = range[2] ? Math.min(Number(range[2]), TONE.length - 1) : TONE.length - 1;
      return res.writeHead(206, { ...head, 'Content-Range': `bytes ${a}-${b}/${TONE.length}`, 'Content-Length': String(b - a + 1) }).end(TONE.subarray(a, b + 1));
    }
    res.writeHead(404, cors).end();
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  api = `http://127.0.0.1:${mock.address().port}`;
  site = await serve(0, { api });
  base = `http://127.0.0.1:${site.address().port}`;
  browser = await chromium.launch({
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: ['--autoplay-policy=no-user-gesture-required'],
  });
});
after(async () => { await browser?.close(); site?.close(); mock?.close(); });

async function opened(signedIn) {
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  const oldCalls = [];
  await context.route(`${OLD}/**`, (route) => {
    oldCalls.push(new URL(route.request().url()).pathname);
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ shows: [{ id: 'o', title: 'From the old Worker', feedUrl: 'https://old.example.org/x.xml' }] }) });
  });
  await context.route('https://itunes.apple.com/**', (route) => route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (signedIn) {
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
  }
  // The app registers its (module) worker itself; the next load runs under it.
  await page.goto(`${base}/podcasts/`, { waitUntil: 'load' });
  await page.evaluate(() => navigator.serviceWorker.ready);
  oldCalls.length = 0;
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  return { context, page, oldCalls, errors };
}

test('signed in: shows, a feed read on the phone, and an episode playing, all from the new Worker', opts, async () => {
  const { context, page, oldCalls, errors } = await opened(true);
  // Browse (the app's first view) and search.
  await page.locator(`[data-feed="${FEED}"]`).first().waitFor({ timeout: 15_000 });
  await page.fill('#query', 'history');
  await page.press('#query', 'Enter');
  await page.locator(`.search-results [data-feed="${FEED}"]`).first().waitFor();
  // The show: its feed, parsed on the phone, 40 episodes and more to come.
  await page.locator(`[data-feed="${FEED}"]`).first().click();
  await page.locator('#episodes .episode-row').first().waitFor();
  assert.equal(await page.locator('#episode-count').textContent(), '40+');
  assert.match(await page.locator('.show-header h1').textContent(), /History & Sound/);
  await page.click('#more-episodes');
  await page.waitForFunction(() => document.querySelector('#episode-count')?.textContent === '45');
  // "Play latest": the <audio> element's range requests, through the worker.
  await page.locator('.show-actions [data-play]').click();
  await page.waitForFunction(() => document.querySelector('#audio').currentTime > 0.2, null, { timeout: 15_000 });
  assert.equal(await page.evaluate(() => document.querySelector('#audio').error), null);
  // A refusal comes back in the old shape, its words kept.
  const refused = await page.evaluate(async (old) => {
    const r = await fetch(`${old}/podcasts/feed?url=${encodeURIComponent('https://feeds.example.org/gone.xml')}`);
    return [r.status, await r.json()];
  }, OLD);
  assert.deepEqual(refused, [502, { error: 'This podcast feed is unavailable. Try again later.' }]);

  assert.ok(seen.paths.some((p) => p.startsWith('/v1/podcasts/directory?category=popular')), seen.paths.join());
  assert.ok(seen.paths.some((p) => p.startsWith('/v1/podcasts/directory?q=history')));
  assert.equal(seen.paths.filter((p) => p === `/v1/podcasts/feed?url=${encodeURIComponent(FEED)}`).length, 1, 'the feed is kept for "Show more"');
  assert.ok(seen.paths.some((p) => p.startsWith(`/v1/podcasts/audio?feed=${encodeURIComponent(FEED)}&id=`)));
  assert.ok(seen.ranges.some((r) => r.startsWith('bytes=')), `range requests: ${seen.ranges}`);
  assert.deepEqual([...seen.auth], [`Bearer ${TOKEN}`], 'the new Worker gets the session');
  assert.deepEqual(oldCalls, [], 'the old Worker was never reached');
  assert.deepEqual(errors, []);
  await context.close();
});

test('signed out: the old Worker answers as before', opts, async () => {
  const { context, page, oldCalls, errors } = await opened(false);
  await page.locator('[data-feed="https://old.example.org/x.xml"]').first().waitFor({ timeout: 15_000 });
  assert.ok(oldCalls.includes('/podcasts/browse'), oldCalls.join());
  assert.deepEqual(errors, []);
  await context.close();
});

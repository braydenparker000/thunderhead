// Podcasts' progress on the Worker in Chromium, with the real ported page (NEXT-BATCH.md part 7):
// signed in, the newer position another phone left is in the app's storage before the app reads it
// ("Continue listening" shows it), this phone's own newer position and its follows go up on open,
// and an episode played and paused sends its position at once. Signed out, the module asks nothing.
// The mock Worker is plain http on 127.0.0.1, which the page's own CSP (https: only) would refuse,
// so the context bypasses CSP; the live site's API is https. Local only; no network.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1';
const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (mocked API)' };
/** The old Worker the unchanged app addresses (podcasts/sw.js names it). */
const OLD = 'https://*.workers.dev';
const FEED = 'https://feeds.example.org/history.xml';
const OTHER = 'https://feeds.example.org/other.xml';
const TONE = readFileSync(new URL('./fixtures/tone.opus', import.meta.url));
const TOKEN = `th1_${'B'.repeat(43)}abcdef`;
const RSS = `<?xml version="1.0"?><rss><channel><title>Invented Show</title><item><title>Episode two</title><guid>ep-2</guid><itunes:duration>30</itunes:duration><enclosure url="https://media.example.org/2.opus" type="audio/ogg"/></item><item><title>Episode one</title><guid>ep-1</guid><itunes:duration>30</itunes:duration><enclosure url="https://media.example.org/1.opus" type="audio/ogg"/></item></channel></rss>`;
let site, mock, browser, base, api;
const seen = { gets: [], puts: [], auth: new Set() };
let remote = [];

before(async () => {
  if (live) return;
  mock = createServer(async (req, res) => {
    const cors = { 'Access-Control-Allow-Origin': req.headers.origin ?? '', Vary: 'Origin' };
    const url = new URL(req.url, 'http://x');
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...cors, 'Access-Control-Allow-Methods': 'GET, PUT', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, Range, If-Range', 'Access-Control-Max-Age': '60' });
      return res.end();
    }
    seen.auth.add(req.headers.authorization ?? '');
    let raw = '';
    for await (const c of req) raw += c;
    const json = (status, body) => res.writeHead(status, { ...cors, 'Content-Type': 'application/json' }).end(JSON.stringify(body));
    if (url.pathname === '/v1/podcasts/progress' && req.method === 'GET') {
      seen.gets.push(url.search);
      return json(200, { items: remote, next_since: Date.now(), next: null });
    }
    if (req.method === 'PUT' && url.pathname.startsWith('/v1/podcasts/')) {
      const body = JSON.parse(raw);
      seen.puts.push({ path: url.pathname, items: body.items });
      return json(200, { applied: body.items.length, stale: 0, at: Date.now() });
    }
    if (url.pathname === '/v1/podcasts/directory')
      return json(200, { shows: [{ id: '1', title: 'Invented Show', feedUrl: FEED, author: 'Host', artwork: '', genres: [] }] });
    if (url.pathname === '/v1/podcasts/feed') return res.writeHead(200, { ...cors, 'Content-Type': 'application/xml' }).end(RSS);
    if (url.pathname === '/v1/podcasts/audio') {
      const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '');
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

/** The feed reader's id of a guid (th/podcasts/feed.js `episodeID`). */
async function idOf(page, guid) {
  return page.evaluate(async (g) => (await import('/th/podcasts/feed.js')).episodeID(g), guid);
}

async function opened(signedIn, appState) {
  const context = await browser.newContext({ serviceWorkers: 'allow', bypassCSP: true });
  // Before the app's worker takes over, the app asks the old Worker itself (its directory, here).
  await context.route(`${OLD}/**`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ shows: [{ id: '1', title: 'Invented Show', feedUrl: FEED, author: 'Host' }] }) }));
  await context.route('https://itunes.apple.com/**', (route) => route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/no-such-page`);
  const ids = { 1: await idOf(page, 'ep-1'), 2: await idOf(page, 'ep-2') };
  await page.evaluate(([token, signedIn, state]) => new Promise((resolve, reject) => {
    localStorage.setItem('jarvis.podcasts.v1', JSON.stringify(state));
    if (!signedIn) return resolve();
    const req = indexedDB.open('th-auth', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => {
      const tx = req.result.transaction('kv', 'readwrite');
      tx.objectStore('kv').put({ session_id: 's1', token, signed_in_at: Date.now(), username: 'example-owner' }, 'session');
      tx.oncomplete = () => { req.result.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }), [TOKEN, signedIn, appState(ids)]);
  return { context, page, ids, errors };
}

const show = { feedUrl: FEED, title: 'Invented Show', author: 'Host', artwork: '' };
const episode = (id, title) => ({ id, title, description: '', audioUrl: 'https://media.example.org/x.opus', type: 'audio/ogg', publishedAt: '', duration: 30, bytes: 0, artwork: '', show });

test('signed in: another phone’s newer position is there before the app reads; this phone’s go up; a pause sends at once', opts, async () => {
  const now = Date.now();
  const { context, page, ids, errors } = await opened(true, (ids) => ({
    version: 1, queue: [], downloads: {}, current: null, speed: 1, country: 'us', autoplay: true,
    follows: [show, { feedUrl: OTHER, title: 'Other show', author: '', artwork: '' }],
    progress: {
      [`${FEED}#${ids[1]}`]: { episode: episode(ids[1], 'Episode one'), position: 3, duration: 30, played: false, updatedAt: now - 60_000 },
      [`${FEED}#${ids[2]}`]: { episode: episode(ids[2], 'Episode two'), position: 9, duration: 30, played: false, updatedAt: now - 1000 },
    },
  }));
  remote = [
    { key: `${FEED}#${ids[1]}`, position_s: 21, duration_s: 30, played: false, updated_at: now - 30_000 },
    { key: `${FEED}#${ids[2]}`, position_s: 1, duration_s: 30, played: false, updated_at: now - 50_000 },
  ];
  await page.goto(`${base}/podcasts/`, { waitUntil: 'load' });
  // "Continue listening" (the app's first view) reads the merged storage: episode one at 0:21.
  await page.locator('.continue-listening').waitFor({ timeout: 15_000 });
  await page.waitForFunction(() => /Resume 0:21/.test(document.querySelector('.continue-listening')?.textContent ?? ''));
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('jarvis.podcasts.v1')).progress);
  assert.equal(stored[`${FEED}#${ids[1]}`].position, 21);
  assert.equal(stored[`${FEED}#${ids[1]}`].episode.title, 'Episode one', 'the details the app keeps stay');
  assert.equal(stored[`${FEED}#${ids[2]}`].position, 9, 'this phone’s newer one stays');
  assert.deepEqual(seen.gets, ['?since=0']);
  // On open, this phone's newer position and both follows go up.
  const until = async (fn) => { for (let i = 0; i < 100 && !fn(); i++) await new Promise((r) => setTimeout(r, 100)); assert.ok(fn()); };
  await until(() => seen.puts.some((p) => p.path.endsWith('/follows')));
  const sent = seen.puts.filter((p) => p.path.endsWith('/progress')).flatMap((p) => p.items);
  assert.deepEqual(sent.map((p) => [p.key, p.position_s]), [[`${FEED}#${ids[2]}`, 9]]);
  assert.deepEqual(seen.puts.find((p) => p.path.endsWith('/follows')).items.map((f) => [f.feed_url, f.followed]), [[FEED, true], [OTHER, true]]);
  // The app's worker takes over on the next load; then play episode two from its start and pause it.
  // (From its start: the fixture is a few seconds long, so a resume at 0:09 would play to its end.)
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.evaluate((key) => {
    const s = JSON.parse(localStorage.getItem('jarvis.podcasts.v1'));
    s.progress[key] = { ...s.progress[key], position: 0 };
    localStorage.setItem('jarvis.podcasts.v1', JSON.stringify(s));
  }, `${FEED}#${ids[2]}`);
  remote = [];
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page.locator(`[data-feed="${FEED}"]`).first().click();
  await page.locator('.show-actions [data-play]').click();
  // Playing for real, with nothing loading (the status line gone), and well after the sync's
  // listeners are on (they follow the app's, at most 1.5 s after it starts).
  await page.waitForFunction(
    () => {
      const a = /** @type {HTMLAudioElement} */ (document.querySelector('#audio'));
      return !a.paused && a.currentTime > 0.3 && Number.isFinite(a.duration) && a.duration > 1
        && /** @type {HTMLElement} */ (document.querySelector('#playback-status')).hidden && performance.now() > 2500;
    },
    null,
    { timeout: 15_000 },
  );
  seen.puts.length = 0;
  await page.evaluate(() => /** @type {HTMLAudioElement} */ (document.querySelector('#audio')).pause());
  await until(() => seen.puts.some((p) => p.path.endsWith('/progress')));
  const paused = seen.puts.filter((p) => p.path.endsWith('/progress')).flatMap((p) => p.items).find((p) => p.key === `${FEED}#${ids[2]}`);
  assert.ok(paused && paused.position_s > 0 && paused.updated_at > now, JSON.stringify(seen.puts));
  assert.deepEqual([...seen.auth].filter(Boolean), [`Bearer ${TOKEN}`]);
  assert.deepEqual(errors, []);
  await context.close();
});

test('signed out: nothing is asked or sent', opts, async () => {
  seen.gets.length = 0;
  seen.puts.length = 0;
  const { context, page, errors } = await opened(false, () => ({ version: 1, follows: [show], progress: {}, queue: [] }));
  await page.goto(`${base}/podcasts/`, { waitUntil: 'load' });
  await page.locator('#heading').waitFor();
  await new Promise((r) => setTimeout(r, 1500));
  assert.deepEqual([seen.gets, seen.puts], [[], []]);
  assert.deepEqual(errors, []);
  await context.close();
});

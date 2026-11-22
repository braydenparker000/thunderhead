// Nothing on the site reaches the old Worker (MIGRATION.md §8), in Chromium at the live site's https
// address (answered by the local build, so Music's page has its worker as on the phone). Every request
// the pages and their workers make is recorded through: a cold first load with no worker, signed out
// (Music and Podcasts go to the sign-in door; Guitar's source is unavailable; an error report is
// dropped), then signed in: Music on its first load waits for its worker, plays one song and shows one
// cover from a mock new Worker and bucket, and an offline copy made before this change (kept under the
// old Worker's address, its key) still plays; a reload that skipped the worker; Podcasts' first load;
// Guitar's search; a thrown error. Any request to the old origin fails the test. Local only; no network.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { outlast, until } from './fixtures/waits.mjs';

// The workers' own requests go through the context's routes and events too.
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1';
const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (mocked API)' };
const SITE = 'https://thunderhead.z13.web.core.windows.net';
const OLD_HOST = 'jarvis-hub-api.braydenparker999.workers.dev';
const OLD = `https://${OLD_HOST}`;
const API = 'https://api.example.test';
const BUCKET = 'https://bucket.example.test';
const TOKEN = `th1_${'C'.repeat(43)}abcdef`;
const ID = `r2_native_${'f'.repeat(64)}`;
const FEED = 'https://feeds.example.org/invented.xml';
const TONE = readFileSync(new URL('./fixtures/tone.opus', import.meta.url));
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
let site, browser, base;

before(async () => {
  if (live) return;
  site = await serve(0, { api: API });
  base = `http://127.0.0.1:${site.address().port}`;
  browser = await chromium.launch({
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: ['--autoplay-policy=no-user-gesture-required'],
  });
});
after(async () => { await browser?.close(); site?.close(); });

const CATALOG = {
  version: 1, kind: 'r2-library', complete: true, count: 1, generatedAt: '2026-11-20T00:00:00.000Z',
  tracks: [{
    id: ID, sha256: 'f'.repeat(64), size: TONE.length, audioKey: `native/audio/${'f'.repeat(64)}.opus`, coverKey: `native/art/${'f'.repeat(64)}.png`,
    mimeType: 'audio/ogg', path: 'Tone.opus', folder: 'Cloudflare R2/Test',
    r2Identity: { size: TONE.length, etag: 'e1', lastModified: '2026-10-01T00:00:00.000Z' },
    metadata: { title: 'Invented Tone', artist: 'Nobody', dur: 3 },
  }],
};

/** A context at the live site's address, recording every request; the old origin is refused and recorded. */
async function phone() {
  const context = await browser.newContext({ serviceWorkers: 'allow', viewport: { width: 390, height: 844 } });
  const all = [], old = [], api = [];
  // Every request; one the page makes to the old origin and its worker answers never leaves the phone, so what
  // counts is the old origin's route (anything that would leave) and any request a worker itself makes there.
  context.on('request', (r) => all.push(r));
  await context.route(`${SITE}/**`, async (route) => {
    const u = new URL(route.request().url());
    return route.fulfill({ response: await route.fetch({ url: base + u.pathname + u.search }) });
  });
  await context.route(`${OLD}/**`, (route) => { old.push(route.request().url()); return route.abort(); });
  await context.route(`${API}/**`, (route) => {
    const r = route.request(), url = new URL(r.url());
    const cors = { 'Access-Control-Allow-Origin': SITE, 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-None-Match', 'Access-Control-Expose-Headers': 'ETag' };
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    api.push({ path: url.pathname, auth: r.headers().authorization ?? '' });
    const json = (body, status = 200) => route.fulfill({ status, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/v1/music/catalog') return json(CATALOG);
    if (url.pathname === '/v1/media/sign') {
      const { refs } = r.postDataJSON();
      return json({ items: refs.map((ref) => ({ ref, url: `${BUCKET}/${ref.endsWith('#art') ? 'art.png' : 'tone.opus'}?X-Amz-Signature=test`, expires_at: Date.now() + 3_600_000 })), errors: [] });
    }
    if (url.pathname === '/v1/podcasts/directory') return json({ shows: [{ id: '1', title: 'Invented Show', feedUrl: FEED, author: 'Host', artwork: '', genres: [] }] });
    if (url.pathname === '/v1/guitar/search') return json({ results: [{ songId: 7, title: 'Invented Etude', artist: 'Nobody', tracks: [] }] });
    if (r.method() !== 'GET') return route.fulfill({ status: 204, headers: cors });
    return json({ error: { code: 'not_found', message: 'Not found' } }, 404);
  });
  await context.route(`${BUCKET}/**`, (route) => {
    const r = route.request(), cors = { 'Access-Control-Allow-Origin': SITE, 'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges' };
    if (r.url().includes('/art.png')) return route.fulfill({ status: 200, headers: cors, contentType: 'image/png', body: PNG });
    const m = /^bytes=(\d+)-(\d*)$/.exec(r.headers().range ?? '');
    if (!m) return route.fulfill({ status: 200, headers: { ...cors, 'Accept-Ranges': 'bytes' }, contentType: 'audio/ogg', body: TONE });
    const a = Number(m[1]), b = m[2] ? Math.min(Number(m[2]), TONE.length - 1) : TONE.length - 1;
    return route.fulfill({ status: 206, headers: { ...cors, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${a}-${b}/${TONE.length}` }, contentType: 'audio/ogg', body: TONE.subarray(a, b + 1) });
  });
  // Anything else outside (Apple's directory, fonts): refused.
  await context.route(/^https:\/\/(?!thunderhead\.z13|jarvis-hub-api|api\.example\.test|bucket\.example\.test)/, (route) => route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const toOld = () => [...old, ...all.filter((r) => r.serviceWorker() && new URL(r.url()).host === OLD_HOST).map((r) => r.url())];
  return { context, page, api, toOld, errors };
}

const signIn = (page) => page.evaluate((token) => new Promise((resolve, reject) => {
  const req = indexedDB.open('th-auth', 1);
  req.onupgradeneeded = () => req.result.createObjectStore('kv');
  req.onsuccess = () => {
    const tx = req.result.transaction('kv', 'readwrite');
    tx.objectStore('kv').put({ session_id: 's1', token, signed_in_at: Date.now(), username: 'example-owner' }, 'session');
    tx.oncomplete = () => { req.result.close(); resolve(); };
    tx.onerror = () => reject(tx.error);
  };
}), TOKEN);
const boom = (page, words) => page.evaluate((w) => setTimeout(() => { throw new Error(w); }), words);

test('signed out, on a cold first load with no worker: the sign-in door, an unavailable source, a dropped report; nothing to the old Worker', opts, async () => {
  const { context, page, api, toOld } = await phone();
  await page.goto(`${SITE}/music/`);
  await page.waitForURL(`${SITE}/signin/?next=%2Fmusic%2F`);
  await page.goto(`${SITE}/podcasts/`);
  await page.waitForURL(`${SITE}/signin/?next=%2Fpodcasts%2F`);
  await page.goto(`${SITE}/guitar/`, { waitUntil: 'load' });
  const found = await page.evaluate(async () => (await import('/guitar/sources.js')).search('etude', 'songsterr'));
  assert.deepEqual(found, { songsterr: { error: 'The tab source is unavailable. Please try again.' } });
  await boom(page, 'invented boom, signed out');
  await outlast(page, 2500); // a negative read: past the reporter's 2 s batch, on the page's own timers
  await page.goto(`${SITE}/no-such-page`, { waitUntil: 'load' });
  assert.deepEqual(api.filter((c) => c.path === '/v1/ops/errors'), [], 'the report was dropped');
  assert.deepEqual(toOld(), [], 'no request to the old Worker');
  await context.close();
});

test('signed in: Music, Podcasts, Guitar and an error, each from a first load; an old offline copy still plays; nothing to the old Worker', opts, async () => {
  const { context, page, api, toOld, errors } = await phone();
  await page.goto(`${SITE}/no-such-page`);
  await signIn(page);
  // An offline copy kept before this change: under the old Worker's address, its key.
  await page.evaluate(async ([old, id, bytes]) => {
    localStorage.setItem('cp-offline-retired', '1');
    const cache = await caches.open('claude-player-audio');
    await cache.put(`${old}/music/library/audio/${id}`, new Response(new Uint8Array(bytes), { headers: { 'Content-Type': 'audio/ogg' } }));
  }, [OLD, ID, [...TONE]]);

  // Music's first load: no worker yet. The page waits for it, then its library comes through it.
  await page.goto(`${SITE}/music/`);
  await page.waitForFunction(() => window.__cp?.library?.remoteTracks?.length === 1 && !!navigator.serviceWorker.controller, null, { timeout: 30_000 });
  const played = await page.evaluate(async () => {
    const t = window.__cp.library.remoteTracks[0];
    const until = async (ok) => { for (let i = 0; i < 300 && !ok(); i++) await new Promise((r) => setTimeout(r, 50)); };
    // One song, by the player's own address (through its worker, from the bucket).
    const a = new Audio();
    a.crossOrigin = 'anonymous';
    a.src = t.src;
    await a.play();
    await until(() => a.currentTime > 0.2);
    a.pause();
    // One cover.
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = t.artUrl;
    await img.decode();
    // The offline copy, by the same address.
    await window.__cp.ctx.audioCache.ready;
    const local = await window.__cp.ctx.audioCache.open(t.src);
    const b = new Audio(local);
    await b.play();
    await until(() => b.currentTime > 0.2);
    b.pause();
    return { src: t.src, song: a.currentTime, cover: img.naturalWidth, offline: b.currentTime, local: String(local).startsWith('blob:') };
  });
  assert.equal(played.src, `${OLD}/music/library/audio/${ID}`, 'the offline copies’ key is unchanged');
  assert.ok(played.song > 0.2, `the song played (${played.song} s)`);
  assert.equal(played.cover, 1, 'the cover showed');
  assert.ok(played.local && played.offline > 0.2, `the offline copy played (${played.offline} s)`);
  assert.ok(api.some((c) => c.path === '/v1/music/catalog' && c.auth === `Bearer ${TOKEN}`));

  // A reload that skipped the worker (as a hard reload does): the page reloads once more, under it.
  const cdp = await context.newCDPSession(page);
  await cdp.send('Page.reload', { ignoreCache: true });
  await page.waitForFunction(() => window.__cp?.library?.remoteTracks?.length === 1 && !!navigator.serviceWorker.controller, null, { timeout: 30_000 });

  // Podcasts' first load: no worker yet; the page waits for it, then its directory comes through it.
  await page.goto(`${SITE}/podcasts/`);
  await page.locator(`[data-feed="${FEED}"]`).first().waitFor({ timeout: 30_000 });
  assert.ok(api.some((c) => c.path === '/v1/podcasts/directory' && c.auth === `Bearer ${TOKEN}`));

  // Guitar: the new Worker's search; a thrown error goes to the new inbox.
  await page.goto(`${SITE}/guitar/`, { waitUntil: 'load' });
  const found = await page.evaluate(async () => (await import('/guitar/sources.js')).search('etude', 'songsterr'));
  assert.deepEqual(found.songsterr.results.map((r) => r.title), ['Invented Etude']);
  await page.evaluate(() => import('/th/ported/session.js').then((m) => m.sessionToken()));
  await boom(page, 'invented boom, signed in');
  await until(() => api.some((c) => c.path === '/v1/ops/errors'), { message: 'the report reached the new inbox' });

  assert.deepEqual(toOld(), [], 'no request to the old Worker');
  assert.deepEqual(errors.filter((e) => !e.includes('invented boom')), []);
  await context.close();
});

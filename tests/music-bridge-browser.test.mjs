// The player's data move in Chromium (frontend/th/music/bridge.js in the real music/sw.js): with the
// owner signed in, the player's own requests to the old Worker's library URLs are answered from a
// mock new Worker and a mock bucket (with the CORS rule SETUP.md N2 sets). The catalog arrives; an
// <audio> element (crossOrigin, as the player makes it) plays a real Opus file through range
// requests the worker answers; Web Audio hears it (no CORS taint, so the EQ path works); and the
// old Worker is never reached. Local only; no network.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (mocked API)' };
const OLD = 'https://jarvis-hub-api.braydenparker999.workers.dev';
const ID = `r2_native_${'c'.repeat(64)}`;
const TONE = readFileSync(new URL('./fixtures/tone.opus', import.meta.url));
const TOKEN = `th1_${'A'.repeat(43)}abcdef`;
let site, mock, browser, base, api;
const seen = { catalog: 0, revalidated: 0, sign: 0, ranges: [], auth: [], bucketAuth: [] };

before(async () => {
  if (live) return;
  mock = createServer((req, res) => {
    const origin = req.headers.origin ?? '';
    const cors = { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' };
    const url = new URL(req.url, 'http://x');
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...cors, 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-None-Match, Range, If-Range', 'Access-Control-Max-Age': '60' });
      return res.end();
    }
    if (url.pathname === '/v1/music/catalog') {
      seen.catalog++;
      seen.auth.push(req.headers.authorization ?? '');
      if (req.headers['if-none-match'] === '"m1-a"') {
        seen.revalidated++;
        res.writeHead(304, { ...cors, ETag: '"m1-a"', 'Access-Control-Expose-Headers': 'ETag' });
        return res.end();
      }
      const track = {
        id: ID, sha256: 'c'.repeat(64), size: TONE.length, audioKey: `native/audio/${'c'.repeat(64)}.opus`,
        mimeType: 'audio/ogg', path: 'Tone.opus', folder: 'Cloudflare R2/Test',
        r2Identity: { size: TONE.length, etag: 'e1', lastModified: '2026-10-01T00:00:00.000Z' },
        metadata: { title: 'Test Tone', artist: 'Test', dur: 3 },
      };
      res.writeHead(200, { ...cors, 'Content-Type': 'application/json', ETag: '"m1-a"', 'Access-Control-Expose-Headers': 'ETag' });
      return res.end(JSON.stringify({ version: 1, kind: 'r2-library', complete: true, count: 1, generatedAt: '2026-10-29T00:00:00.000Z', tracks: [track] }));
    }
    if (url.pathname === '/v1/media/sign') {
      seen.sign++;
      seen.auth.push(req.headers.authorization ?? '');
      let body = '';
      req.on('data', (d) => (body += d)).on('end', () => {
        const [ref] = JSON.parse(body).refs;
        res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ items: [{ ref, url: `${api}/r2/tone.opus?X-Amz-Signature=test`, expires_at: Date.now() + 3 * 3_600_000 }], errors: [] }));
      });
      return;
    }
    if (url.pathname === '/r2/tone.opus') {
      // The bucket: ranges, and the CORS rule of SETUP.md N2.
      const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '');
      seen.ranges.push(req.headers.range ?? 'none');
      if (req.headers.authorization) seen.bucketAuth.push(req.headers.authorization);
      const head = { ...cors, 'Content-Type': 'audio/ogg', 'Accept-Ranges': 'bytes', ETag: '"e1"', 'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, ETag' };
      if (!range) {
        res.writeHead(200, { ...head, 'Content-Length': String(TONE.length) });
        return res.end(TONE);
      }
      const a = Number(range[1]);
      const b = range[2] ? Math.min(Number(range[2]), TONE.length - 1) : TONE.length - 1;
      res.writeHead(206, { ...head, 'Content-Range': `bytes ${a}-${b}/${TONE.length}`, 'Content-Length': String(b - a + 1) });
      return res.end(TONE.subarray(a, b + 1));
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

test('the player’s library, audio and Web Audio come from the new Worker and the bucket, never the old Worker', opts, async () => {
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  const oldCalls = [];
  await context.route(`${OLD}/**`, (route) => { oldCalls.push(route.request().url()); return route.abort(); });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
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
  await page.goto(`${base}/music/`, { waitUntil: 'load' });
  // The player registers its worker only on https; here the test does, then reloads under it.
  await page.evaluate(async () => { await navigator.serviceWorker.register('/music/sw.js', { scope: '/music/' }); await navigator.serviceWorker.ready; });
  // Before its worker existed, the player asked the old Worker (blocked here); from now on it must not.
  oldCalls.length = 0;
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);

  const catalog = await page.evaluate(async (old) => (await (await fetch(`${old}/music/library.json`, { cache: 'no-cache', credentials: 'omit' })).json()), OLD);
  assert.equal(catalog.tracks[0].metadata.title, 'Test Tone');

  const heard = await page.evaluate(async ([old, id]) => {
    const a = new Audio();
    a.crossOrigin = 'anonymous';
    a.src = `${old}/music/library/audio/${id}`;
    const ctx = new AudioContext();
    const an = ctx.createAnalyser();
    ctx.createMediaElementSource(a).connect(an);
    await ctx.resume();
    await a.play();
    let peak = 0;
    const buf = new Float32Array(an.fftSize);
    for (let i = 0; i < 30 && peak < 0.05; i++) {
      await new Promise((r) => setTimeout(r, 50));
      an.getFloatTimeDomainData(buf);
      for (const v of buf) peak = Math.max(peak, Math.abs(v));
    }
    for (let i = 0; i < 40 && a.currentTime < 0.5; i++) await new Promise((r) => setTimeout(r, 50));
    return { time: a.currentTime, peak, error: a.error?.code ?? null };
  }, [OLD, ID]);
  assert.equal(heard.error, null);
  assert.ok(heard.time > 0.2, `played (${heard.time} s)`);
  assert.ok(heard.peak > 0.05, `Web Audio hears the tone (peak ${heard.peak}): no CORS taint`);

  // The player asks for its library when it starts (and the test once more): the catalog came down
  // once; every later ask of the unchanged catalog cost a 304.
  assert.ok(seen.catalog >= 2, `asked ${seen.catalog} times`);
  assert.equal(seen.catalog - seen.revalidated, 1);
  assert.ok(seen.sign >= 1);
  assert.ok(seen.ranges.some((r) => r.startsWith('bytes=')), `range requests reached the bucket: ${seen.ranges}`);
  assert.deepEqual([...new Set(seen.auth)], [`Bearer ${TOKEN}`], 'the Worker gets the session');
  assert.deepEqual(seen.bucketAuth, [], 'the bucket never does');
  assert.deepEqual(oldCalls, [], 'the old Worker was never reached');
  assert.deepEqual(errors, []);
  await context.close();
});

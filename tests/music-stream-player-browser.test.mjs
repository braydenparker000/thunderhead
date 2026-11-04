// Music's player streams (th/music/stream/deck.js inside music/src/player/player.js; MUSIC.md §5):
// the real music page, its worker and bridge, against a mock new Worker and a mock bucket of 150-second
// Opus tones. A song plays through the stream feed (a MediaSource), never more than about 60 s ahead,
// without fetching the whole file or any byte of it twice (the head kept for the song the app opened
// on serves its start), and the next songs' heads come without an Ogg tail; its length is the
// catalog's before its end; a seek past the buffer
// and a skip work; a stream that gives up plays on from the plain element where it was; switched off
// on the phone, it plays as before. Local only; no network.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { longTone } from './fixtures/ogg-make.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (mocked API)', timeout: 120_000 };
const TOKEN = `th1_${'D'.repeat(43)}abcdef`;
const N = 4;
const SECONDS = 150;
const SONG = longTone(SECONDS / 3);
const hex = (i) => (i + 10).toString(16).repeat(64).slice(0, 64);
const idOf = (i) => `r2_native_${hex(i)}`;
let site, mock, browser, base, api;
/** Byte ranges fetched from the bucket, by song number. */
const fetched = new Map();
const total = (i) => (fetched.get(String(i)) ?? []).reduce((n, [a, b]) => n + b - a + 1, 0);

before(async () => {
  if (live) return;
  mock = createServer((req, res) => {
    const cors = { 'Access-Control-Allow-Origin': req.headers.origin ?? '*', Vary: 'Origin' };
    const url = new URL(req.url, 'http://x');
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...cors, 'Access-Control-Allow-Methods': 'GET, POST, PUT', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-None-Match, Range, If-Range', 'Access-Control-Max-Age': '60' });
      return res.end();
    }
    if (url.pathname === '/v1/music/catalog') {
      const tracks = Array.from({ length: N }, (_, i) => ({
        id: idOf(i), sha256: hex(i), size: SONG.length, coverKey: `native/art/${hex(i)}.jpg`, audioKey: `native/audio/${hex(i)}.opus`, mimeType: 'audio/ogg', path: `Tone ${i}.opus`, folder: 'Cloudflare R2/Test',
        r2Identity: { size: SONG.length, etag: `e${i}`, lastModified: '2026-10-01T00:00:00.000Z' },
        // (Song 2's catalog length is 3 s too long: the stream's own end corrects it.)
        metadata: { title: `Tone ${i}`, artist: `Artist ${i}`, album: 'Album', dur: i === 2 ? SECONDS + 3 : SECONDS, codec: 'opus', sr: 48000 },
      }));
      res.writeHead(200, { ...cors, 'Content-Type': 'application/json', ETag: '"m1-stream"', 'Access-Control-Expose-Headers': 'ETag' });
      return res.end(JSON.stringify({ version: 1, kind: 'r2-library', complete: true, count: N, generatedAt: '2026-10-29T00:00:00.000Z', tracks }));
    }
    if (url.pathname === '/v1/media/sign') {
      let body = '';
      req.on('data', (d) => (body += d)).on('end', () => {
        const { refs } = JSON.parse(body);
        const at = (ref) => Array.from({ length: N }, (_, i) => i).find((i) => ref.startsWith(`music:${idOf(i)}`));
        const items = refs.map((ref) => ({ ref, url: `${api}/r2/${ref.endsWith('#art') ? 'art' : at(ref)}.opus?X-Amz-Signature=test`, expires_at: Date.now() + 3 * 3_600_000 }));
        res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ items, errors: [] }));
      });
      return;
    }
    const m = /^\/r2\/(\d+)\.opus$/.exec(url.pathname);
    if (m) {
      const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '');
      const head = { ...cors, 'Content-Type': 'audio/ogg', 'Accept-Ranges': 'bytes', ETag: `"e${m[1]}"`, 'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, ETag' };
      const a = range ? Number(range[1]) : 0;
      const b = range && range[2] ? Math.min(Number(range[2]), SONG.length - 1) : SONG.length - 1;
      fetched.set(m[1], [...(fetched.get(m[1]) ?? []), [a, b]]);
      if (!range) {
        res.writeHead(200, { ...head, 'Content-Length': String(SONG.length) });
        return res.end(SONG);
      }
      res.writeHead(206, { ...head, 'Content-Range': `bytes ${a}-${b}/${SONG.length}`, 'Content-Length': String(b - a + 1) });
      return res.end(SONG.subarray(a, b + 1));
    }
    res.writeHead(404, cors).end();
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  api = `http://127.0.0.1:${mock.address().port}`;
  site = await serve(0, { api });
  base = `http://127.0.0.1:${site.address().port}`;
  browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--autoplay-policy=no-user-gesture-required'] });
});
after(async () => { await browser?.close(); site?.close(); mock?.close(); });

/** The music page under its worker, signed in, with the tones as its library. */
async function boot({ off = false } = {}) {
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  // Nothing outside this machine (the old Worker the player still names is never reached).
  await context.route(/^https:\/\//, (route) => route.abort());
  const first = await context.newPage();
  await first.goto(`${base}/no-such-page`);
  await first.evaluate(({ token, off }) => new Promise((resolve, reject) => {
    if (off) localStorage.setItem('th.music.stream', 'off');
    const req = indexedDB.open('th-auth', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => {
      const tx = req.result.transaction('kv', 'readwrite');
      tx.objectStore('kv').put({ session_id: 's1', token, signed_in_at: Date.now(), username: 'example-owner' }, 'session');
      tx.oncomplete = () => { req.result.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }), { token: TOKEN, off });
  await first.goto(`${base}/music/`, { waitUntil: 'load' });
  await first.evaluate(async () => { await navigator.serviceWorker.register('/music/sw.js', { scope: '/music/' }); await navigator.serviceWorker.ready; });
  await first.close();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/music/`, { waitUntil: 'load' });
  await page.waitForFunction((n) => !!navigator.serviceWorker.controller && window.__cp?.player?.queue?.length >= n, N, { timeout: 30_000 });
  return { context, page, errors };
}

/** Plays from queue position `from` until it sounds. */
async function playFrom(page, from) {
  await page.evaluate((i) => { const p = __cp.player; p.shuffle = 0; p.repeat = 1; p.order = null; p.load(i, true); }, from);
  await page.waitForFunction(() => { const a = __cp.player.audio; return !a.paused && a.readyState >= 3 && a.currentTime > 1; }, null, { timeout: 30_000 });
}

test('a song streams: at most ~60 s ahead, part of the file, its length known, seek and skip, a give-up plays on', opts, async () => {
  const { context, page, errors } = await boot();
  try {
    await playFrom(page, 0);
    const deck = await page.evaluate(() => { const a = __cp.player.audio; return { blob: a.src.startsWith('blob:'), stream: !!a._stream, duration: a.duration }; });
    const log = deck.stream ? [] : await page.evaluate(() => window.__cp.ctx.playbackLog.events.filter((e) => /stream|stall|reload/.test(e.type)));
    assert.deepEqual(deck, { blob: true, stream: true, duration: SECONDS }, `through the feed, the catalog length from the start ${JSON.stringify(log)}`);
    // While it plays, never much more than 60 s buffered ahead of where it is.
    let most = 0;
    for (let i = 0; i < 12; i++) {
      most = Math.max(most, await page.evaluate(() => { const a = __cp.player.audio, b = a.buffered; let e = a.currentTime; for (let k = 0; k < b.length; k++) if (b.start(k) <= a.currentTime + 0.1) e = Math.max(e, b.end(k)); return e - a.currentTime; }));
      await page.waitForTimeout(250); // one look every 250 ms over 3 s of playing: the window watched, not a wait
    }
    assert.ok(most <= 60.6, `buffered ahead at most ${most.toFixed(2)} s`);
    const playing = await page.evaluate(() => __cp.player.track.id);
    const i0 = [...Array(N).keys()].find((i) => idOf(i) === playing);
    // Part of the file, and no byte of it twice: the head the app kept for the song it opened on
    // serves the stream's first reads (library/heads.js settle).
    assert.ok(total(i0) < SONG.length * 0.75, `fetched ${total(i0)} of ${SONG.length} bytes`);
    const seen = fetched.get(String(i0)) ?? [];
    for (const [k, [a, b]] of seen.entries()) for (const [c, d] of seen.slice(k + 1)) assert.ok(b < c || d < a, `bytes ${a}-${b} and ${c}-${d} both fetched`);
    // The next songs' heads, without the Ogg tail a streamed song doesn't need: only their start.
    for (let i = 0; i < N; i++) if (i !== i0) for (const [a] of fetched.get(String(i)) ?? []) assert.equal(a, 0, `song ${i}: only its head`);

    // A seek past what is buffered: the feed fetches from there.
    await page.evaluate(() => __cp.player.seek(110_000));
    await page.waitForFunction(() => { const a = __cp.player.audio; return a.currentTime >= 110 && a.currentTime < 115 && !a.paused && a.readyState >= 3; }, null, { timeout: 20_000 });
    // A skip: the next song, also streamed.
    await page.evaluate(() => __cp.player.step(1));
    await page.waitForFunction((id) => { const p = __cp.player, a = p.audio; return p.track.id !== id && !a.paused && a.currentTime > 0.5 && a.src.startsWith('blob:'); }, playing, { timeout: 30_000 });

    // A stream that gives up: the song goes on from the plain element where it was.
    await page.waitForFunction(() => __cp.player.audio.currentTime > 3, null, { timeout: 20_000 });
    await page.evaluate(() => __cp.player.audio._stream.feed.dispatchEvent(new CustomEvent('fallback', { detail: { reason: 'test', index: 0, ms: 3000 } })));
    await page.waitForFunction(() => { const a = __cp.player.audio; return !a._stream && !a.src.startsWith('blob:') && !a.paused && a.currentTime >= 2.5; }, null, { timeout: 20_000 });
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('a reload lands where it was, a second seek wins over the first, and the stream corrects the length', opts, async () => {
  const { context, page, errors } = await boot();
  try {
    const at = await page.evaluate((id) => __cp.player.queue.findIndex((t) => t.id === id), idOf(2));
    await playFrom(page, at);
    const place = () => page.evaluate(() => { const a = __cp.player.audio; return { t: a.currentTime, playing: !a.paused && a.readyState >= 3, stream: !!a._stream }; });
    // The stall guard's reload (and a place restored while playing): the new deck starts there, not at 0.
    await page.evaluate(() => __cp.player.reloadAt(20));
    await page.waitForFunction(() => { const a = __cp.player.audio; return !a.paused && a.readyState >= 3 && a.currentTime > 20.2; }, null, { timeout: 20_000 });
    const r = await place();
    assert.ok(r.stream && r.t > 20 && r.t < 27, `after the reload at ${r.t.toFixed(2)} s`);
    // Two seeks past the buffer in a row (a double tap on +10 s, a re-tap on the waveform): the last wins.
    await page.evaluate(() => { __cp.player.seek(100_000); __cp.player.seek(130_000); });
    await page.waitForFunction(() => { const a = __cp.player.audio; return !a.paused && a.readyState >= 3 && a.currentTime > 130.2; }, null, { timeout: 20_000 });
    const s = await place();
    assert.ok(s.t > 130 && s.t < 137, `after two seeks at ${s.t.toFixed(2)} s`);
    // The song's real end has been read: its length is the stream's, not the catalog's 63 s.
    await page.waitForFunction((n) => __cp.player.track.durationMs < (n + 1) * 1000, SECONDS, { timeout: 20_000 });
    const ms = await page.evaluate(() => __cp.player.track.durationMs);
    assert.ok(ms > (SECONDS - 1) * 1000 && ms < (SECONDS + 1) * 1000, `length ${ms} ms`);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('switched off on this phone, songs play from the element as before', opts, async () => {
  const { context, page, errors } = await boot({ off: true });
  try {
    await playFrom(page, 1);
    assert.deepEqual(await page.evaluate(() => { const a = __cp.player.audio; return { blob: a.src.startsWith('blob:'), stream: !!a._stream }; }), { blob: false, stream: false });
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

// A tapped song on a slow connection (MUSIC.md §6.1; music/src/player/sign-ahead.js, library/heads.js):
// the real music page, its worker and bridge, against a mock new Worker and bucket that answer after
// 300 ms and send at most 1.5 Mbps over one shared link (the owner's 3G). The songs list settles and
// its rows' links are signed in one request before any tap; a finger down on a song asks for its link
// before the finger lifts. The timeline (tap → signature → first byte asked → first sound) is printed
// as a diagnostic: it measures the machine as much as the product. Local only; no network.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { longTone } from './fixtures/ogg-make.mjs';
import { until } from './fixtures/waits.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (mocked API)', timeout: 120_000 };
const TOKEN = `th1_${'T'.repeat(43)}abcdef`;
const N = 6;
const SECONDS = 150;
const SONG = longTone(SECONDS / 3);
const RTT = 300, BYTES_S = 1_500_000 / 8;
const hex = (i) => (i + 10).toString(16).repeat(64).slice(0, 64);
const idOf = (i) => `r2_native_${hex(i)}`;
let site, mock, browser, base, api;
/** What the mock saw: {t, kind, refs?, song?, from?}. */
const seen = [];
let linkFree = 0;

/** Sends body in 4 KB pieces over the one shared 1.5 Mbps link. */
async function paced(res, body) {
  for (let at = 0; at < body.length; at += 4096) {
    const piece = body.subarray(at, at + 4096), now = Date.now();
    linkFree = Math.max(now, linkFree) + (piece.length / BYTES_S) * 1000;
    await new Promise((r) => setTimeout(r, Math.max(0, linkFree - now)));
    if (res.destroyed) return;
    res.write(piece);
  }
  res.end();
}

before(async () => {
  if (live) return;
  mock = createServer(async (req, res) => {
    const cors = { 'Access-Control-Allow-Origin': req.headers.origin ?? '*', Vary: 'Origin' };
    const url = new URL(req.url, 'http://x');
    const body = await new Promise((r) => { let b = ''; req.on('data', (d) => (b += d)).on('end', () => r(b)); });
    const t = Date.now();
    await new Promise((r) => setTimeout(r, RTT));
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...cors, 'Access-Control-Allow-Methods': 'GET, POST, PUT', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-None-Match, Range, If-Range', 'Access-Control-Max-Age': '7200' });
      return res.end();
    }
    if (url.pathname === '/v1/music/catalog') {
      const tracks = Array.from({ length: N }, (_, i) => ({
        id: idOf(i), sha256: hex(i), size: SONG.length, audioKey: `native/audio/${hex(i)}.opus`, mimeType: 'audio/ogg', path: `Tone ${i}.opus`, folder: 'Cloudflare R2/Test',
        r2Identity: { size: SONG.length, etag: `e${i}`, lastModified: '2026-10-01T00:00:00.000Z' },
        metadata: { title: `Tone ${i}`, artist: `Artist ${i}`, album: `Album ${i}`, dur: SECONDS, codec: 'opus', sr: 48000 },
      }));
      res.writeHead(200, { ...cors, 'Content-Type': 'application/json', ETag: '"m1-tap"', 'Access-Control-Expose-Headers': 'ETag' });
      return res.end(JSON.stringify({ version: 1, kind: 'r2-library', complete: true, count: N, generatedAt: '2026-10-29T00:00:00.000Z', tracks }));
    }
    if (url.pathname === '/v1/media/sign') {
      const { refs } = JSON.parse(body);
      seen.push({ t, kind: 'sign', refs: refs.map((r) => Array.from({ length: N }, (_, i) => i).findIndex((i) => r.includes(idOf(i)))) });
      const at = (ref) => Array.from({ length: N }, (_, i) => i).find((i) => ref.startsWith(`music:${idOf(i)}`));
      const items = refs.map((ref) => ({ ref, url: `${api}/r2/${at(ref)}.opus?X-Amz-Signature=test`, expires_at: Date.now() + 3 * 3_600_000 }));
      res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ items, errors: [] }));
    }
    const m = /^\/r2\/(\d+)\.opus$/.exec(url.pathname);
    if (m) {
      const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '');
      const a = range ? Number(range[1]) : 0;
      const b = range && range[2] ? Math.min(Number(range[2]), SONG.length - 1) : SONG.length - 1;
      seen.push({ t, kind: 'bytes', song: Number(m[1]), from: a, to: range?.[2] ?? '' });
      res.writeHead(range ? 206 : 200, { ...cors, 'Content-Type': 'audio/ogg', 'Accept-Ranges': 'bytes', ETag: `"e${m[1]}"`, 'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, ETag',
        'Content-Length': String(b - a + 1), ...(range ? { 'Content-Range': `bytes ${a}-${b}/${SONG.length}` } : {}) });
      return paced(res, SONG.subarray(a, b + 1));
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

test('a tapped song: its link is signed while the finger is down, the list\'s rows ahead of any tap', opts, async () => {
  const context = await browser.newContext({ serviceWorkers: 'allow', viewport: { width: 390, height: 844 } });
  await context.route(/^https:\/\//, (route) => route.abort());
  try {
    const first = await context.newPage();
    await first.goto(`${base}/no-such-page`);
    await first.evaluate((token) => new Promise((resolve, reject) => {
      const req = indexedDB.open('th-auth', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => {
        const tx = req.result.transaction('kv', 'readwrite');
        tx.objectStore('kv').put({ session_id: 's1', token, signed_in_at: Date.now(), username: 'example-owner' }, 'session');
        tx.oncomplete = () => { req.result.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    }), TOKEN);
    await first.goto(`${base}/music/`, { waitUntil: 'load' });
    await first.evaluate(async () => { await navigator.serviceWorker.register('/music/sw.js', { scope: '/music/' }); await navigator.serviceWorker.ready; });
    await first.close();
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${base}/music/`, { waitUntil: 'load' });
    await page.waitForFunction((n) => !!navigator.serviceWorker.controller && window.__cp?.player?.queue?.length >= n, N, { timeout: 30_000 });
    await page.evaluate(() => import('/th/music/stream/deck.js').then(() => {}));
    // In the page: each link posted to the worker, each pointer, and the first sound.
    await page.evaluate(() => {
      const w = window, c = navigator.serviceWorker.controller, post = c.postMessage.bind(c);
      w.__posts = [];
      c.postMessage = (m, ...r) => { if (m?.type === 'th-music-ahead') w.__posts.push({ t: Date.now(), urls: m.urls }); return post(m, ...r); };
      w.__ptr = [];
      for (const k of ['pointerdown', 'pointerup']) addEventListener(k, () => w.__ptr.push({ k, t: Date.now() }), true);
      for (const el of w.__cp.player.decks) el.addEventListener('playing', () => { if (el === w.__cp.player.audio) w.__sound ??= { t: Date.now(), id: w.__cp.player.track.id }; });
    });
    await page.evaluate(() => { const p = window.__cp.player; p.shuffle = 0; p.order = null; p.load(3, false); });
    // All songs on screen; the list settles.
    await page.evaluate(async () => {
      const { ctx } = window.__cp;
      const { categorySource } = await import('/music/src/list/sources.js');
      ctx.bus.post('bus_gui', 'cmd_nav_to_lib');
      const lw = ctx.listWidget;
      lw.openHome();
      lw.open(categorySource(ctx, lw.libList, lw.nav, { id: 0, title: 'all_songs', icon: '?all_songs', kind: 'all' }));
    });
    await page.waitForFunction((n) => { const lw = window.__cp.ctx.listWidget; return lw.mode === 'list' && !lw.trans && lw.libList.active.has(n - 1); }, N, { timeout: 15_000 });
    // (The player names its next four songs itself, th/music/dj.js: the list's six are its rows.)
    const listed = await until(() => page.evaluate((n) => window.__posts.find((p) => p.urls.length >= n), N), { message: 'the rows on screen were never signed ahead' });

    // A tap on a song the player does not name among its next ones (th/music/dj.js signs those) and
    // that has no head on the phone: the player stands on song 3, so songs 1 and 2 are neither.
    const at = await page.evaluate(() => {
      const p = window.__cp.player, l = window.__cp.ctx.listWidget.libList, near = new Set([0, 1, 2, 3].map((k) => p.trackAt(k)?.id));
      for (const [i, v] of l.active) {
        const t = i >= 0 && l.source.tracksAt(i)[0];
        const r = v.el.getBoundingClientRect();
        if (t && !near.has(t.id) && r.bottom < innerHeight / 2) return { x: r.left + r.width * 0.4, y: r.top + r.height / 2, id: t.id, src: t.src };
      }
      return null;
    });
    assert.ok(at, 'a song row to tap');
    await page.evaluate(() => { window.__posts.length = 0; });
    seen.length = 0;
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.evaluate(() => new Promise((r) => setTimeout(r, 90)));
    await page.mouse.up();
    await until(() => page.evaluate(() => !!window.__sound), { timeout: 30_000, message: 'the tapped song never sounded' }).catch(async (e) => {
      console.log('# DEBUG', JSON.stringify(at), await page.evaluate(() => JSON.stringify({ id: window.__cp.player.track?.id, state: window.__cp.player.state, ptr: window.__ptr, rows: [...window.__cp.ctx.listWidget.libList.active].map(([i, v]) => [i, Math.round(v.el.getBoundingClientRect().top)]) })));
      throw e;
    });
    const r = await page.evaluate(() => ({ posts: window.__posts, ptr: window.__ptr.slice(-2), sound: window.__sound }));
    const down = r.ptr.find((p) => p.k === 'pointerdown').t, up = r.ptr.find((p) => p.k === 'pointerup').t;
    const song = Array.from({ length: N }, (_, i) => i).find((i) => idOf(i) === at.id);
    const sign = seen.find((s) => s.kind === 'sign' && s.refs.includes(song)), bytes = seen.find((s) => s.kind === 'bytes' && s.song === song);
    console.log(`# timeline (ms after the finger down, ${RTT} ms RTT, 1.5 Mbps): link asked ${r.posts.find((p) => p.urls.includes(at.src)) ? r.posts.find((p) => p.urls.includes(at.src)).t - down : 'before the tap (list settled)'}, ` +
      `signature at the Worker ${sign ? sign.t - down : 'none (signed ahead)'}, finger up ${up - down}, first byte asked at the bucket ${bytes ? bytes.t - down : '?'}, first sound ${r.sound.t - down} (${r.sound.t - up} after the finger up)`);
    console.log(`# tapped song ${song}; at the mock: ${seen.map((s) => `${s.kind}${s.kind === 'bytes' ? ` ${s.song}@${s.from}-${s.to}` : ` [${s.refs}]`} +${s.t - down}`).join(', ')}`);
    assert.equal(r.sound.id, at.id, 'the tapped song sounded');
    // Its link was signed ahead (the list settled) or asked for while the finger was down; never after.
    const asked = r.posts.find((p) => p.urls.includes(at.src));
    assert.ok(listed.urls.includes(at.src) || (asked && asked.t <= up), 'the link was asked for before the finger lifted');
    assert.ok(!sign || !bytes || sign.t <= bytes.t, 'no signature waited on after the first byte');
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

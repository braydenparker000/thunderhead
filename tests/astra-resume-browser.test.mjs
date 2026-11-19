// Continue Watching plays the stream the owner picked, again (frontend/astra/src/app/resume.js, remembered.js,
// screens/home.js; owner ruling 2026-11-19), in the real Astra app with the tests' film host and a stand-in for
// the owner's server (as astra-resolve-browser.test.mjs): a film played from the stream list, then Home, then a tap
// on its card plays it again from where it stopped with no stream list in between, the server asked to play by
// the torrent's hash; a long press offers "Choose another stream", which opens the list; a remembered stream the
// server no longer has and the add-on no longer lists leaves the sources panel open with one plain line and
// nothing playing; an entry from before (no stream remembered) opens the list as it always did. Invented add-on,
// hashes and names; a 150 s film made here with ffmpeg (progress is kept for films over two minutes only). Every DNS
// answer but the local host's is refused: nothing can leave for a real host.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { astraHost } from './fixtures/astra-host.mjs';

const live = Boolean(process.env.SITE_URL);
let ffmpeg = true;
try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { ffmpeg = false; }
const opts = { skip: (live && 'local only (invented add-on and server, synthetic films)') || (!ffmpeg && 'ffmpeg is not installed, so the long film cannot be made'), timeout: 90_000 };
const ADDON = 'https://addon.example';
const TOKEN = 'invented-session-token';
const HASH = '0123456789abcdef0123456789abcdef01234567';
const OTHER = 'fedcba9876543210fedcba9876543210fedcba98';
const FILM = 'Invented.Film.2020.webm';
const json64 = (hash) => Buffer.from(JSON.stringify({ hash, index: 0, title: 'Invented' })).toString('base64url');
const linkOf = (hash, name = FILM) => `${ADDON}/api/v1/debrid/playback/U2VhbGVkSW52ZW50ZWQ/-/${json64(hash)}/tt0000701/${name}`;
const META = { id: 'tt0000701', type: 'movie', name: 'An Invented Film', description: 'Invented for the test.' };
const DIRECT = 'https://cdn.example/7/long.webm';
const GONE_LINE = 'The stream you were watching is no longer offered. Pick another.';
const server = { answer: () => [500, {}], asked: [] };
let site, host, api, browser, base, apiOrigin, dir;

before(async () => {
  if (opts.skip) return;
  dir = mkdtempSync(join(tmpdir(), 'astra-resume-'));
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=96x54:rate=8:duration=150', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=150',
    '-c:v', 'libvpx-vp9', '-b:v', '20k', '-g', '16', '-deadline', 'realtime', '-cpu-used', '8', '-c:a', 'libopus', '-b:a', '12k', join(dir, 'long.webm')]);
  api = createServer((req, res) => {
    const cors = { 'Access-Control-Allow-Origin': req.headers.origin ?? '', Vary: 'Origin' };
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...cors, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' });
      return res.end();
    }
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      if (req.method === 'POST' && req.url === '/v1/astra/play') {
        const asked = JSON.parse(body);
        server.asked.push(asked);
        const [status, out] = server.answer(asked);
        res.writeHead(status, { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        return res.end(JSON.stringify(out));
      }
      res.writeHead(404, { ...cors, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'not_found', message: 'Not found.' } }));
    });
  });
  await new Promise((r) => api.listen(0, '127.0.0.1', r));
  apiOrigin = `http://127.0.0.1:${api.address().port}`;
  site = await serve(0, { api: apiOrigin });
  base = `http://127.0.0.1:${site.address().port}`;
  host = await astraHost({ root: dir + '/' });
  browser = await chromium.launch({ args: ['--no-proxy-server', '--autoplay-policy=no-user-gesture-required', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'], ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
});
after(async () => { await browser?.close(); site?.close(); api?.close(); await host?.close(); if (dir) rmSync(dir, { recursive: true, force: true }); });

// The server: a press (ahead) finds nothing in the account yet; a tap (play) gets the film's address on the film host.
const plays = (asked) => (asked.mode === 'ahead' ? [200, { url: null, steps: [] }] : [200, { url: DIRECT, via: 'torbox', size: 1, type: 'video/webm', readable: true, steps: [] }]);

/** The app at Home, signed in, with the add-on listing `streams()` and the film host routed; `progress` saved beforehand. */
async function app(t, { streams = () => [{ name: 'AIO 360p', title: 'Invented VP9', url: linkOf(HASH), behaviorHints: { filename: FILM, videoSize: 400_000, bingeGroup: 'invented-group' } }], progress = null } = {}) {
  host.reset();
  server.asked = [];
  const seen = { streams: 0, elsewhere: [] };
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  t.after(() => context.close());
  const json = (route, v) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(v) });
  await context.route((url) => !/^(http:\/\/127\.0\.0\.1|https:\/\/(addon\.example|cdn\.example)\/)/.test(url.href), (route) => { seen.elsewhere.push(new URL(route.request().url()).host); return route.abort(); });
  for (const known of ['https://v3-cinemeta.strem.io/**', 'https://opensubtitles-v3.strem.io/**']) await context.route(known, (route) => route.fulfill({ status: 404, body: '' }));
  await context.route(`${ADDON}/**`, async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === '/manifest.json') return json(route, { id: 'example', name: 'Example', version: '1.0.0', resources: ['meta', 'stream'], types: ['movie'], idPrefixes: ['tt'], catalogs: [] });
    if (u.pathname.startsWith('/meta/movie/')) return json(route, { meta: META });
    if (u.pathname.startsWith('/stream/')) { seen.streams++; return json(route, { streams: streams() }); }
    return route.fulfill({ status: 404, body: '' }); // the add-on's own links are never followed here
  });
  await context.route(/^https:\/\/cdn\.example\//, async (route) => route.fulfill({ response: await route.fetch({ url: host.url(new URL(route.request().url()).pathname.split('/').pop()) }) }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/astra/`);
  await page.evaluate(([url, token, progress]) => new Promise((resolve, reject) => {
    localStorage.setItem('astra.v2.addons', JSON.stringify([{ url: `${url}/manifest.json`, enabled: true, name: 'Example' }]));
    localStorage.setItem('astra.v2.player', JSON.stringify({ dataSaver: 'never' }));
    if (progress) localStorage.setItem('astra.v2.progress', JSON.stringify(progress));
    const req = indexedDB.open('th-auth', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => {
      const tx = req.result.transaction('kv', 'readwrite');
      tx.objectStore('kv').put({ session_id: 's1', token, signed_in_at: Date.now(), username: 'example-owner' }, 'session');
      tx.oncomplete = () => { req.result.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }), [ADDON, TOKEN, progress]);
  await page.goto(`${base}/astra/`);
  await page.waitForFunction(() => window.astra?.openStreams);
  const card = () => page.locator('.cw-card').first();
  return { page, errors, seen, card };
}

const playingAt = (page, at, timeout = 20_000) => page.waitForFunction((at) => { const p = window.astra.player; return p?.isOpen && p.firstFrame && p.video.currentTime > at; }, at, { timeout });
const saved = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('astra.v2.progress') || '{}')['movie:tt0000701|tt0000701'] ?? null);

test('played from the list, then Home: a tap on the card plays the same stream from where it stopped, with no stream list, asked to play by hash', opts, async (t) => {
  server.answer = plays;
  const a = await app(t);
  await a.page.evaluate((meta) => window.astra.openStreams(meta), META);
  await a.page.locator('.screen.streams .stream-card', { hasText: 'AIO 360p' }).click(); // the add-on's name line, kept on a designed card
  await playingAt(a.page, 4);
  await a.page.evaluate(() => window.astra.player.close());
  const entry = await saved(a.page);
  assert.ok(entry?.time > 4, `the place is kept (${entry?.time})`);
  assert.deepEqual(entry.stream, { link: linkOf(HASH), hash: HASH, fileIdx: 0, file: FILM, size: 400_000, group: 'invented-group', addon: 'Example', label: 'Example AIO 360p' });
  // Another visit (the addresses this one kept are gone with the page), at Home.
  await a.page.reload();
  await a.page.waitForFunction(() => window.astra?.openStreams);
  await a.card().waitFor();
  server.asked = [];
  const listed = a.seen.streams;
  await a.page.evaluate(() => { window.tapAt = performance.now(); });
  await a.card().click();
  await playingAt(a.page, entry.time - 0.5);
  const r = await a.page.evaluate(() => { const p = window.astra.player; return { ms: Math.round(performance.now() - window.tapAt), from: p.loadedFrom, url: p.engine.url, stack: window.astra.stack.length, sources: p.sources.length, via: p.viaEl.textContent }; });
  t.diagnostic(`tap to playing past the saved place: ${r.ms} ms (stubbed server, local film host)`);
  assert.equal(r.stack, 0, 'no stream list in between');
  assert.ok(Math.abs(r.from - entry.time) < 0.01, `started where it stopped (${r.from} vs ${entry.time})`);
  assert.equal(r.url, DIRECT);
  assert.equal(r.via, 'Via Example AIO 360p');
  const play = server.asked.find((b) => b.mode === 'play');
  assert.ok(play, `asked to play (${server.asked.map((b) => b.mode)})`);
  assert.equal(play.hash, HASH);
  assert.equal(play.fileIndex, 0);
  // The streams were collected behind the player, for its Sources panel; the film went on.
  await a.page.waitForFunction((n) => window.astra.player.sources.length >= 1 && document.querySelector('.ap [aria-label="Sources"]'), listed);
  assert.ok(a.seen.streams > listed, 'the title’s streams were asked again behind the player');
  assert.equal(await a.page.evaluate(() => window.astra.player.engine.url), DIRECT, 'what plays was not disturbed');
  assert.deepEqual(a.seen.elsewhere, []);
  assert.deepEqual(a.errors, []);
});

const remembered = (hash, extra = {}) => ({ 'movie:tt0000701|tt0000701': { type: 'movie', id: META.id, videoId: META.id, season: null, episode: null, time: 45, duration: 150, updated: 1, completed: false,
  meta: { id: META.id, type: 'movie', name: META.name }, ...(hash ? { stream: { link: linkOf(hash, 'Gone.Film.webm'), hash, fileIdx: 0, file: 'Gone.Film.webm', group: 'gone-group', addon: 'Example', label: 'Example Gone' } } : {}), ...extra } });

test('a long press offers "Choose another stream" first, and it opens the stream list at the saved place', opts, async (t) => {
  server.answer = plays;
  const a = await app(t, { progress: remembered(OTHER) });
  await a.card().waitFor();
  await a.card().dispatchEvent('contextmenu');
  const items = await a.page.locator('.lift .lift-item').allTextContents();
  assert.deepEqual(items, ['Choose another stream', 'Go to details', 'Start from beginning', 'Remove']);
  await a.page.locator('.lift .lift-item', { hasText: 'Choose another stream' }).click();
  await a.page.waitForSelector('.screen.streams .stream-card');
  assert.match(await a.page.locator('.screen.streams .resume-pill').textContent(), /Resume from 0:45/);
  assert.equal(await a.page.evaluate(() => !!window.astra.player?.isOpen), false, 'nothing plays');
  assert.deepEqual(a.errors, []);
});

test('the remembered stream is gone (not on TorBox, no longer listed): the sources panel with one plain line, nothing playing', opts, async (t) => {
  server.answer = (asked) => (asked.mode === 'ahead' ? [200, { url: null, steps: [] }]
    : [503, { error: { code: 'unavailable', message: 'Fixed.', details: { reason: 'This film is not on TorBox yet, so Astra did not start it.', steps: [] }, request_id: 'r1' } }]);
  const a = await app(t, { progress: remembered(OTHER) });
  await a.card().click();
  await a.page.waitForFunction(() => { const p = window.astra.player; return p?.isOpen && !p.panel.hidden && p.menus.panelName === 'sources'; }, null, { timeout: 20_000 });
  const r = await a.page.evaluate(() => { const p = window.astra.player; return { line: p.loadingStatus.textContent, stream: p.stream, url: p.engine.url ?? null, paused: p.video.paused, rows: [...p.panel.querySelectorAll('.ap-source b')].map((b) => b.textContent), error: !p.errorCard.hidden }; });
  if (process.env.ASTRA_SHOTS) await a.page.screenshot({ path: `${process.env.ASTRA_SHOTS}/resume-gone.png` });
  assert.equal(r.line, GONE_LINE);
  assert.equal(r.stream, null, 'nothing loading');
  assert.equal(r.error, false);
  assert.ok(r.paused);
  assert.deepEqual(r.rows, ['Example · AIO 360p'], 'the streams offered now, for the owner to pick; none picked for them');
  assert.equal(server.asked.find((b) => b.mode === 'play')?.hash, OTHER, 'the remembered torrent was asked for');
  assert.equal(server.asked.filter((b) => b.mode === 'play').length, 1, 'and nothing else');
  assert.deepEqual(a.errors, []);
});

test('an entry from before (no stream remembered) opens the stream list, as it always did', opts, async (t) => {
  server.answer = plays;
  const a = await app(t, { progress: remembered(null) });
  await a.card().click();
  await a.page.waitForSelector('.screen.streams .stream-card');
  assert.equal(await a.page.evaluate(() => !!window.astra.player?.isOpen), false);
  assert.deepEqual(server.asked.filter((b) => b.mode === 'play'), []);
  assert.deepEqual(a.errors, []);
});



// A film's address from the owner's own server, in the real Astra app (frontend/astra/src/addons/debrid.js,
// worker-api.js, app/playing.js, player/address.js): a stand-in for the Worker on another port answers
// POST /v1/astra/play, the page is signed in as the site keeps it (IndexedDB th-auth), and an invented add-on
// lists an AIOStreams-shaped link. Answered with an address on the film host, a tap plays in Astra's own mode from
// there, the add-on's link untouched, and Stream info says "From TorBox directly". Answered with an error, the
// film still plays through the add-on's link (a host a page cannot read, so in Chrome's own player) and the
// server's reason is the notice and Stream info's line. Signed out, nothing reaches the server and the add-on's
// link plays as before. The playback report copied from Stream info and from the error card holds the file's own
// words but no address, host, hash, key, token, add-on setting or the film's file name (owner ruling 2026-11-19),
// though the film came from an invented tokened address. Every DNS answer but the local
// host's is refused: nothing can leave for a real host.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { astraHost } from './fixtures/astra-host.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (invented add-on and server, synthetic films)', timeout: 60_000 };
const ADDON = 'https://addon.example';
const TOKEN = 'invented-session-token';
const HASH = '0123456789abcdef0123456789abcdef01234567';
const FILM = 'Invented.Film.2020.webm';
const json64 = Buffer.from(JSON.stringify({ hash: HASH, index: 0, sources: [], title: 'Invented' })).toString('base64url');
const LINK = `${ADDON}/api/v1/debrid/playback/U2VhbGVkSW52ZW50ZWQ/-/${json64}/tt0000501/${FILM}`;
const META = { id: 'tt0000501', type: 'movie', name: 'An Invented Film', description: 'Invented for the test.' };
const DIRECT = 'https://cdn.example/7/open.webm';
const server = { answer: () => [500, {}], asked: [] };
let site, host, api, browser, base, apiOrigin;

before(async () => {
  if (live) return;
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
        server.asked.push({ auth: req.headers.authorization, body: asked });
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
  host = await astraHost();
  browser = await chromium.launch({ args: ['--no-proxy-server', '--autoplay-policy=no-user-gesture-required', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'], ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
});
after(async () => { await browser?.close(); site?.close(); api?.close(); await host?.close(); });

/** The app, signed in or not, with the add-on and the film host routed; `seen` counts what each was asked. */
async function app(t, { signedIn = true, addonReadable = true } = {}) {
  host.reset();
  server.asked = [];
  const seen = { link: 0, films: 0, elsewhere: [] };
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  t.after(() => context.close());
  const json = (route, v) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(v) });
  await context.route((url) => !/^(http:\/\/127\.0\.0\.1|https:\/\/(addon\.example|cdn\.example|[a-z0-9-]+\.latm\.tb-cdn\.example)\/)/.test(url.href), (route) => { seen.elsewhere.push(new URL(route.request().url()).host); return route.abort(); });
  for (const known of ['https://v3-cinemeta.strem.io/**', 'https://opensubtitles-v3.strem.io/**']) await context.route(known, (route) => route.fulfill({ status: 404, body: '' }));
  await context.route(`${ADDON}/**`, async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === '/manifest.json') return json(route, { id: 'example', name: 'Example', version: '1.0.0', resources: ['meta', 'stream'], types: ['movie'], idPrefixes: ['tt'], catalogs: [] });
    if (u.pathname.startsWith('/meta/movie/')) return json(route, { meta: META });
    if (u.pathname.startsWith('/stream/')) return json(route, { streams: [{ name: 'AIO 360p', title: 'Invented VP9 Opus', url: LINK, behaviorHints: { filename: FILM, videoSize: 400_000 } }] });
    // The add-on's own link forwards to the film (as AIOStreams' answers 307): to a host a page may read, or one it
    // may not (TorBox's API, behind a real one, is not).
    if (u.pathname.startsWith('/api/v1/debrid/playback/')) {
      seen.link++;
      return route.fulfill({ status: 307, headers: { Location: host.url('open.webm') + (addonReadable ? '' : '?nocors'), 'Access-Control-Allow-Origin': '*' } });
    }
    return route.fulfill({ status: 404, body: '' });
  });
  await context.route(/^https:\/\/(cdn\.example|[a-z0-9-]+\.latm\.tb-cdn\.example)\//, async (route) => {
    seen.films++;
    return route.fulfill({ response: await route.fetch({ url: host.url(new URL(route.request().url()).pathname.split('/').pop()) }) });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && /Content Security Policy|Refused/i.test(m.text())) errors.push(m.text()); });
  await context.addInitScript(() => { window.copied = null; Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (text) => { window.copied = text; } } }); });
  await page.goto(`${base}/astra/`);
  await page.evaluate(([url, token, signedIn]) => new Promise((resolve, reject) => {
    localStorage.setItem('astra.v2.addons', JSON.stringify([{ url: `${url}/manifest.json`, enabled: true, name: 'Example' }]));
    localStorage.setItem('astra.v2.player', JSON.stringify({ dataSaver: 'never' }));
    if (!signedIn) return resolve();
    const req = indexedDB.open('th-auth', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => {
      const tx = req.result.transaction('kv', 'readwrite');
      tx.objectStore('kv').put({ session_id: 's1', token, signed_in_at: Date.now(), username: 'example-owner' }, 'session');
      tx.oncomplete = () => { req.result.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }), [ADDON, TOKEN, signedIn]);
  await page.goto(`${base}/astra/`);
  await page.waitForFunction(() => window.astra?.openStreams);
  await page.evaluate((meta) => window.astra.openStreams(meta), META);
  await page.waitForSelector('.screen.streams .stream-card');
  const tap = () => page.locator('.screen.streams .stream-card', { hasText: 'Invented VP9' }).click();
  /** Stream info's line for the address, read from the menu itself. */
  const addressLine = async (shot = '') => {
    await page.evaluate(() => document.querySelector('.ap [aria-label="Stream info"]').click());
    const line = await page.evaluate(() => { const dt = [...document.querySelectorAll('.ap .ap-info dt')].find((d) => d.textContent === 'Address'); return dt?.nextElementSibling.textContent ?? null; });
    if (shot && process.env.ASTRA_SHOTS) await page.screenshot({ path: `${process.env.ASTRA_SHOTS}/${shot}.png` });
    await page.evaluate(() => window.astra.player.menus.dismiss());
    return line;
  };
  return { page, errors, seen, tap, addressLine };
}

test('the server answers an address on the film host: the tap plays it in Astra’s own mode, and Stream info says "From TorBox directly"', opts, async (t) => {
  server.answer = () => [200, { url: DIRECT, via: 'torbox', size: 400_000, type: 'video/webm', readable: true, steps: [{ step: 'cached', ok: true, ms: 30 }, { step: 'link', ok: true, ms: 80 }] }];
  const a = await app(t);
  await a.page.waitForFunction((o) => document.head.querySelector(`link[rel="preconnect"][href="${o}"]`), apiOrigin);
  assert.equal(server.asked.length, 0, 'listing opens a connection and asks nothing');
  await a.tap();
  await a.page.waitForFunction(() => { const p = window.astra.player; return p?.isOpen && p.ready && p.video.currentTime > 0.3; }, null, { timeout: 20_000 });
  const played = await a.page.evaluate(() => ({ mode: window.astra.player.engine.mode, url: window.astra.player.engine.url, answer: window.astra.playing.answer }));
  assert.ok(!['native', 'unsupported'].includes(played.mode), `Astra's own player (${played.mode})`);
  assert.equal(played.url, DIRECT);
  assert.deepEqual([played.answer.via, played.answer.reason, played.answer.steps.length], ['torbox', null, 2]);
  assert.ok(a.seen.films > 0);
  assert.equal(a.seen.link, 0, 'the add-on’s own link was never opened');
  // Asked once, as the finger came down (ahead: nothing added), with the session and what the link says; the tap took it.
  assert.deepEqual(server.asked.map((r) => [r.auth, r.body.mode]), [[`Bearer ${TOKEN}`, 'ahead']]);
  assert.deepEqual(server.asked[0].body, { link: LINK, mode: 'ahead', hash: HASH, fileIndex: 0, fileName: FILM, fileSize: 400_000 });
  assert.equal(await a.addressLine('resolve-torbox'), 'From TorBox directly');
  // The stream carries its own renewal down to the engine's reader: asked, it asks the server afresh, to play.
  const renewal = await a.page.evaluate(async () => { const p = window.astra.player; return { reader: typeof p.engine.source?.renew, url: await p.stream.renew() }; });
  assert.deepEqual(renewal, { reader: 'function', url: DIRECT });
  assert.deepEqual(server.asked.map((r) => r.body.mode), ['ahead', 'play'], 'a renewal is a fresh ask, never the kept answer');
  assert.deepEqual(a.seen.elsewhere, []);
  assert.deepEqual(a.errors, []);
});

test('the server answers an error: the film plays through the add-on’s link, and its reason is the notice and Stream info’s line', opts, async (t) => {
  const reason = 'TorBox is not set up on your server yet.';
  server.answer = () => [502, { error: { code: 'upstream', message: 'Fixed.', details: { reason, steps: [{ step: 'key', ok: false, ms: 1 }] }, request_id: 'r1' } }];
  const a = await app(t, { addonReadable: false });
  await a.tap();
  await a.page.waitForFunction(() => { const p = window.astra.player; return p?.isOpen && p.engine.mode === 'native' && p.video.currentTime > 0.3; }, null, { timeout: 20_000 });
  const notice = await a.page.evaluate(() => { const n = window.astra.player.noticeEl; return n.hidden ? null : n.querySelector('span').textContent; });
  if (process.env.ASTRA_SHOTS) await a.page.screenshot({ path: `${process.env.ASTRA_SHOTS}/resolve-notice.png` });
  assert.equal(notice, `${reason} So Chrome plays the add-on’s link as it is: no audio track choice and no built-in subtitles.`);
  assert.ok(a.seen.link > 0, 'played from the add-on’s link');
  assert.ok(server.asked.some((r) => r.body.mode === 'play'), 'the tap asked to play');
  assert.equal(await a.addressLine('resolve-addon'), reason);
  assert.deepEqual(a.seen.elsewhere, []);
  assert.deepEqual(a.errors, []);
});

test('the server says the film is not on TorBox yet: nothing is opened, the add-on’s link least of all, and the player says why', opts, async (t) => {
  const reason = 'This film is not on TorBox yet, so Astra did not start it.';
  // A press gets no address (nothing is added before a tap); the tap is told the film is not there.
  server.answer = (asked) => (asked.mode === 'ahead'
    ? [200, { url: null, via: null, size: null, type: null, readable: null, steps: [{ step: 'cached', ok: false, ms: 20 }] }]
    : [503, { error: { code: 'unavailable', message: 'Fixed.', details: { reason, steps: [{ step: 'cached', ok: false, ms: 20 }] }, request_id: 'r2' } }]);
  const a = await app(t, { addonReadable: false });
  await a.tap();
  await a.page.waitForFunction(() => { const p = window.astra.player; return p?.isOpen && !p.errorCard.hidden; }, null, { timeout: 20_000 });
  const card = await a.page.evaluate(() => { const p = window.astra.player; return { text: p.errorCard.querySelector('p').textContent, buttons: [...p.errorCard.querySelectorAll('button')].map((b) => b.textContent), spinning: !p.loaderEl?.hidden && p.loaderEl != null, mode: p.engine.mode, answer: window.astra.playing.answer.via }; });
  if (process.env.ASTRA_SHOTS) await a.page.screenshot({ path: `${process.env.ASTRA_SHOTS}/resolve-not-on-torbox.png` });
  assert.equal(card.text, reason);
  assert.ok(!/\bnull\b|undefined/.test(await a.page.evaluate(() => window.astra.player.errorCard.textContent)), 'no stray word in the card');
  assert.equal(card.answer, 'none');
  assert.ok(!card.buttons.includes('Try again') && card.buttons.includes('Close'), `no retry that would open the link (${card.buttons})`);
  assert.equal(a.seen.link, 0, 'the add-on’s own link was never opened: opening it is what starts a download on TorBox');
  assert.equal(a.seen.films, 0);
  assert.equal(server.asked.at(-1).body.mode, 'play', 'the tap asked to play');
  // The card's report says the film never opened, and why, with no address in it.
  await a.page.locator('.ap-error-actions button', { hasText: 'Copy report' }).click();
  await a.page.waitForFunction(() => window.copied);
  const text = await a.page.evaluate(() => window.copied);
  assert.match(text, /\nThe film was not opened\.\nAddress: none: not on TorBox yet: This film is not on TorBox yet, so Astra did not start it\.\n {4}cached ✗ 20 ms\n/);
  for (const secret of SECRETS(LINK)) assert.ok(!text.includes(secret), `the report holds ${secret}`);
  assert.deepEqual(a.seen.elsewhere, []);
  assert.deepEqual(a.errors, []);
});

/** What a copied report may never hold: the addresses, the torrent, the film's name, the session, the add-on's setting. */
const SECRETS = (film) => [film, new URL(film).host, 'tb-cdn', 'tok_Invented', 'invented-film-token', LINK, HASH, FILM, 'Invented.Film', 'open.webm', 'addon.example', '127.0.0.1', 'cdn.example', TOKEN, json64, 'U2VhbGVk'];

test('the playback report from Stream info and from the error card: where the time went and how the address was found, no address in it', opts, async (t) => {
  const FILM_URL = 'https://store-7.latm.tb-cdn.example/dl/tok_Invented0123456789abcdefABCDEF/open.webm?token=invented-film-token';
  server.answer = () => [200, { url: FILM_URL, via: 'torbox', size: 400_000, type: 'video/webm', readable: true, ready: false, total_ms: 1407,
    steps: [{ step: 'key', ok: true, ms: 0 }, { step: 'cached', ok: true, ms: 300 }, { step: 'add', ok: true, ms: 1000, note: 'TorBox said it added it to your account now.' }, { step: 'link', ok: true, ms: 400, note: "The address is on a TorBox file server, came straight from TorBox, and carries your account's token." }] }];
  const a = await app(t);
  await a.tap();
  await a.page.waitForFunction(() => { const p = window.astra.player; return p?.isOpen && p.ready && p.firstFrame && p.video.currentTime > 0.3; }, null, { timeout: 20_000 });
  await a.page.evaluate(() => document.querySelector('.ap [aria-label="Stream info"]').click());
  const button = a.page.locator('.ap .ap-copy-report');
  if (process.env.ASTRA_SHOTS) await a.page.screenshot({ path: `${process.env.ASTRA_SHOTS}/report-info.png` });
  await button.click();
  await a.page.waitForFunction(() => window.copied);
  assert.equal(await button.textContent(), 'Report copied');
  const text = await a.page.evaluate(() => window.copied);
  assert.match(text, /^Astra playback report, /);
  assert.match(text, /\nHow it plays: \w+/);
  assert.match(text, /\nWhere the time went \(since the film’s load\):\n {4}opened: \d+ ms/);
  assert.match(text, /\n {4}first picture: \d+ ms/);
  assert.match(text, /\nAddress: from TorBox directly\n {4}your server’s own time: 1407 ms\n {4}key ✓ 0 ms\n {4}cached ✓ 300 ms\n {4}add ✓ 1000 ms: TorBox said/);
  assert.match(text, /\nServer: TorBox group latm\n/);
  assert.match(text, /\nStalls so far: 0;/);
  assert.match(text, /\nTracks:\n {4}picture: /);
  assert.match(text, /\n {4}sound 1 \(playing\): .*language /, 'each sound as the file gives it');
  assert.match(text, /\nChapters: \d+\n/);
  if (process.env.ASTRA_SHOTS) await import('node:fs').then((fs) => fs.writeFileSync(`${process.env.ASTRA_SHOTS}/report.txt`, text));
  assert.match(text, /\nThis phone:\n {4}decodes H\.264 /);
  for (const secret of SECRETS(FILM_URL)) assert.ok(!text.includes(secret), `Stream info's report holds ${secret}`);
  // The error card's "Copy report" is the same report.
  await a.page.evaluate(() => { window.copied = null; window.astra.player.menus.dismiss(); window.astra.player.loader.showError('Invented stop.'); });
  await a.page.locator('.ap-error-actions button', { hasText: 'Copy report' }).click();
  await a.page.waitForFunction(() => window.copied);
  const card = await a.page.evaluate(() => window.copied);
  assert.match(card, /\nWhere the time went[\s\S]*\nAddress: from TorBox directly\n/);
  for (const secret of SECRETS(FILM_URL)) assert.ok(!card.includes(secret), `the error card's report holds ${secret}`);
  assert.deepEqual(a.seen.elsewhere, []);
  assert.deepEqual(a.errors, []);
});

test('signed out: nothing reaches the server and the add-on’s link plays as before', opts, async (t) => {
  server.answer = () => [200, { url: DIRECT, via: 'torbox', steps: [] }];
  const a = await app(t, { signedIn: false });
  await a.tap();
  await a.page.waitForFunction(() => { const p = window.astra.player; return p?.isOpen && p.ready && p.video.currentTime > 0.3; }, null, { timeout: 20_000 });
  assert.equal(await a.page.evaluate(() => window.astra.player.engine.url), LINK);
  assert.deepEqual(server.asked, []);
  assert.equal(await a.page.evaluate(() => document.head.querySelectorAll('link[rel="preconnect"]').length), 0, 'no connection opened');
  assert.equal(await a.addressLine(), 'Through the add-on’s link');
  // Reading the session never created the sign-in's database.
  assert.equal(await a.page.evaluate(async () => (await indexedDB.databases()).some((d) => d.name === 'th-auth')), false);
  assert.deepEqual(a.errors, []);
});

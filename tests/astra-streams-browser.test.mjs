// The Streams screen in the real Astra app at phone size (390x844): the torrent's hash is not shown on a card
// though a press still sends it to the owner's server (addons/stream-text.js, link-facts.js); each card carries
// at most one quiet note on how it will play on this phone (addons/stream-note.js), with the owner's phone and
// with a browser that decodes everything given as decodingInfo answers; nothing is reordered or hidden by a note;
// and a list of 300 streams is drawn in slices, in order, every card answering a press. An invented add-on is
// answered by route interception and a stand-in for the owner's server listens on another port; every DNS answer
// but the local host's is refused, so nothing can reach a real host.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (invented add-on and server)', timeout: 60_000 };
const ADDON = 'https://addon.example';
const HASH = (n) => n.toString(16).padStart(40, 'c'); // invented
const META = { id: 'tt0000501', type: 'movie', name: 'An Invented Film', runtime: '118 min' };
const torrentio = (n) => `${ADDON}/resolve/torbox/invented-key/${HASH(n)}/null/0/Film.mkv`;
const hashless = (n) => `${ADDON}/api/v1/debrid/playback/sealed${n}/-/eyJpZCI6MX0/${n}/Film.mkv`;
const STREAMS = [
  { name: 'AIO\n2160p', description: `📺 2160p · HDR10 · HEVC\n💾 14.2 GB · ⚡ Ready (TB)\n${HASH(1)}`, url: torrentio(1) },
  { name: 'AIO\n1080p', description: `📺 1080p · x264 · AAC\n💾 2.1 GB · ⚡ Ready (TB)\n🔗 ${HASH(2).toUpperCase()}`, url: hashless(2) },
  { name: 'AIO\n1080p', description: '📺 1080p · x264 · AAC\n💾 1.9 GB · ⚡ Ready (TB)', url: hashless(3) },
  { name: 'AIO\n720p', description: `📺 720p · HEVC · AAC | btih:${HASH(4)} | 💾 900 MB`, url: torrentio(4) },
];
const body = new Map(); // hash -> what the server was asked, by mode
/** What the server was asked for this hash, once it has been (within a few seconds). */
async function asked(hash) {
  for (let i = 0; i < 50 && !body.has(hash); i++) await new Promise((r) => setTimeout(r, 100));
  return body.get(hash);
}
let site, api, browser, base;

before(async () => {
  if (live) return;
  api = createServer((req, res) => {
    const cors = { 'Access-Control-Allow-Origin': req.headers.origin ?? '', Vary: 'Origin' };
    if (req.method === 'OPTIONS') { res.writeHead(204, { ...cors, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' }); return res.end(); }
    let text = '';
    req.on('data', (c) => { text += c; });
    req.on('end', () => {
      if (req.method !== 'POST' || req.url !== '/v1/astra/play') { res.writeHead(404, cors); return res.end(); }
      const b = JSON.parse(text);
      body.set(b.hash ?? b.link, b.mode);
      res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ url: null, via: null, size: null, type: null, readable: null, steps: [{ step: 'key', ok: true, ms: 1 }] }));
    });
  });
  await new Promise((r) => api.listen(0, '127.0.0.1', r));
  site = await serve(0, { api: `http://127.0.0.1:${api.address().port}` });
  base = `http://127.0.0.1:${site.address().port}`;
  browser = await chromium.launch({ args: ['--no-proxy-server', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'], ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
});
after(async () => { await browser?.close(); site?.close(); api?.close(); });

/** The app at phone size, signed in, its browser answering decodingInfo as `report` says (by codec string). */
async function app(t, { report, streams = STREAMS }) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  t.after(() => context.close());
  await context.addInitScript(`(() => {
    const report = ${report};
    const mc = navigator.mediaCapabilities;
    mc.decodingInfo = async (c) => report(c.video.contentType);
    // How many cards each frame showed (the list is drawn in slices).
    const counts = window.cardsByFrame = [];
    const look = () => { const n = document.querySelectorAll('.screen.streams .stream-card').length; if (n !== counts.at(-1)) counts.push(n); requestAnimationFrame(look); };
    requestAnimationFrame(look);
  })()`);
  const json = (route, v) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(v) });
  await context.route((url) => !/^(http:\/\/127\.0\.0\.1|https:\/\/addon\.example\/)/.test(url.href), (route) => route.abort());
  await context.route(`${ADDON}/**`, (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === '/manifest.json') return json(route, { id: 'example', name: 'Example', version: '1.0.0', resources: ['stream'], types: ['movie'], idPrefixes: ['tt'], catalogs: [] });
    if (u.pathname.startsWith('/stream/')) return json(route, { streams });
    return route.fulfill({ status: 404, body: '' });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/astra/`);
  await page.evaluate((url) => new Promise((resolve, reject) => {
    localStorage.setItem('astra.v2.addons', JSON.stringify([{ url: `${url}/manifest.json`, enabled: true, name: 'Example' }]));
    localStorage.setItem('astra.v2.settings', JSON.stringify({ hero: false }));
    localStorage.setItem('astra.v2.player', JSON.stringify({ dataSaver: 'never' }));
    const req = indexedDB.open('th-auth', 1); // signed in, as the site keeps it
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => {
      const tx = req.result.transaction('kv', 'readwrite');
      tx.objectStore('kv').put({ session_id: 's1', token: 'invented-session-token', signed_in_at: Date.now(), username: 'example-owner' }, 'session');
      tx.oncomplete = () => { req.result.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }), ADDON);
  await page.goto(`${base}/astra/`);
  await page.waitForFunction(() => window.astra?.openStreams && window.astra.manifests?.size);
  await page.evaluate((meta) => window.astra.openStreams(meta), META);
  await page.waitForFunction((n) => document.querySelectorAll('.screen.streams .stream-card').length === n, streams.length);
  await page.waitForFunction(() => window.astra.stack.at(-1).screen.ahead); // getting ready loads behind the screen (app/ready.js)
  const cards = () => page.$$eval('.screen.streams .stream-card', (els) => els.map((el) => ({ text: el.textContent, note: el.querySelector('.stream-plays')?.textContent ?? '',
    res: el.querySelector('.sc-res')?.textContent ?? null, size: el.querySelector('.sc-facts')?.firstChild?.textContent ?? null, name: el.querySelector('.visually-hidden, .stream-name')?.textContent.replace(/\. $/, '') })));
  return { page, errors, cards };
}

const OWNER = '(type) => /hvc1\\.2\\./.test(type) ? { supported: false, smooth: false, powerEfficient: false } : { supported: true, smooth: true, powerEfficient: true }';
const EVERYTHING = '() => ({ supported: true, smooth: true, powerEfficient: true })';

test("the owner's phone: no hash on any card, one note a card, the add-on's order kept, and a press still sends the hash", opts, async (t) => {
  const { page, errors, cards } = await app(t, { report: OWNER });
  const list = await cards();
  for (const [i, c] of list.entries()) assert.doesNotMatch(c.text, /[0-9a-f]{40}/i, `card ${i}`);
  assert.deepEqual(list.map((c) => c.note), ['10-bit HEVC: this phone decodes it in software (slow, more battery)', '', "No hash from this source: may open in Chrome's plain player", '']);
  // Designed cards (the default): the resolution badge first, the size leading the facts line, in the add-on's own order.
  assert.deepEqual(list.map((c) => c.res), ['4K', '1080p', '1080p', '720p']);
  assert.deepEqual(list.map((c) => c.size), ['14 GB', '2.1 GB', '1.9 GB', '900 MB'], "in the add-on's own order");
  assert.match(list[0].text, /HDR10/);
  assert.match(list[0].text, /Ready on TB/);
  // Settings › Streams › Add-on text: the add-on's own words again, the hash cut out of its line cleanly.
  await page.evaluate(() => window.astra.saveSetting('streamCard', 'addon'));
  await page.waitForFunction(() => !document.querySelector('.screen.streams .stream-card.designed') && document.querySelectorAll('.screen.streams .stream-card').length === 4);
  const own = await cards();
  assert.match(own[0].text, /📺 2160p · HDR10 · HEVC/);
  assert.match(own[3].text, /📺 720p · HEVC · AAC \| 💾 900 MB/, 'the hash cut out of its line cleanly');
  for (const [i, c] of own.entries()) assert.doesNotMatch(c.text, /[0-9a-f]{40}/i, `card ${i}`);
  await page.evaluate(() => window.astra.saveSetting('streamCard', 'designed'));
  await page.waitForFunction(() => document.querySelectorAll('.screen.streams .stream-card.designed').length === 4);
  assert.equal(await page.locator('.screen.streams .stream-card.disabled').count(), 0, 'nothing dimmed');
  // The second card's hash is only in its words (shown without it): a press still asks the server with it.
  await page.locator('.screen.streams .stream-card').nth(1).dispatchEvent('pointerdown', { button: 0, isPrimary: true });
  assert.equal(await asked(HASH(2)), 'ahead');
  if (process.env.ASTRA_SHOTS) await page.screenshot({ path: `${process.env.ASTRA_SHOTS}/streams-owner.png` });
  assert.deepEqual(errors, []);
});

test('a browser that decodes everything: no decode notes; only the link without a hash says so', opts, async (t) => {
  const { errors, cards } = await app(t, { report: EVERYTHING });
  assert.deepEqual((await cards()).map((c) => c.note), ['', '', "No hash from this source: may open in Chrome's plain player", '']);
  assert.deepEqual(errors, []);
});

test('300 streams: the first cards at once, the rest in slices, in order, each answering a press', opts, async (t) => {
  const many = Array.from({ length: 300 }, (_, i) => ({ name: `AIO #${i}`, description: `📺 1080p · x264 · AAC\n💾 ${1 + (i % 9)}.5 GB\n${HASH(1000 + i)}`, url: torrentio(1000 + i) }));
  const { page, errors, cards } = await app(t, { report: EVERYTHING, streams: many });
  const names = (await cards()).map((c) => c.name);
  assert.deepEqual(names, many.map((s) => s.name));
  // Ten at once, then at most eight a frame, never one taken away.
  const counts = (await page.evaluate(() => window.cardsByFrame)).filter((n) => n > 0);
  assert.equal(counts[0], 10, counts.join(' '));
  assert.equal(counts.at(-1), 300);
  for (let i = 1; i < counts.length; i++) assert.ok(counts[i] > counts[i - 1] && counts[i] - counts[i - 1] <= 8, counts.join(' '));
  // The last card was drawn in a later slice; a press on it asks ahead as on the first.
  const last = page.locator('.screen.streams .stream-card').last();
  await last.scrollIntoViewIfNeeded();
  await last.dispatchEvent('pointerdown', { button: 0, isPrimary: true });
  assert.equal(await asked(HASH(1299)), 'ahead');
  await last.dispatchEvent('pointerup', { button: 0, isPrimary: true }); // the finger lifts (a sheet waits for that)
  // A filter chip while the list is drawn again: still in order, and only what the filter leaves.
  // The order chip opens the four orders; the owner's choice reorders, and is kept for the next title.
  await page.locator('.screen.streams .filter-chips.facts .chip.sort').click();
  await page.locator('.sheet-row', { hasText: 'Smallest first' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.screen.streams .stream-card').length === 300 && document.querySelector('.screen.streams .chip.sort[aria-pressed="true"]'));
  const sizes = (await cards()).map((c) => Number.parseFloat(c.size));
  assert.equal((await page.evaluate(() => JSON.parse(localStorage.getItem('astra.v2.streamFilters')))).sort, 'smallest');
  assert.deepEqual(sizes, [...sizes].sort((a, b) => a - b));
  assert.deepEqual(errors, []);
});

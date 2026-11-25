// Settings › Music's "What I know about your music" (MUSIC.md §19.6), in Chromium at 360 px wide
// against the mocked Worker: the counts (albums matched, artists, what each source filled, the picks,
// each source answering or refusing, the waveforms by kind)
// and the unmatched albums with why; the picks to add with a Play button each (a pick with no preview
// says so); then the error line when the Worker can't answer. Invented
// albums and artists only.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { API, mockApi, TOKEN } from './fixtures/mock-api.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (mocked API)' };
let server, browser, base;
before(async () => {
  if (live) return;
  server = await serve(0, { api: API });
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => { await browser?.close(); server?.close(); });

const STATUS = {
  albums: { total: 4, matched: 2, unmatched: 2, due: 0 },
  songs: { matched: 3 },
  artists: { total: 1, done: 1 },
  filled: { musicbrainz: 5, listenbrainz: 1, wikidata: 2, wikipedia: 2, lastfm: 0, discogs: 0 },
  picks: { new: 5, declined: 1, ordered: 1, added: 0 },
  phase: 'idle',
  at: 1,
  hosts: {
    musicbrainz: { ok_at: 1, refused_at: null, until: null },
    listenbrainz: { ok_at: 1, refused_at: null, until: null },
    wikidata: { ok_at: 1, refused_at: null, until: null },
    wikipedia: { ok_at: 1, refused_at: 2, until: Date.parse('2026-11-23T14:12:00Z') },
    lastfm: { ok_at: null, refused_at: null, until: null },
    discogs: { ok_at: null, refused_at: null, until: null },
  },
  waveforms: { rms: 120, peak: 30, none: 5 },
};
const PICK = { id: '00000000-0000-4000-9000-000000000068', kind: 'gap', album: 'Harbour Lights', artist: 'Invented Artist 0', artist_mbid: '00000000-0000-4000-8000-000000000000', year: 2006, type: 'Album', score: 0.8, reason: { kind: 'gap' }, line: 'Harbour Lights (2006) by Invented Artist 0: one of their best-loved albums, and not in your library.', state: 'new', made_at: 1, state_at: 1 };
const PICKS = { items: [PICK], built_at: 1, weights: { gap: 1, new: 1, neighbour: 1, credit: 1, influence: 1 } };
const UNMATCHED = { items: [{ artist: 'Invented Artist 0', album: 'Night Orchard', songs: 1, reason: 'several_release_groups' }], total: 1 };

async function open(failing) {
  const context = await browser.newContext({ viewport: { width: 360, height: 800 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => { try { localStorage.setItem('th.p.sent', '1'); localStorage.setItem('th-theme', 'light'); } catch {} });
  await mockApi(page, {});
  await page.route(`${API}/v1/music/history`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ files: [], artists: 0, resolved: 0 }) }));
  await page.route(`${API}/v1/music/know`, (route) => failing
    ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'unavailable', message: 'x' } }) })
    : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(STATUS) }));
  await page.route((url) => url.pathname === '/v1/music/picks', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PICKS) }));
  await page.route((url) => /^\/v1\/music\/picks\/[^/]+\/preview$/.test(url.pathname), (route) => route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: { code: 'not_found', message: 'x' } }) }));
  await page.route(`${API}/v1/music/unmatched`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(UNMATCHED) }));
  await page.goto(`${base}/no-such-page`);
  await page.evaluate((token) => new Promise((resolve) => { const req = indexedDB.open('th-auth', 1); req.onupgradeneeded = () => req.result.createObjectStore('kv'); req.onsuccess = () => { const tx = req.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put({ session_id: 's1', token, signed_in_at: Date.now(), username: 'example-owner' }, 'session'); tx.oncomplete = () => { req.result.close(); resolve(); }; }; }), TOKEN);
  await page.goto(`${base}/`, { waitUntil: 'load' });
  await page.waitForSelector('html[data-signed-in]');
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('th:open', { detail: { name: 'music' } })));
  await page.waitForSelector('#music-know [data-know]:not([aria-busy])');
  await page.waitForFunction(() => { const p = document.querySelector('.spage'); return p && !p.classList.contains('moving') && !p.getAnimations().length; });
  return { context, page, errors };
}

test('Settings › Music: what is known, matched out of how many, by which source, and the unmatched with why', opts, async () => {
  const { context, page, errors } = await open(false);
  const text = await page.textContent('#music-know');
  assert.match(text, /What I know about your music/);
  assert.match(text, /2 of 4, 3 songs/);
  assert.match(text, /MusicBrainz 5, ListenBrainz 1, Wikidata 2, Wikipedia 2/);
  assert.doesNotMatch(text, /Last\.fm 0/);
  assert.match(text, /5 offered, 1 declined, 1 ordered, 0 added/);
  assert.match(text, /Up to date/);
  assert.match(text, /MusicBrainz answering · ListenBrainz answering · Wikidata answering · Wikipedia refusing, asked again at \d\d:\d\d · Last\.fm not asked yet/);
  assert.match(text, /120 new, 30 old, 5 songs with none/);
  assert.match(text, /Night Orchard.*Invented Artist 0 · more than one album could be it/);
  const box = await page.locator('#music-know').boundingBox();
  assert.ok(box && box.x >= 0 && box.x + box.width <= 360, 'the block fits a 360 px phone');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= 360), true, 'no sideways scroll');
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/music-know.png`, fullPage: true });
  assert.deepEqual(errors, []);
  await context.close();
});

test('Settings › Music: the picks to add, each with a Play button; a pick with no preview says so', opts, async () => {
  const { context, page, errors } = await open(false);
  await page.waitForSelector('#music-picks [data-picks]:not([aria-busy])');
  assert.match(await page.textContent('#music-picks'), /Picks to add:.*Harbour Lights \(2006\) by Invented Artist 0/);
  const name = 'Play a preview of Harbour Lights by Invented Artist 0';
  const box = await page.getByRole('button', { name }).boundingBox();
  assert.ok(box && box.height >= 44, 'a 44 px target');
  await page.getByRole('button', { name }).click();
  await page.waitForFunction(() => /No preview for this one\./.test(document.querySelector('#music-picks [data-pick]')?.textContent ?? ''));
  assert.equal(await page.getByRole('button', { name }).count(), 1, 'back to Play: nothing plays');
  assert.deepEqual(errors, []);
  await context.close();
});

test('Settings › Music: a Worker that cannot answer gets its plain line', opts, async () => {
  const { context, page, errors } = await open(true);
  assert.match(await page.textContent('#music-know [data-know]'), /I couldn’t read this just now/);
  assert.deepEqual(errors, []);
  await context.close();
});

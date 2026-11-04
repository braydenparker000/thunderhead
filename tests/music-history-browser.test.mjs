// Settings › Music's "Listening history" (MUSIC.md §11.1), in Chromium at 390×844 against the mocked
// Worker: the switch from the catalogue, then the block; a picked export goes up with its SHA-256 and
// its name (PUT /v1/music/history), the line says it was taken, and what was counted is read again.
// An invented export only.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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

const FILE = Buffer.from(JSON.stringify([{ ts: '2021-03-01T10:00:00Z', ms_played: 180000, master_metadata_album_artist_name: 'Invented Artist 1', master_metadata_album_album_name: 'Invented album' }]));

test('Settings › Music: the switch, then an export picked, sent with its hash, and counted', opts, async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => { try { localStorage.setItem('th.p.sent', '1'); localStorage.setItem('th-theme', 'light'); } catch {} });
  await mockApi(page, {});
  const files = [];
  const puts = [];
  await page.route(`${API}/v1/music/history`, async (route) => {
    const r = route.request();
    if (r.method() === 'PUT') {
      const h = r.headers();
      puts.push({ name: decodeURIComponent(h['th-file-name']), sha: h['th-sha256'], bytes: r.postDataBuffer()?.length });
      files.push({ sha256: h['th-sha256'], source: 'spotify', state: 'done', plays: 1, minutes: 3, rows: 1, skipped: 0, at: Date.now() });
      return route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ sha256: h['th-sha256'], source: 'spotify', state: 'queued' }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ files, artists: files.length, resolved: 0 }) });
  });
  await page.goto(`${base}/no-such-page`);
  await page.evaluate((token) => new Promise((resolve) => { const req = indexedDB.open('th-auth', 1); req.onupgradeneeded = () => req.result.createObjectStore('kv'); req.onsuccess = () => { const tx = req.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put({ session_id: 's1', token, signed_in_at: Date.now(), username: 'example-owner' }, 'session'); tx.oncomplete = () => { req.result.close(); resolve(); }; }; }), TOKEN);
  await page.goto(`${base}/`, { waitUntil: 'load' });
  await page.waitForSelector('html[data-signed-in]');
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('th:open', { detail: { name: 'music' } })));
  await page.waitForSelector('.spage.in .scatalog[data-group="music"]:not([aria-busy])');
  await page.waitForFunction(() => { const p = document.querySelector('.spage'); return p && !p.classList.contains('moving') && !p.getAnimations().length; });
  assert.ok(await page.getByText('Use my listening history').isVisible());
  await page.waitForSelector('#music-history [data-counted] .sempty');
  assert.match(await page.textContent('#music-history'), /Listening history/);
  await page.setInputFiles('#history-file', { name: 'Streaming_History_Audio_2021_0.json', mimeType: 'application/json', buffer: FILE });
  await page.waitForFunction(() => /taken/.test(document.querySelector('#music-history [role="status"]')?.textContent ?? ''));
  await page.waitForSelector('#music-history [data-file]');
  assert.deepEqual(puts, [{ name: 'Streaming_History_Audio_2021_0.json', sha: createHash('sha256').update(FILE).digest('hex'), bytes: FILE.length }]);
  assert.match(await page.textContent('#music-history [data-file]'), /Spotify.*1 play, 3 minutes/);
  const box = await page.locator('#music-history').boundingBox();
  assert.ok(box && box.x >= 0 && box.x + box.width <= 390, 'the block fits the phone');
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/music-history.png` });
  assert.deepEqual(errors, []);
  await context.close();
});

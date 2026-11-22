// Settings › On this phone in Chromium at 360 px (frontend/apps/settings/phone.js; MENU-AND-SETTINGS.md
// §6.11), against a mock Worker: stores of several apps are seeded (Music's offline songs and covers,
// Podcasts' downloads, Photos' kept thumbnails beside an upload waiting, a Study book in the private
// files, a setting in localStorage); the page shows each row's measured size and count, largest first,
// with no sideways scrolling; clearing Music's offline songs asks first, empties that cache only, and
// leaves every other app's data as it was; clearing Photos' shelf keeps the upload waiting. Sign-in has
// no Clear. Local only; invented bytes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { guardOpen, until } from './fixtures/waits.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (mocked API)', timeout: 120_000 };
const OLD = 'https://jarvis-hub-api.braydenparker999.workers.dev';
const TOKEN = `th1_${'P'.repeat(43)}abcdef`;
let site, mock, browser, base;

before(async () => {
  if (live) return;
  mock = createServer((req, res) => {
    const cors = { 'Access-Control-Allow-Origin': req.headers.origin ?? '*', Vary: 'Origin' };
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...cors, 'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-None-Match, TH-Client' });
      return res.end();
    }
    const url = new URL(req.url, 'http://x');
    const answers = {
      '/v1/auth/me': { session_id: 's1', notices: [], recovery_confirmed: true },
      '/v1/threads/today': { thread: null, messages: [], seq: 1, day: new Date().toISOString().slice(0, 10) },
      '/v1/settings': { 'owner.tz': 'UTC', 'mind.status': { state: 'asleep', note: null, since: null } },
      '/v1/surfaces': { items: [], seq: 1 }, '/v1/verbs/pending': { items: [] },
      '/v1/proposals': { items: [] }, '/v1/changes': { items: [], next_after: 1, more: false },
    };
    const known = url.pathname in answers;
    const b = Buffer.from(JSON.stringify(known ? answers[url.pathname] : { error: { code: 'not_found', message: 'no', request_id: 't' } }));
    res.writeHead(known ? 200 : 404, { ...cors, 'Content-Type': 'application/json', 'Content-Length': b.length });
    res.end(b);
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  site = await serve(0, { api: `http://127.0.0.1:${mock.address().port}` });
  base = `http://127.0.0.1:${site.address().port}`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => { await browser?.close(); site?.close(); mock?.close(); });

/** Seeds the stores (in the page) and signs in. */
const seed = (token) => (async () => {
  const put = async (name, entries) => { const c = await caches.open(name); for (const [path, n] of entries) await c.put(path, new Response(new Uint8Array(n), { headers: { 'Content-Type': 'application/octet-stream' } })); };
  await put('claude-player-audio', [['/music/a1', 3_000_000], ['/music/a2', 2_000_000]]);
  await put('claude-player-covers', [['/music/c1', 40_000]]);
  await put('jarvis-podcast-audio-v1', [['/podcasts/offline/e1', 1_500_000]]);
  const idb = (name, run) => new Promise((resolve) => { const req = indexedDB.open(name, 1); req.onupgradeneeded = () => req.result.createObjectStore('kv'); req.onsuccess = () => { const tx = req.result.transaction('kv', 'readwrite'); run(tx.objectStore('kv')); tx.oncomplete = () => { req.result.close(); resolve(); }; }; });
  await idb('th-auth', (s) => s.put({ session_id: 's1', token, signed_in_at: Date.now(), username: 'example-owner' }, 'session'));
  await idb('th-photos', (s) => { s.put(new Blob([new Uint8Array(200_000)]), 'thumb:p1'); s.put(new Blob([new Uint8Array(300_000)]), 'preview:p1'); s.put({ id: 'p9', name: 'invented.jpg', file: new Blob([new Uint8Array(900_000)]) }, 'bg:p9'); });
  const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('study', { create: true });
  const w = await (await dir.getFileHandle('b1.pdf', { create: true })).createWritable();
  await w.write(new Uint8Array(700_000));
  await w.close();
  localStorage.setItem('cp-settings', JSON.stringify({ volume: 0.5 }));
})();

/** What is stored now, store by store. */
const stored = (page) => page.evaluate(async () => {
  const entries = async (n) => ((await caches.has(n)) ? (await (await caches.open(n)).keys()).length : 0);
  const keys = await new Promise((resolve) => { const req = indexedDB.open('th-photos'); req.onsuccess = () => { const g = req.result.transaction('kv').objectStore('kv').getAllKeys(); g.onsuccess = () => { req.result.close(); resolve(g.result.sort()); }; }; });
  const study = (await (await (await (await navigator.storage.getDirectory()).getDirectoryHandle('study')).getFileHandle('b1.pdf')).getFile()).size;
  return { songs: await entries('claude-player-audio'), covers: await entries('claude-player-covers'), podcasts: await entries('jarvis-podcast-audio-v1'), photos: keys, study, local: localStorage.getItem('cp-settings') };
});

const row = (page, id) => page.evaluate((i) => { const r = document.querySelector(`#phone-list [data-store="${i}"]`); return r && { value: r.querySelector('.row-value')?.textContent, detail: r.querySelector('.row-detail')?.textContent, clear: Boolean(r.querySelector('button')) }; }, id);

test('On this phone measures each app’s stores, clears one, and leaves the others as they were', opts, async () => {
  const context = await browser.newContext({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 2, serviceWorkers: 'block', timezoneId: 'UTC', locale: 'en-GB' });
  await context.route(`${OLD}/**`, (r) => r.abort());
  const page = await context.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/no-such-page`);
  await page.evaluate(seed, TOKEN);
  await page.goto(`${base}/`, { waitUntil: 'load' });
  await page.waitForSelector('html[data-signed-in]');
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('th:open', { detail: { name: 'settings' } })));
  await page.click('.spage.in [data-page="phone"]');
  await page.waitForFunction(() => document.querySelector('#phone-status')?.textContent === 'All measured.', null, { timeout: 30_000 });
  const before = await stored(page);
  const words = (n) => page.evaluate(async (b) => (await import('/th/data/tally.js')).words(b), n);

  assert.deepEqual(await row(page, 'music-songs'), { value: await words(5_000_000), detail: 'Whole songs kept to play without a signal. 2 songs.', clear: true });
  assert.deepEqual(await row(page, 'podcasts-downloads'), { value: await words(1_500_000), detail: 'Episodes downloaded to play offline. 1 episode.', clear: true });
  assert.deepEqual(await row(page, 'study-books'), { value: await words(700_000), detail: 'Books kept to read without a signal. 1 file.', clear: true });
  assert.equal((await row(page, 'photos-kept')).value, await words(500_000 + 'thumb:p1'.length + 'preview:p1'.length));
  assert.equal((await row(page, 'photos-own')).clear, false, 'an upload waiting is never offered');
  assert.equal((await row(page, 'signin')).clear, false, 'sign-in is never offered');
  assert.equal((await row(page, 'local')).clear, false, 'settings are never offered');
  const order = await page.$$eval('#phone-list [data-store]', (rs) => rs.map((r) => Number(r.dataset.bytes)));
  assert.deepEqual(order, [...order].sort((a, b) => b - a), 'largest first');
  assert.ok(await page.evaluate(() => /^\d/.test(document.querySelector('#phone-used .row-value')?.textContent ?? '')), 'the browser’s total is shown');
  const fit = await page.evaluate(() => { const s = document.querySelector('.spage.in .sscroll'); return s.scrollWidth - s.clientWidth + document.documentElement.scrollWidth - innerWidth; });
  assert.ok(fit <= 0, `no sideways scroll at 360 px (${fit})`);

  // Clear Music's offline songs: asked first, then only that store goes.
  await guardOpen(page);
  await page.click('#phone-list [data-store="music-songs"] button');
  await page.waitForSelector('.csheet');
  assert.match(await page.textContent('.csheet .sheet-note'), /songs kept to play without a signal.*come back by downloading again/);
  await page.click('.csheet .btn.danger');
  await until(async () => (await stored(page)).songs === 0, { message: 'the offline songs went' });
  await until(async () => (await row(page, 'music-songs')) === null, { message: 'the row went with its cache' });
  assert.deepEqual({ ...(await stored(page)), songs: before.songs }, before, 'every other app’s data is untouched');

  // Clear Photos' shelf: the thumbnails and previews go, the upload waiting stays.
  await page.click('#phone-list [data-store="photos-kept"] button');
  await page.waitForSelector('.csheet');
  await page.click('.csheet .btn.danger');
  await until(async () => (await stored(page)).photos.join() === 'bg:p9', { message: 'only the upload waiting is left in Photos' });
  const now = await stored(page);
  assert.deepEqual([now.covers, now.podcasts, now.study, now.local], [before.covers, before.podcasts, before.study, before.local]);
  assert.deepEqual(errors, []);
  await context.close();
});

// What a sign-out wipes (SIGN-IN.md §11.3, owner 2026-11-21), in Chromium: everything personal that has
// a copy on the account goes, the ported apps' synced stores among it (Podcasts' positions, follows and
// feeds, Guitar's library and ladder, Music's taste weights); what lives only on this phone stays
// (Music's library and settings, the DJ's learning, My Media, the editor's reports, setup and reset codes).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { API } from './fixtures/mock-api.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only' };
let server, browser, base;
before(async () => {
  if (live) return;
  server = await serve(0, { api: API });
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => { await browser?.close(); server?.close(); });

const WIPED_KEYS = ['jarvis.podcasts.v1', 'jarvis.guitar.library.v1', 'th.p.guitar.ladder', 'th.music.taste', 'th.p.podcasts.sync'];
const KEPT_KEYS = ['cp-settings', 'cp-settings-tags', 'cp-list-opts', 'cp-search-history', 'cp-first-run', 'th.music.dj', 'mymedia.progress.v1', 'mymedia.saved.v1', 'mymedia.queue.v1', 'th-theme'];
const WIPED_DBS = ['th-auth', 'th-data', 'jarvis-podcasts'];
const KEPT_DBS = ['claude-player', 'th-report', 'th-setup', 'th-recover'];

test('wipe() removes the synced stores and keeps the phone-only ones', opts, async () => {
  const page = await browser.newPage({ serviceWorkers: 'block' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/no-such-page`);
  await page.evaluate(async ([keys, dbs]) => {
    for (const k of keys) localStorage.setItem(k, '{"example":1}');
    for (const name of dbs) await new Promise((resolve, reject) => {
      const req = indexedDB.open(name, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => { req.result.close(); resolve(); };
      req.onerror = () => reject(req.error);
    });
    // Guitar's store: its songs, practice log and searches go; its preferences are the phone's and stay.
    localStorage.setItem('jarvis.guitar.v2', JSON.stringify({ songs: { s1: { key: 's1' } }, log: { '2026-11-01': 60 }, searches: ['an invented song'], prefs: { tabScale: 1 } }));
  }, [[...WIPED_KEYS, ...KEPT_KEYS], [...WIPED_DBS, ...KEPT_DBS]]);
  await page.evaluate(() => import('/th/session.js').then((m) => m.wipe()));
  const left = await page.evaluate(async () => ({ keys: Object.keys(localStorage), dbs: (await indexedDB.databases()).map((d) => d.name) }));
  for (const k of WIPED_KEYS) assert.ok(!left.keys.includes(k), `wiped ${k}`);
  assert.equal(await page.evaluate(() => localStorage.getItem('jarvis.guitar.v2')), '{"prefs":{"tabScale":1}}');
  for (const k of KEPT_KEYS) assert.ok(left.keys.includes(k), `kept ${k}`);
  for (const d of WIPED_DBS) assert.ok(!left.dbs.includes(d), `wiped ${d}`);
  for (const d of KEPT_DBS) assert.ok(left.dbs.includes(d), `kept ${d}`);
  assert.deepEqual(errors, []);
  await page.close();
});

// Astra the same on every phone the owner signs in on, in the real app (frontend/astra/src/app/sync.js,
// settings.js; ASTRA.md §5.3): two phones (two browser contexts) against a stand-in for the Worker on another
// port that keeps one copy with conditional saves. Phone A adds an add-on, saves a title and watches a film,
// then taps Sync now; phone B, opened fresh, has all three; B removes the title from its library and A loses
// it; a hidden page saves as it goes. Signed out, the stand-in is never asked. Home's first paint does not wait
// for a slow server. Every DNS answer but the local host's is refused: nothing can leave for a real host.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (an invented server and add-on)', timeout: 90_000 };
const ADDON = 'https://addon.example/invented-config-0011/manifest.json';
const TOKEN = 'invented-session-token';
const META = { id: 'tt0000501', type: 'movie', name: 'An Invented Film' };
const SHOTS = process.env.ASTRA_SHOTS;
/** The stand-in Worker, as the real one answers: one copy, `?known=` answered `same` when it is that version, saves
 * with the copy as the body and its base in `?base=` (conditional); every request recorded; `delay` holds GET back. */
const worker = { kept: null, calls: [], n: 0, delay: 0 };
/** What reached the copy's route (the page asks the server for other things too, such as its arrangement slot). */
const asked = (from = 0) => worker.calls.slice(from).filter((c) => c.path === '/v1/astra/backup' && c.method !== 'OPTIONS');
let site, api, browser, base, apiOrigin;

before(async () => {
  if (live) return;
  api = createServer((req, res) => {
    const cors = { 'Access-Control-Allow-Origin': req.headers.origin ?? '', Vary: 'Origin' };
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      const u = new URL(req.url, 'http://stand-in');
      worker.calls.push({ method: req.method, path: u.pathname, query: u.search, auth: req.headers.authorization, body: body ? JSON.parse(body) : null });
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { ...cors, 'Access-Control-Allow-Methods': 'GET, PUT, DELETE', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' });
        return res.end();
      }
      const send = (status, out) => { res.writeHead(status, { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(out === undefined ? '' : JSON.stringify(out)); };
      if (u.pathname !== '/v1/astra/backup') return send(404, { error: { code: 'not_found', message: 'Not found.' } });
      if (req.method === 'GET') {
        if (worker.delay) await new Promise((r) => setTimeout(r, worker.delay));
        const known = u.searchParams.get('known');
        if (known && worker.kept?.version === known) return send(200, { version: known, saved_at: worker.kept.saved_at, same: true });
        return send(200, worker.kept ?? { version: null, saved_at: null, copy: null });
      }
      if (req.method === 'DELETE') { worker.kept = null; res.writeHead(204, cors); return res.end(); }
      if ((worker.kept?.version ?? null) !== u.searchParams.get('base')) return send(409, { error: { code: 'conflict', message: 'Stale.', details: { reason: 'stale_base' } } });
      worker.kept = { version: `v${++worker.n}`, saved_at: new Date().toISOString(), copy: JSON.parse(body) };
      send(200, { version: worker.kept.version, saved_at: worker.kept.saved_at });
    });
  });
  await new Promise((r) => api.listen(0, '127.0.0.1', r));
  apiOrigin = `http://127.0.0.1:${api.address().port}`;
  site = await serve(0, { api: apiOrigin });
  base = `http://127.0.0.1:${site.address().port}`;
  browser = await chromium.launch({ args: ['--no-proxy-server', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'], ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
});
after(async () => { await browser?.close(); site?.close(); api?.close(); });

/** A phone: its own context, signed in or not, with what it already saved; the add-on answered, the rest refused. */
async function phone(t, { signedIn = true, saved = {} } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  t.after(() => context.close());
  const elsewhere = [];
  await context.route((url) => !/^(http:\/\/127\.0\.0\.1|https:\/\/addon\.example\/)/.test(url.href), (route) => { elsewhere.push(new URL(route.request().url()).host); return route.abort(); });
  // Astra's built-in add-ons (a fresh phone has Cinemeta) answer nothing.
  for (const known of ['https://v3-cinemeta.strem.io/**', 'https://opensubtitles-v3.strem.io/**']) await context.route(known, (route) => route.fulfill({ status: 404, body: '' }));
  await context.route('https://addon.example/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(new URL(route.request().url()).pathname.endsWith('/manifest.json') ? { id: 'example', name: 'Example', version: '1.0.0', resources: ['meta', 'stream'], types: ['movie'], catalogs: [] } : { meta: META }) }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/astra/`);
  // This first page has read its (signed-out) session before the sign-in is written, so it never asks.
  await page.waitForFunction(() => window.astra?.sync);
  await page.evaluate(() => window.astra.sync.ready);
  await page.evaluate(([token, signedIn, saved]) => new Promise((resolve, reject) => {
    localStorage.clear();
    for (const [k, v] of Object.entries(saved)) localStorage.setItem(`astra.v2.${k}`, JSON.stringify(v));
    if (!signedIn) return resolve();
    const req = indexedDB.open('th-auth', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => {
      const tx = req.result.transaction('kv', 'readwrite');
      tx.objectStore('kv').put({ session_id: 's1', token, signed_in_at: Date.now(), username: 'example-owner' }, 'session');
      tx.oncomplete = () => { req.result.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }), [TOKEN, signedIn, saved]);
  await page.goto(`${base}/astra/`);
  await page.waitForFunction(() => window.astra?.sync);
  await page.evaluate(() => window.astra.sync.ready);
  // Until the phone has fetched at least once and is not mid-exchange.
  const idle = () => page.waitForFunction(() => JSON.parse(localStorage.getItem('astra.sync.v1') || 'null')?.fetchedAt && !window.astra.sync.state().working);
  return { page, errors, elsewhere, idle, saved: (k) => page.evaluate((key) => JSON.parse(localStorage.getItem(`astra.v2.${key}`) || 'null'), k) };
}

/** Opens Settings › Your data on a phone. */
async function yourData(page) {
  await page.locator('.nav-item[data-tab="settings"]').click();
  await page.locator('.set-row', { hasText: 'Your data' }).click();
  await page.waitForSelector('.settings-page .set-group:has-text("This phone and your others")');
}

test('phone A’s add-on, saved title and film reach phone B; B’s removal reaches A; a hidden page saves', opts, async (t) => {
  worker.kept = null;
  worker.calls = [];
  const a = await phone(t, { saved: { addons: [{ url: ADDON, enabled: true, name: 'Example' }], player: { volume: 0.4 } } });
  await a.idle();
  assert.deepEqual(asked().map((c) => c.method), ['GET', 'PUT'], 'a first start saves what A has');
  assert.ok(asked().every((c) => c.auth === `Bearer ${TOKEN}`));
  // A saves the title and watches the film (the player saves progress through the same call), then taps Sync now.
  await a.page.evaluate((meta) => {
    window.astra.library.toggle(meta);
    window.astra.progress.save({ type: 'movie', id: meta.id, videoId: meta.id, time: 1500, duration: 6000, meta });
    window.astra.progress.flush(true);
  }, META);
  await yourData(a.page);
  await a.page.locator('.set-row', { hasText: 'Sync now' }).click();
  await a.idle();
  await a.page.waitForSelector('.settings-page small:has-text("Saved just now")');
  if (SHOTS) { await a.page.waitForTimeout(500); await a.page.screenshot({ path: `${SHOTS}/sync-your-data.png` }); }
  const keys = Object.keys(worker.kept.copy.keys).sort();
  assert.deepEqual(keys, ['addons', 'library', 'progress'], 'what A saved, never its player choices');
  // Phone B, fresh: it has all three, and its screens show them.
  const b = await phone(t);
  await b.idle();
  assert.deepEqual((await b.saved('addons')).map((x) => x.url), [ADDON]);
  assert.ok((await b.saved('library'))['movie:tt0000501']);
  assert.equal((await b.saved('progress'))['movie:tt0000501|tt0000501'].time, 1500);
  const shown = await b.page.evaluate(() => ({ addons: window.astra.addons.list.map((x) => x.name), saved: window.astra.library.has('movie', 'tt0000501'),
    resume: window.astra.progress.continueWatching().map((e) => e.id) }));
  assert.deepEqual(shown, { addons: ['Example'], saved: true, resume: ['tt0000501'] });
  // B removes it from the library; A, syncing, loses it, and its Library tab follows.
  await b.page.evaluate((meta) => window.astra.library.toggle(meta), META);
  await b.page.evaluate(() => window.astra.sync.syncNow());
  assert.equal(worker.kept.copy.keys.library.value['movie:tt0000501'], undefined);
  await a.page.evaluate(() => window.astra.sync.syncNow());
  assert.equal(await a.page.evaluate(() => window.astra.library.has('movie', 'tt0000501')), false);
  assert.equal((await a.saved('library'))['movie:tt0000501'], undefined);
  // A hidden page saves what changed as it goes (a keepalive request).
  const before = worker.calls.length;
  await a.page.evaluate(() => {
    window.astra.saveSettings({ hero: false });
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await a.page.waitForFunction(() => !JSON.parse(localStorage.getItem('astra.sync.v1')).owed);
  assert.deepEqual(asked(before).map((c) => c.method), ['PUT']);
  assert.equal(worker.kept.copy.keys.settings.value.hero, false);
  // Recent searches off on A: the searches kept go, on every phone, as a removal; B stops keeping new ones.
  await a.page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); window.astra.store.set('recentSearches', ['invented film']); });
  await a.page.evaluate(() => window.astra.sync.syncNow());
  assert.deepEqual(worker.kept.copy.keys.recentSearches.value, ['invented film']);
  // The switch is on Your data's page (Settings, drawn from the registry).
  await a.page.locator('.settings-page .set-row', { hasText: 'Recent searches' }).click();
  assert.match(await a.page.locator('.settings-page .set-row', { hasText: 'Recent searches' }).textContent(), /on every phone you keep the same/);
  await a.page.evaluate(() => window.astra.sync.syncNow());
  assert.deepEqual([worker.kept.copy.keys.recentSearches.value, worker.kept.copy.keys.settings.value.recentSearches], [[], false]);
  await b.page.evaluate(() => window.astra.sync.syncNow());
  assert.deepEqual([await b.saved('recentSearches'), (await b.saved('settings')).recentSearches], [[], false]);
  // Opened again with nothing changed anywhere: it names the version it holds and nothing more travels.
  const n = worker.calls.length;
  await a.page.reload();
  for (let i = 0; i < 100 && !asked(n).length; i++) await a.page.waitForTimeout(50);
  await a.idle();
  assert.deepEqual(asked(n).map((c) => [c.method, c.query]), [['GET', `?known=${worker.kept.version}`]]);
  for (const p of [a, b]) { assert.deepEqual(p.elsewhere, []); assert.deepEqual(p.errors, []); }
});

test('signed out after keeping in step: the copy leaves the phone, and Astra opens with Cinemeta alone', opts, async (t) => {
  worker.kept = null;
  const a = await phone(t, { saved: { addons: [{ url: ADDON, enabled: true, name: 'Example' }], library: { 'movie:tt0000501': { ...META, added: Date.now() } } } });
  await a.idle();
  // The shell's sign-out (th/session.js), as Settings › Sign out runs it.
  await a.page.evaluate(() => import('/th/session.js').then((m) => m.wipe()));
  assert.equal(await a.page.evaluate(() => window.astra.store.set('settings', { hero: false })), false, 'the open page writes nothing back');
  assert.deepEqual(await a.page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('astra.v2.') || k === 'astra.sync.v1')), []);
  const before = worker.calls.length;
  await a.page.reload();
  await a.page.waitForFunction(() => window.astra?.sync);
  await a.page.evaluate(() => window.astra.sync.ready);
  const shown = await a.page.evaluate(() => ({ addons: window.astra.addons.list.map((x) => x.name), saved: window.astra.library.list().length }));
  assert.deepEqual(shown, { addons: ['Cinemeta'], saved: 0 });
  assert.deepEqual(asked(before), [], 'and, signed out, asks nothing');
  assert.deepEqual(a.errors, []);
});

test('signed out: the server is never asked, and Your data says how to keep phones in step', opts, async (t) => {
  worker.calls = [];
  const out = await phone(t, { signedIn: false, saved: { addons: [{ url: ADDON, enabled: true, name: 'Example' }] } });
  await out.page.evaluate((meta) => {
    window.astra.library.toggle(meta);
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }, META);
  await out.page.evaluate(() => window.astra.sync.syncNow());
  await yourData(out.page);
  const line = await out.page.locator('.settings-page .set-group:has-text("This phone and your others") .set-note').textContent();
  assert.equal(line, 'Sign in on the Thunderhead to keep your phones in step.');
  if (SHOTS) { await out.page.waitForTimeout(500); await out.page.screenshot({ path: `${SHOTS}/sync-signed-out.png` }); }
  await out.page.waitForTimeout(1500);
  assert.deepEqual(worker.calls, [], 'nothing at all reached the server');
  assert.equal(await out.page.evaluate(() => localStorage.getItem('astra.sync.v1')), null);
  assert.deepEqual(out.errors, []);
});

test('Home’s first paint does not wait for a slow server', opts, async (t) => {
  const paint = async (signedIn) => {
    const p = await phone(t, { signedIn, saved: { addons: [{ url: ADDON, enabled: true, name: 'Example' }] } });
    // Waited for in the page: read straight away, the entry was sometimes not there yet (null on CI, 2026-11-21).
    return p.page.evaluate(() => new Promise((resolve) => {
      const had = performance.getEntriesByName('first-contentful-paint')[0];
      if (had) return resolve(had.startTime);
      new PerformanceObserver((l) => { const e = l.getEntriesByName('first-contentful-paint')[0]; if (e) resolve(e.startTime); }).observe({ type: 'paint', buffered: true });
    }));
  };
  worker.delay = 0;
  const out = await paint(false);
  worker.delay = 4000;
  const slow = await paint(true);
  worker.delay = 0;
  t.diagnostic(`first contentful paint: signed out ${Math.round(out)} ms, signed in with a server answering in 4 s ${Math.round(slow)} ms`);
  assert.ok(out > 0 && slow > 0);
  assert.ok(slow < 4000 && slow < out + 1000, `${slow} ms against ${out} ms`);
});

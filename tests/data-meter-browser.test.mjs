// The data meter in Chromium at 390×844 (frontend/th/data/, Settings › Data use; DATA-METER.md), against
// a mock new Worker and bucket: home loads; Study loads in a frame of home and counts its own load (home
// leaves the frame's entry alone, so nothing is counted twice); Music opens in home's frame, its worker
// trusted, and two song ranges go through the bridge (th/music/bridge.js): Songs then equals what the
// bucket served, each range its Content-Length plus 300 bytes of headers. The page shows those totals
// in Ink and Lamp and in Classic, by day and by night, without sideways scrolling, and Reset asks first.
// Local only; no network; invented bytes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { until } from './fixtures/waits.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (mocked API)', timeout: 120_000 };
const OLD = 'https://jarvis-hub-api.braydenparker999.workers.dev';
const TOKEN = `th1_${'D'.repeat(43)}abcdef`;
const ID = `r2_native_${'d'.repeat(64)}`;
const SONG = Buffer.from(Uint8Array.from({ length: 40_000 }, (_, i) => (i * 7) % 251));
let site, mock, browser, base, api;
/** Every answer the bucket gave for a song: its Content-Length. */
const served = [];

before(async () => {
  if (live) return;
  mock = createServer((req, res) => {
    const cors = { 'Access-Control-Allow-Origin': req.headers.origin ?? '*', Vary: 'Origin', 'Access-Control-Expose-Headers': 'ETag, Content-Length, Content-Range, Accept-Ranges' };
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...cors, 'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-None-Match, If-Range, Range, TH-Client' });
      return res.end();
    }
    const url = new URL(req.url, 'http://x');
    const json = (body, status = 200) => { const b = Buffer.from(JSON.stringify(body)); res.writeHead(status, { ...cors, 'Content-Type': 'application/json', 'Content-Length': b.length }); res.end(b); };
    if (url.pathname === '/v1/music/catalog') {
      const track = { id: ID, sha256: 'd'.repeat(64), size: SONG.length, audioKey: `native/audio/${'d'.repeat(64)}.opus`, mimeType: 'audio/ogg', path: 'Song.opus', folder: 'Cloudflare R2/Test',
        r2Identity: { size: SONG.length, etag: 'e1', lastModified: '2026-10-01T00:00:00.000Z' }, metadata: { title: 'An Invented Song', artist: 'Nobody', dur: 3 } };
      return json({ version: 1, kind: 'r2-library', complete: true, count: 1, generatedAt: '2026-11-01T00:00:00.000Z', tracks: [track] });
    }
    if (url.pathname === '/v1/media/sign') {
      let body = '';
      return req.on('data', (d) => (body += d)).on('end', () => json({ items: JSON.parse(body).refs.map((ref) => ({ ref, url: `${api}/r2/song?X-Amz-Signature=test`, expires_at: Date.now() + 3_600_000 })), errors: [] }));
    }
    if (url.pathname === '/r2/song') {
      const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '');
      const a = m ? Number(m[1]) : 0, b = m?.[2] ? Math.min(Number(m[2]), SONG.length - 1) : SONG.length - 1;
      served.push(b - a + 1);
      res.writeHead(m ? 206 : 200, { ...cors, 'Content-Type': 'audio/ogg', 'Accept-Ranges': 'bytes', 'Content-Length': String(b - a + 1), ...(m ? { 'Content-Range': `bytes ${a}-${b}/${SONG.length}` } : {}) });
      return res.end(SONG.subarray(a, b + 1));
    }
    const answers = {
      '/v1/auth/me': { session_id: 's1', notices: [], recovery_confirmed: true },
      '/v1/threads/today': { thread: null, messages: [], seq: 1, day: new Date().toISOString().slice(0, 10) },
      '/v1/settings': { 'owner.tz': 'UTC', 'mind.status': { state: 'asleep', note: null, since: null } },
      '/v1/surfaces': { items: [], seq: 1 }, '/v1/verbs/pending': { items: [] },
      '/v1/proposals': { items: [] }, '/v1/changes': { items: [], next_after: 1, more: false },
      '/v1/podcasts/progress': { items: [] }, '/v1/podcasts/browse': { results: [] },
    };
    if (url.pathname in answers) return json(answers[url.pathname]);
    json({ error: { code: 'not_found', message: 'no', request_id: 't' } }, 404);
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  api = `http://127.0.0.1:${mock.address().port}`;
  site = await serve(0, { api });
  base = `http://127.0.0.1:${site.address().port}`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => { await browser?.close(); site?.close(); mock?.close(); });

/** Home signed in, on Wi-Fi as the browser reports it, in `look` and `theme`; `kept` seeds the meter. */
async function home({ look = 'ink-lamp', theme = 'light', kept = null, workers = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: workers ? 'allow' : 'block', timezoneId: 'UTC', locale: 'en-GB' });
  await context.addInitScript(([l, t, k]) => {
    Object.defineProperty(navigator, 'connection', { value: { type: 'wifi', saveData: true }, configurable: true });
    try {
      if (localStorage.getItem('th.p.sent')) return;
      localStorage.setItem('th.p.sent', '1');
      localStorage.setItem('th-theme', t);
      localStorage.setItem('th.s.appearance.look', l);
      if (k) localStorage.setItem('th.p.data', k);
    } catch {}
  }, [look, theme, kept && JSON.stringify(kept)]);
  // Not the shell's worker: its precache would add a whole release to the numbers while the test reads them.
  await context.route(`${base}/sw.js`, (r) => r.fulfill({ status: 404, body: '' }));
  await context.route(`${OLD}/**`, (r) => r.abort());
  const page = await context.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/no-such-page`);
  await page.evaluate((token) => new Promise((resolve) => { const req = indexedDB.open('th-auth', 1); req.onupgradeneeded = () => req.result.createObjectStore('kv'); req.onsuccess = () => { const tx = req.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put({ session_id: 's1', token, signed_in_at: Date.now(), username: 'example-owner' }, 'session'); tx.oncomplete = () => { req.result.close(); resolve(); }; }; }), TOKEN);
  await page.goto(`${base}/`, { waitUntil: 'load' });
  await page.waitForSelector('html[data-signed-in]');
  return { context, page, errors };
}

/** Opens Settings › Data use from Settings' list. */
async function dataUse(page) {
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('th:open', { detail: { name: 'settings' } })));
  await page.click('.spage.in [data-page="data"]');
  await page.waitForFunction(() => [...document.querySelectorAll('.spage.in .page-title')].some((h) => h.textContent === 'Data use') && document.querySelector('#data-today'));
  await page.waitForFunction(() => { const p = [...document.querySelectorAll('.spage')].at(-1); return p && !p.classList.contains('moving'); });
}

/** Today's total on the page is the sum of the parts the phone has counted (redrawn as frames write theirs). */
const shows = (page, words) => until(async () => (await page.textContent('#data-today .row-value')) === (await words(Object.values(await today(page)).reduce((a, b) => a + b, 0))), { message: 'Today shows the sum of the parts' });

/** The phone's tally for today, by part, all networks together, after every page has written its counts. */
const today = (page) => page.evaluate(() => {
  for (const w of [window, ...[...document.querySelectorAll('iframe')].map((f) => f.contentWindow)]) try { w.thData?.flush(); } catch {}
  const t = JSON.parse(localStorage.getItem('th.p.data') || '{"days":{}}'), d = new Date();
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return Object.fromEntries(Object.entries(t.days[day] ?? {}).map(([id, s]) => [id, s[0] + s[1] + s[2]]));
});

test('home, a framed app and a song through the bridge add up to what was served; the page shows it', opts, async () => {
  const { context, page, errors } = await home({ workers: true });
  // An app in a frame of home: it counts its own load, and home does not count the frame's.
  await page.evaluate(() => document.body.append(Object.assign(document.createElement('iframe'), { id: 'study-frame', src: '/study/', style: 'position:fixed;width:10px;height:10px;opacity:0' })));
  await page.waitForFunction(() => document.querySelector('#study-frame')?.contentWindow?.thData);
  const own = (page) => page.evaluate(async () => {
    const { partOfPath } = await import('/th/data/page.js');
    const size = (e) => (e.deliveryType === 'cache' ? 0 : e.transferSize || e.encodedBodySize || 0);
    const mine = (w, keep) => w.performance.getEntriesByType('navigation').concat(w.performance.getEntriesByType('resource'))
      .filter((e) => keep(new URL(e.name), e)).reduce((n, e) => n + size(e), 0);
    const frame = document.querySelector('#study-frame').contentWindow;
    const frameEntry = performance.getEntriesByType('resource').find((e) => e.initiatorType === 'iframe' && e.name.endsWith('/study/'));
    // Study: the frame's whole timeline, and anything home itself fetched from Study's paths.
    return { frameEntry: frameEntry?.transferSize ?? 0,
      study: mine(frame, () => true) + mine(window, (u, e) => u.origin === location.origin && e.initiatorType !== 'iframe' && partOfPath(u.pathname) === 'study') };
  });
  const counted = await until(async () => { const [o, t] = [await own(page), await today(page)]; return o.study > 0 && t.study === o.study && o; }, { message: 'Study counted its own load once' });
  assert.ok(counted.frameEntry > 0, 'home’s timeline has the frame’s load with its size: left alone, it is not counted twice');

  // Music in home's frame, trusted by its worker; two ranges of a song through the bridge.
  assert.equal(await page.evaluate(() => import('/th/island/island.js').then((m) => m.openApp('music'))), true);
  await page.waitForFunction(() => document.querySelector('iframe.th-app[data-app=music]')?.contentWindow?.thData && navigator.serviceWorker);
  await page.waitForFunction(() => document.querySelector('iframe.th-app[data-app=music]').contentWindow.navigator.serviceWorker.controller);
  const got = await page.evaluate(async ([old, id]) => {
    const w = document.querySelector('iframe.th-app[data-app=music]').contentWindow;
    const one = async (range) => (await (await w.fetch(`${old}/music/library/audio/${id}`, { headers: { Range: range } })).arrayBuffer()).byteLength;
    return [await one('bytes=0-999'), await one('bytes=30000-')];
  }, [OLD, ID]);
  assert.deepEqual(got, [1000, 10_000]);
  const songs = () => served.reduce((n, b) => n + b + 300, 0);
  await until(async () => (await today(page))['music.songs'] === songs(), { message: `Songs equals what the bucket served (${served})` });
  assert.ok(served.length >= 2);

  // The page (Music back in the island): today's total is the sum of the parts; Music's split names Songs at what was served.
  await page.goBack();
  await page.waitForSelector('.th-island:not([hidden])');
  await dataUse(page);
  const words = (b) => page.evaluate(async (n) => (await import('/th/data/tally.js')).words(n), b);
  await shows(page, words);
  assert.match(await page.textContent('#data-today .row-detail'), /^Wi-Fi .+ · Mobile data 0\sKB · Unknown /);
  await page.click('.spage.in [data-part="music"]');
  const music = await page.$$eval('.spage.in [data-part="music"] .row-detail', (d) => d.map((x) => x.textContent));
  assert.equal(music.find((l) => l.startsWith('Songs '))?.split(':')[0], `Songs ${await words(songs())}`, music.join(' | '));
  assert.match(await page.textContent('#data-since'), /^Counting since \d{1,2} [A-Z][a-z]{2}\.$/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('Data use reads at 390 px in both looks by day and by night; Reset asks, then starts again', opts, async () => {
  const d = new Date(), day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const kept = { v: 1, since: Date.now() - 3 * 86_400_000, unsized: 12, days: { [day]: { 'music.songs': [52_428_800, 10_485_760, 0], api: [204_800, 0, 1024], updates: [3_145_728, 0, 0] } } };
  for (const look of ['ink-lamp', 'classic']) for (const theme of ['light', 'dark']) {
    const { context, page, errors } = await home({ look, theme, kept });
    await dataUse(page);
    // The seeded numbers and this page's own load, as the browser reported it (on Wi-Fi).
    await shows(page, (b) => page.evaluate(async (n) => (await import('/th/data/tally.js')).words(n), b));
    assert.match(await page.textContent('#data-today .row-detail'), /^Wi-Fi (5[3-9]|6\d)\.\d\sMB · Mobile data 10\.0\sMB · Unknown 1\.0\sKB$/, `${look} ${theme}`);
    assert.deepEqual(await page.$$eval('.spage.in [data-part]', (r) => r.slice(0, 2).map((x) => x.dataset.part)), ['music', 'updates'], 'largest first');
    assert.match(await page.textContent('.spage.in .group-section:has([data-part]) ~ .group-section'), /What this phone sends.*Answers that gave no size\d+ answers/s);
    const fit = await page.evaluate(() => { const s = document.querySelector('.spage.in .sscroll'); return { over: s.scrollWidth - s.clientWidth, doc: document.documentElement.scrollWidth - innerWidth, rows: [...document.querySelectorAll('#data-use .row')].map((r) => r.getBoundingClientRect().height) }; });
    assert.ok(fit.over <= 0 && fit.doc <= 0, `${look} ${theme}: no sideways scroll (${JSON.stringify(fit)})`);
    assert.ok(fit.rows.every((h) => h >= 44), `${look} ${theme}: rows are full touch targets (${fit.rows})`);
    if (look === 'classic' && theme === 'light') {
      await page.click('#data-reset');
      await page.waitForSelector('.csheet');
      assert.equal(await page.textContent('.csheet h2'), 'Reset data use?');
      await page.click('.csheet .btn.danger');
      await page.waitForFunction(() => document.querySelector('#data-today .row-value')?.textContent === '0\u00a0KB');
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('th.p.data')).unsized), 0);
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
});

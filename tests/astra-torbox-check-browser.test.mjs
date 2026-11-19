// The lab's TorBox check on the real lab page (/astra/lab/, its CSP and all) in a phone-sized Chromium: the page's
// Worker helper (addons/worker-api.js) is answered by a stub of its signature, and the film comes from the test host
// on another origin (tests/fixtures/astra-host.mjs, which here allows four connections to a link, as TorBox does).
// A run shows every step's line, the fifth connection refused, and copies a report with no address, hash, key or
// file name; a phone signed out stops at the first step; no key in the Worker is said; an address the page may not
// read is said so, with the browser's way to play it; and an address handed over in the fragment fills the field
// and leaves the address bar at once, and is checked only after a second tap once its host alone has been shown
// (any page can link to the lab with one). Local only: nothing here reaches the internet.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { astraHost } from './fixtures/astra-host.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (a stubbed Worker)', timeout: 60_000 };
const HASH = 'fedcba9876543210fedcba9876543210fedcba98'; // invented
const LINK = `https://addon.example/eyJrZXkiOiJpbnZlbnRlZCJ9/playback/${HASH}/torbox/0/Invented.Film.2024.2160p.mkv`;
// The helper the resolver's side of the page provides: api(path, {method, body, signal}) → JSON, or an Error with the plain reason.
const STUB = `export async function api(path, {method = 'GET', body} = {}) {
  const r = await window.__api(path, method, body ?? null);
  if (r.error) throw Object.assign(new Error(r.error), r.steps ? {steps: r.steps} : {});
  return r.json;
}`;
let site, host, browser, base;

before(async () => {
  if (live) return;
  site = await serve(0, {});
  base = `http://127.0.0.1:${site.address().port}`;
  host = await astraHost();
  browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
});
after(async () => { await browser?.close(); site?.close(); await host?.close(); });

/** The lab at phone size with the stubbed helper; `answers(path, method, body)` gives {json} or {error, steps}. */
async function lab(t, answers, where = '') {
  host.reset();
  host.control.limit = 4;
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  t.after(() => context.close());
  const page = await context.newPage();
  const errors = [], asked = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/astra/src/addons/worker-api.js', (route) => route.fulfill({ contentType: 'text/javascript', body: STUB }));
  await page.exposeFunction('__api', (path, method, body) => { asked.push({ path, method, body }); return answers(path, method, body); });
  await page.goto(`${base}/astra/lab/${where}`);
  await page.evaluate(() => { navigator.clipboard.writeText = async (text) => { window.copied = text; }; });
  /** Runs the check on `link` and resolves every step's {state, text} once it is over. */
  const check = async (link = LINK) => {
    await page.fill('#torbox-link', link);
    await page.click('#torbox-run'); // the button reads "Stop" while the check runs
    await page.waitForFunction(() => document.querySelector('#torbox-run').textContent === 'TorBox check', null, { timeout: 40_000 });
    return page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.check-step')].map((li) => [li.dataset.step, { state: li.dataset.state, text: li.innerText }])));
  };
  const report = async () => { await page.click('#torbox-copy'); return page.waitForFunction(() => window.copied).then((h) => h.jsonValue()); };
  return { page, errors, asked, check, report };
}
const play = (url, more = {}) => ({ json: { url, via: 'torbox', size: 939230, type: 'video/x-matroska', readable: true, steps: [{ step: 'key', ok: true, ms: 9 }, { step: 'cached', ok: true, ms: 70 }, { step: 'link', ok: true, ms: 120 }], ...more } });
const worker = ({ torbox = { configured: true, ok: true, plan: 2 }, answer }) => (path) => (path === '/v1/astra/torbox' ? { json: torbox } : answer);

test('a run shows every step as it goes and copies a report with no address, hash, key or file name', opts, async (t) => {
  const film = host.link('multi.mkv', 'tok_Invented0123456789abcdefABCDEF');
  const l = await lab(t, worker({ answer: play(film) }));
  host.control.bps = 1_000_000; // the four stay open while the fifth asks: the test film is small enough to arrive at once otherwise
  const s = await l.check();
  assert.deepEqual(Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v.state])), { a: 'ok', b: 'ok', c: 'ok', d: 'ok', e: 'ok', f: 'info', g: 'ok' });
  assert.match(s.a.text, /Signed in on this phone/);
  assert.match(s.b.text, /accepted by TorBox, plan 2/);
  assert.match(s.c.text, /via torbox · readable by a page/);
  assert.match(s.c.text, /cached ✓ 70 ms/);
  assert.match(s.d.text, /First 64 KiB: 206, readable/);
  assert.match(s.d.text, /Last 64 KiB: 206, readable/);
  assert.match(s.e.text, /Mbit\/s/);
  assert.match(s.f.text, /Four at once: 206 206 206 206\.\s+The fifth, beside them: 429\./, 'the fifth meets the link’s limit');
  // The route is the browser's at hand: Astra's own unpacking where it decodes H.264, the software decoder where it does not (the CI runner).
  assert.match(s.g.text, /Route: (remux|software)\b/);
  assert.deepEqual(l.asked.map((a) => a.path), ['/v1/astra/torbox', '/v1/astra/play']);
  assert.deepEqual(l.asked[1].body, { link: LINK, hash: HASH, mode: 'play' });
  const text = await l.report();
  for (const secret of [LINK, HASH, film, 'addon.example', 'Invented.Film', '127.0.0.1', 'tok_Invented', 'eyJrZXki']) assert.ok(!text.includes(secret), `the report holds ${secret}`);
  assert.match(text, /^Astra TorBox check, /);
  assert.match(text, /\(f\) Connection limit: note\n {4}Four at once/);
  assert.deepEqual(l.errors, []);
});

test('Server speed says first how much it will read, then times each TorBox group from the phone, fastest first; the report carries the table, no address', opts, async (t) => {
  const servers = [
    { group: 'latm', region: 'Invented South', url: host.url('multi.mkv') },
    { group: 'wnam', region: 'Invented West', url: host.url('open.webm') },
    { group: 'enam', region: null, url: `${host.url('multi.mkv')}?nocors` },
  ];
  const l = await lab(t, (path) => (path === '/v1/astra/torbox/servers' ? { json: { servers } } : { error: 'not signed in' }));
  await l.page.click('#torbox-speed');
  await l.page.waitForFunction(() => /1 MB from each/.test(document.querySelector('#torbox-speed-hint').textContent));
  assert.match(await l.page.textContent('#torbox-speed-hint'), /1 MB from each of 3 TorBox server groups \(about 3 MB in all\), 3 at a time\. The lab’s film stops first\./);
  assert.equal(await l.page.textContent('#torbox-speed'), 'Measure (3 MB)');
  assert.equal(host.stats.requests, 0, 'nothing read before the second tap');
  await l.page.click('#torbox-speed');
  await l.page.waitForFunction(() => /^Done/.test(document.querySelector('#torbox-speed-hint').textContent), null, { timeout: 30_000 });
  const rows = await l.page.$$eval('#torbox-speed-table tbody tr', (trs) => trs.map((tr) => [...tr.children].map((td) => td.textContent)));
  assert.deepEqual(rows.map((r) => r[0]).sort(), ['enam', 'latm', 'wnam']);
  assert.deepEqual(rows.at(-1).slice(0, 3), ['enam', '–', 'not readable by the page'], 'one the page may not read goes last');
  assert.ok(rows.slice(0, 2).every((r) => Number(r[2]) > 0 && /^\d+ ms$/.test(r[3])), 'speed and first byte for the others');
  if (process.env.ASTRA_SHOTS) await l.page.locator('#torbox-speed-table').screenshot({ path: `${process.env.ASTRA_SHOTS}/lab-speed.png` });
  assert.deepEqual(l.asked.map((a) => a.path), ['/v1/astra/torbox/servers']);
  const text = await l.report();
  assert.match(text, /^Astra TorBox server speed, /);
  assert.match(text, /\n {4}latm \(Invented South\): [\d.]+ Mbit\/s, first byte \d+ ms/);
  for (const secret of ['127.0.0.1', 'multi.mkv', 'open.webm', 'nocors', 'http']) assert.ok(!text.includes(secret), `the report holds ${secret}`);
  assert.deepEqual(l.errors, []);
});

test('Analyse’s "Copy playback report" is the player’s own plain-words report, with no address in it', opts, async (t) => {
  const film = host.link('multi.mkv', 'tok_Invented0123456789abcdefABCDEF');
  const l = await lab(t, () => ({ error: 'not signed in' }));
  await l.page.click('.paste summary');
  await l.page.fill('#link', film);
  await l.page.click('#link-form button');
  await l.page.waitForSelector('#plan:not([hidden])', { timeout: 20_000 });
  await l.page.click('#copy-report');
  const text = await l.page.waitForFunction(() => window.copied).then((h) => h.jsonValue());
  assert.match(text, /^Astra playback report, /);
  assert.match(text, /\nWhere the time went \(since the film’s load\):\n {4}opened: \d+ ms/);
  assert.match(text, /\nAddress: as given \(not asked of your server\)\n/);
  for (const secret of [film, '127.0.0.1', 'multi.mkv', 'tok_Invented', '/via/']) assert.ok(!text.includes(secret), `the report holds ${secret}`);
  assert.deepEqual(l.errors, []);
});

test('signed out: the first step says so and nothing else is asked', opts, async (t) => {
  const l = await lab(t, () => ({ error: 'not signed in' }));
  const s = await l.check();
  assert.equal(s.a.state, 'bad');
  assert.match(s.a.text, /Not signed in on this phone/);
  assert.deepEqual(['b', 'c', 'd', 'g'].map((k) => s[k].state), ['skip', 'skip', 'skip', 'skip']);
  assert.equal(l.asked.length, 1);
  assert.equal(host.stats.requests, 0, 'the film was never asked for');
});

test('no TorBox key in the Worker: said so, and the follow path is still shown', opts, async (t) => {
  const l = await lab(t, worker({ torbox: { configured: false, ok: null, plan: null }, answer: play(host.url('multi.mkv'), { via: 'follow', size: null, steps: [{ step: 'follow', ok: true, ms: 200 }] }) }));
  const s = await l.check();
  assert.equal(s.b.state, 'bad');
  assert.match(s.b.text, /No TorBox key is set in the Worker/);
  assert.match(s.c.text, /via follow/);
  assert.equal(s.d.state, 'ok');
});

test('an address the page may not read: said so, the reads skipped, and the browser’s own way to play it', opts, async (t) => {
  const l = await lab(t, worker({ answer: play(host.url('multi.mkv') + '?nocors', { readable: false }) }));
  const s = await l.check();
  assert.equal(s.d.state, 'bad');
  assert.match(s.d.text, /not readable by the page: .*the server answers, without letting a page read it/);
  assert.deepEqual([s.e.state, s.f.state], ['skip', 'skip']);
  assert.equal(s.g.state, 'bad');
  assert.match(s.g.text, /Route: native/);
  assert.ok(!(await l.report()).includes('nocors'));
});

test('an address handed over in the fragment fills the field, leaves the address bar at once, and runs only once its host is confirmed', opts, async (t) => {
  const film = host.link('multi.mkv', 'tok_Invented0123456789abcdefABCDEF');
  const l = await lab(t, () => ({ error: 'not signed in' }), `#src=${encodeURIComponent(film)}`);
  assert.equal(await l.page.inputValue('#torbox-link'), film);
  assert.equal(await l.page.evaluate(() => location.hash + location.search), '');
  // The first tap only names the host: nothing is asked of the Worker, and the rest of the address is not shown.
  await l.page.click('#torbox-run');
  const hint = await l.page.textContent('#torbox-hint');
  assert.match(hint, /came in the link that opened the lab.*It is on 127\.0\.0\.1\. Check it\?/);
  for (const secret of ['tok_Invented', 'multi.mkv', '/via/']) assert.ok(!hint.includes(secret), `the hint shows ${secret}`);
  assert.equal(await l.page.textContent('#torbox-run'), 'Check it');
  await l.page.waitForTimeout(300);
  assert.equal(l.asked.length, 0, 'the Worker was not asked');
  // The second tap runs it; a third run asks nothing again.
  await l.page.click('#torbox-run');
  await l.page.waitForFunction(() => document.querySelector('#torbox-run').textContent === 'TorBox check' && document.querySelector('.check-step'));
  assert.equal(l.asked.length, 1);
  await l.page.click('#torbox-run');
  await l.page.waitForFunction(() => document.querySelector('#torbox-run').textContent === 'TorBox check');
  await l.page.waitForTimeout(200);
  assert.equal(l.asked.length, 2, 'confirmed once: the next run goes at once');
  assert.deepEqual(l.errors, []);
});

test('an address typed over a handed-over one runs at the first tap', opts, async (t) => {
  const l = await lab(t, () => ({ error: 'not signed in' }), `#src=${encodeURIComponent(host.url('multi.mkv'))}`);
  const s = await l.check(host.url('open.webm')); // page.fill: the owner's own input
  assert.equal(s.a.state, 'bad');
  assert.equal(l.asked.length, 1);
});

test('the lab lists streams from the add-ons Astra keeps (not only classic Astra\'s), and a stream\'s TorBox button fills the check as the owner\'s own pick', opts, async (t) => {
  const ADDON = 'https://addon.example/cfg-invented';
  const OPAQUE = `${ADDON}/playback/torbox/T-4821/Invented.Film.2024.1080p.mkv`;
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  t.after(() => context.close());
  // As Astra itself stores them (app/store.js): nothing under the classic key.
  await context.addInitScript((url) => { localStorage.setItem('astra.v2.addons', JSON.stringify([{ url, enabled: true, name: 'Invented streams' }])); }, `${ADDON}/manifest.json`);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const json = (route, body) => route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });
  await page.route('https://addon.example/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/manifest.json')) return json(route, { id: 'example.invented', version: '1.0.0', name: 'Invented streams', resources: ['catalog', 'meta', 'stream'], types: ['movie'], idPrefixes: ['tt'],
      catalogs: [{ type: 'movie', id: 'top', name: 'Films', extra: [{ name: 'search' }] }] });
    if (path.includes('/catalog/')) return json(route, { metas: [{ id: 'tt0000777', type: 'movie', name: 'An Invented Film' }] });
    if (path.includes('/meta/')) return json(route, { meta: { id: 'tt0000777', type: 'movie', name: 'An Invented Film' } });
    // A link that names no torrent (a reference in the hash's place); the hash is printed in the description, as an AIOStreams formatter can.
    if (path.includes('/stream/')) return json(route, { streams: [{ name: 'Invented 1080p', description: `Invented.Film.2024.1080p.mkv\n${HASH}`, url: OPAQUE, behaviorHints: { filename: 'Invented.Film.2024.1080p.mkv', videoSize: 939230 } }] });
    return route.fulfill({ status: 404, body: '' });
  });
  const asked = [];
  await page.route('**/astra/src/addons/worker-api.js', (route) => route.fulfill({ contentType: 'text/javascript', body: STUB }));
  await page.exposeFunction('__api', (path, method, body) => { asked.push({ path, body }); return path === '/v1/astra/torbox' ? { json: { configured: true, ok: true, plan: 1 } } : { error: 'Stopped here by the test.' }; });
  await page.goto(`${base}/astra/lab/`);
  assert.match(await page.locator('#addon-hint').textContent(), /1 add-on/);
  await page.fill('#search', 'invented');
  await page.locator('.results .poster', { hasText: 'An Invented Film' }).click();
  const row = page.locator('.stream-row', { hasText: 'Invented 1080p' });
  await row.waitFor({ timeout: 15_000 });
  if (process.env.ASTRA_SHOTS) await page.screenshot({ path: `${process.env.ASTRA_SHOTS}/lab-streams.png` });
  const fits = await row.evaluate((el) => { const r = el.getBoundingClientRect(); return [...el.querySelectorAll('button')].every((b) => { const q = b.getBoundingClientRect(); return q.left >= r.left - 1 && q.right <= innerWidth && q.width > 30; }); });
  assert.ok(fits, 'the stream and its two buttons fit a phone\'s width');
  await row.getByRole('button', { name: 'TorBox', exact: true }).click();
  assert.equal(await page.inputValue('#torbox-link'), OPAQUE);
  assert.equal(await page.locator('#torbox-run').textContent(), 'TorBox check', 'picked by the owner: no second tap asked');
  // The check asks the Worker what Astra itself would: the torrent from the stream's words, the file's name and size.
  await page.click('#torbox-run');
  await page.waitForFunction(() => document.querySelector('#torbox-run').textContent === 'TorBox check' && document.querySelector('.check-step[data-step="c"]')?.dataset.state === 'bad', null, { timeout: 20_000 });
  assert.deepEqual(asked.find((a) => a.path === '/v1/astra/play').body, { link: OPAQUE, hash: HASH, fileName: 'Invented.Film.2024.1080p.mkv', fileSize: 939230, mode: 'play' });
  assert.deepEqual(errors, []);
});

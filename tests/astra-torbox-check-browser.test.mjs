// The lab's TorBox check on the real lab page (/astra/lab/, its CSP and all) in a phone-sized Chromium: the page's
// Worker helper (addons/worker-api.js) is answered by a stub of its signature, and the film comes from the test host
// on another origin (tests/fixtures/astra-host.mjs, which here allows four connections to a link, as TorBox does).
// A run shows every step's line, the fifth connection refused, and copies a report with no address, hash, key or
// file name; a phone signed out stops at the first step; no key in the Worker is said; an address the page may not
// read is said so, with the browser's way to play it; and an address handed over in the fragment fills the field
// and leaves the address bar at once. Local only: nothing here reaches the internet.
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
  assert.match(s.g.text, /Route: remux/);
  assert.deepEqual(l.asked.map((a) => a.path), ['/v1/astra/torbox', '/v1/astra/play']);
  assert.deepEqual(l.asked[1].body, { link: LINK, hash: HASH, mode: 'play' });
  const text = await l.report();
  for (const secret of [LINK, HASH, film, 'addon.example', 'Invented.Film', '127.0.0.1', 'tok_Invented', 'eyJrZXki']) assert.ok(!text.includes(secret), `the report holds ${secret}`);
  assert.match(text, /^Astra TorBox check, /);
  assert.match(text, /\(f\) Connection limit: note\n {4}Four at once/);
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

test('an address handed over in the fragment fills the field and leaves the address bar at once', opts, async (t) => {
  const film = host.url('multi.mkv');
  const l = await lab(t, () => ({ error: 'not signed in' }), `#src=${encodeURIComponent(film)}`);
  assert.equal(await l.page.inputValue('#torbox-link'), film);
  assert.equal(await l.page.evaluate(() => location.hash + location.search), '');
});

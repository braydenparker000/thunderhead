// The apps' arrangements on the phone at 390×844 (th/ported/arrangement.js; MIND-PLAN §3.7):
// Guitar's "today's section" on My songs and Music's "tonight" over the library's home, each with
// its why behind a tap; the senses go out to the Worker by the arrangement's ledger row (seen once,
// the tap, the dismissal), Dismiss hides it and DELETEs the slot, and a reload keeps it gone. Guitar's
// Start, and the mind's `guitar.start_practice` claimed as Guitar opens, land in the reader on the
// planned section. A mocked Worker and a stubbed tab source; everything is synthetic.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (mocked API)' };
const API = 'https://api.example.test';
const OLD = 'https://jarvis-hub-api.braydenparker999.workers.dev';
const GP = readFileSync(new URL('./fixtures/guitar/practice.gp', import.meta.url));
const SONG = 'g:jarvis-test/practice-song';
const TOKEN = `th1_${'B'.repeat(43)}abcdef`;
const ROW = '0190a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a2b';
const MIX = '0190a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a30';
const SHOTS = process.env.SHOTS_DIR;
let site, browser, base;

before(async () => {
  if (live) return;
  site = await serve(0, { api: API });
  base = `http://127.0.0.1:${site.address().port}`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => {
  await browser?.close();
  site?.close();
});

const surface = (app, slot, kind, payload) => ({
  app, slot, kind, schema: 1, payload: { v: 1, ...payload }, why: 'the bridge slipped twice yesterday', topic_key: `${app}.${slot}`,
  ref: null, expires_at: null, written_at: Date.now(), seq: 3, ledger_id: ROW,
});

/** A signed-in phone against a Worker that serves `surfaces` and `pending`, recording every call. */
async function phone(surfaces, pending = []) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const calls = [];
  const sent = [];
  await context.route(`${OLD}/**`, (route) =>
    route.request().url().includes('gprotab/file')
      ? route.fulfill({ status: 200, contentType: 'application/octet-stream', body: GP })
      : route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"none"}' }),
  );
  await context.route(`${API}/**`, (route) => {
    const r = route.request();
    const path = r.url().slice(API.length);
    calls.push({ method: r.method(), path, body: r.postData() });
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (path.startsWith('/v1/senses/batches/')) {
      sent.push(...JSON.parse(r.postData()).events);
      return json({ accepted: 1, rejected: [] });
    }
    // Signed in, Guitar takes its tab files through the Worker (guitar/sources.js).
    if (path.startsWith('/v1/guitar/gprotab/file')) return route.fulfill({ status: 200, contentType: 'application/octet-stream', body: GP });
    if (path === '/v1/surfaces') return json({ items: surfaces, seq: 3 });
    if (path.startsWith('/v1/verbs/pending')) return json({ items: path.endsWith('app=guitar') ? pending : [] });
    if (r.method() === 'DELETE') return route.fulfill({ status: 204 });
    if (path.endsWith('/claim')) return json({ ...pending[0], status: 'claimed' });
    if (path.endsWith('/result')) return json({ ...pending[0], status: 'done' });
    return json({ error: { code: 'not_found' } }, 404);
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/no-such-page`);
  await page.evaluate((token) => new Promise((resolve, reject) => {
    const req = indexedDB.open('th-auth', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => {
      const tx = req.result.transaction('kv', 'readwrite');
      tx.objectStore('kv').put({ session_id: 's1', token, signed_in_at: Date.now(), username: 'example-owner' }, 'session');
      tx.oncomplete = () => { req.result.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }), TOKEN);
  /** Waits until a sense of `type` went out to the Worker (or waits on this phone to go). */
  const went = async (type) => {
    const has = () => sent.some((e) => e.type === type && e.ref === `ledger:${ROW}`);
    for (let i = 0; i < 100 && !has(); i++) await page.evaluate(() => import('/th/senses/send.js').then((m) => m.flush()));
    assert.ok(has(), `${type} went out`);
  };
  return { context, page, calls, sent, errors, went };
}

test("Guitar: today's section on My songs, its why, Start on the bars, Dismiss for good", opts, async () => {
  const plan = surface('guitar', 'today', 'section', { tab: `tab:${SONG}`, sections: [{ key: '4-4', bpm: 60 }], label: 'The bridge' });
  const p = await phone([plan]);
  await p.page.goto(`${base}/guitar/`);
  const card = p.page.locator('.th-arr[data-app=guitar]');
  await card.waitFor({ timeout: 15_000 });
  assert.match(await card.innerText(), /Today’s section[\s\S]*practice song[\s\S]*The bridge · Bars 5–5 at 60 BPM/i);
  await p.page.click('.th-arr .th-arr-chip[aria-expanded=false]');
  assert.equal(await p.page.locator('.th-arr-why').innerText(), 'the bridge slipped twice yesterday');
  for (const b of await card.locator('button').all()) assert.ok((await b.boundingBox()).height >= 44, 'a 44 px control');
  if (SHOTS) await p.page.screenshot({ path: `${SHOTS}/guitar-today.png` });
  await p.went('arrangement.seen');

  await p.page.click('.th-arr-go');
  await p.page.locator('.reader').waitFor({ timeout: 30_000 });
  // Looped on the section, at 60 BPM: 65 % of the score's tempo (the reader's speeds go in fives).
  await p.page.waitForFunction(() => document.querySelector('.tp-btn[aria-label="Loop"]')?.classList.contains('on') && document.querySelector('.tp-btn[aria-label="Speed"] .tp-value')?.textContent === '65%', null, { timeout: 30_000 });
  await p.went('arrangement.tap');
  assert.equal(p.sent.filter((e) => e.type === 'arrangement.seen').length, 1, 'seen once');

  await p.page.goBack();
  await card.waitFor();
  await p.page.click('.th-arr-x');
  await card.waitFor({ state: 'detached' });
  await p.went('arrangement.dismiss');
  assert.ok(p.calls.some((c) => c.method === 'DELETE' && c.path === '/v1/surfaces/guitar/today'), 'the slot DELETEd');
  await p.page.reload();
  await p.page.locator('.pg-head').first().waitFor();
  await p.page.waitForFunction(() => document.querySelector('.th-arr') === null);
  assert.equal(await card.count(), 0, 'dismissed: not drawn again here');
  assert.deepEqual(p.errors, []);
  await p.context.close();
});

test('guitar.start_practice: claimed as Guitar opens, the reader lands on the section; reported with no undo', opts, async () => {
  const intent = { id: '0190a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a31', verb: 'guitar.start_practice', schema: 1, status: 'pending', args: { tab: `tab:${SONG}`, section: '4-4', bpm: 60 } };
  const p = await phone([], [intent]);
  await p.page.goto(`${base}/guitar/`);
  await p.page.locator('.reader').waitFor({ timeout: 30_000 });
  // Looped on the section, at 60 BPM: 65 % of the score's tempo (the reader's speeds go in fives).
  await p.page.waitForFunction(() => document.querySelector('.tp-btn[aria-label="Loop"]')?.classList.contains('on') && document.querySelector('.tp-btn[aria-label="Speed"] .tp-value')?.textContent === '65%', null, { timeout: 30_000 });
  const result = p.calls.find((c) => c.path === `/v1/verbs/${intent.id}/result`);
  assert.deepEqual(JSON.parse(result.body), { ok: true, result: { opened: `tab:${SONG}#4-4` } });
  assert.ok(p.calls.findIndex((c) => c.path.endsWith('/claim')) < p.calls.indexOf(result), 'claimed first');
  if (SHOTS) await p.page.screenshot({ path: `${SHOTS}/guitar-start.png` });
  assert.deepEqual(p.errors, []);
  await p.context.close();
});

test("Music: tonight's mix over the library's home, its why, Dismiss hides it", opts, async () => {
  const p = await phone([surface('music', 'tonight', 'mix', { mix_id: MIX, name: 'Slow evening', tracks: 24 })]);
  await p.page.goto(`${base}/music/?demo`, { waitUntil: 'load' });
  await p.page.waitForFunction(() => window.__cp?.player?.queue?.length >= 1, null, { timeout: 30_000 });
  const card = p.page.locator('.th-arr[data-app=music]');
  await card.waitFor({ state: 'attached', timeout: 15_000 });
  await p.page.evaluate(() => window.__cp.ctx.bus.post('bus_gui', 'cmd_nav_to_lib'));
  await card.waitFor({ state: 'visible', timeout: 15_000 });
  assert.match(await card.innerText(), /Tonight[\s\S]*Slow evening[\s\S]*A mix · 24 songs/i);
  await p.page.click('.th-arr[data-app=music] .th-arr-chip[aria-expanded=false]');
  await p.page.locator('.th-arr[data-app=music] .th-arr-why').waitFor();
  if (SHOTS) await p.page.screenshot({ path: `${SHOTS}/music-tonight.png` });
  await p.went('arrangement.seen');
  await p.page.click('.th-arr[data-app=music] .th-arr-x');
  await card.waitFor({ state: 'detached' });
  await p.went('arrangement.dismiss');
  assert.ok(p.calls.some((c) => c.method === 'DELETE' && c.path === '/v1/surfaces/music/tonight'));
  assert.deepEqual(p.errors, []);
  await p.context.close();
});

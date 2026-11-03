// B1: the shell's and home's senses in Chromium (th/senses/shell.js, th/decide/card.js; the list:
// shared/contract/senses.ts), against the mock Worker: the night's home lines seen on screen (each
// once, by its ledger row), a decision card answered (its class only), the Briefing in view, a
// setting's key (never its value), Podcasts brought to the front and back into the island (with
// how long), an island tap, a reply's Open chip, and a disc chosen on the ring by key; each goes in
// a sealed batch with ids and times only. With home's and the shell's switches off, the same acts
// send nothing. And th/senses/send.js names every type's app as the contract does.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { SENSE_TYPES } from '../shared/contract/senses.ts';
import { API, mockApi, TOKEN } from './fixtures/mock-api.mjs';
import { proposal } from './fixtures/mock-proposals.mjs';

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

const L1 = '0192f0c4-0000-7000-8000-0000000000b1';
const L2 = '0192f0c4-0000-7000-8000-0000000000b2';
const night = new Date('2026-10-29T05:10').getTime();
const line = (slot, text, ledger, at) => ({ app: 'home', slot, kind: 'line', schema: 1, payload: { text }, why: 'arranged overnight', topic_key: 't', ref: null, expires_at: null, written_at: at, seq: Number(slot.slice(-1)), ledger_id: ledger });
const reply = { seq: 2, id: '0192f0c4-0000-7000-8000-0000000000c2', thread_id: '0192f0c4-0000-7000-8000-0000000000aa', author: 'mind', origin: 'mind', kind: 'text', body: 'It is in Music.', meta: { chip: { label: 'Open in Music', app: 'music', path: '/music/' } }, attachments: [], reply_to: null, created_at: Date.now() - 60_000, delivered_at: null, acked_at: null, answered_at: null };

async function open(settings = null) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((s) => {
    try {
      localStorage.setItem('th.p.sent', '1');
      if (s) localStorage.setItem('th.p.settings', JSON.stringify(s));
    } catch {}
  }, settings);
  const api = await mockApi(page, {
    proposals: [proposal({ class: 'money', question: 'Buy the invented album?' })],
    chat: { surfaces: [line('line.1', 'Your new book is ready in Study.', L1, night), line('line.2', 'Rain from 4.', L2, night + 60_000)], messages: [reply] },
  });
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
  await page.goto(`${base}/`, { waitUntil: 'load' });
  await page.waitForSelector('#talk .note[data-ledger]');
  /** What waits on the phone and what reached the Worker, in order. */
  const senses = async () => [
    ...api.calls.filter((c) => c.call.startsWith('PUT /v1/senses/batches/')).flatMap((c) => c.body.events),
    ...(await page.evaluate(() => JSON.parse(localStorage.getItem('th.p.senses') || '[]')).catch(() => [])),
  ];
  // The shell's senses load after the first paint; the lines count as seen only once they are
  // watching, so wait for that before anything covers home (a loaded runner takes a while).
  for (let i = 0; i < 100 && !(await senses()).some((e) => e.type === 'line.seen'); i++) await page.waitForTimeout(100);
  return { page, context, errors, api, senses };
}

/** The acts, each as the owner (or home's own signals for the island, which needs a playing app). */
async function act(page) {
  // A decision card answered Yes.
  await page.waitForSelector('#decision .card.armed');
  await page.click('#decision .yes');
  await page.waitForSelector('#decision .card', { state: 'detached' });
  // The Briefing, then home again.
  await page.evaluate(() => document.querySelector('[data-skip="brief"]').click());
  await page.waitForFunction(() => !document.querySelector('#brief').inert);
  await page.click('#bback');
  await page.waitForFunction(() => document.querySelector('#brief').inert);
  // A setting changed (Settings says so with `th:setting`; its value is never sent).
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('th:setting', { detail: { key: 'appearance.glass', value: 'flat', scope: 'phone' } })));
  // Podcasts in front (the island's ready), back into the island, a tap on its capsule.
  await page.evaluate(() => {
    document.dispatchEvent(new CustomEvent('th:app-ready', { detail: { app: 'podcasts', ms: 200, cold: true } }));
    setTimeout(() => { document.body.dataset.island = 'podcasts'; }, 50);
  });
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    const is = document.createElement('div');
    is.className = 'th-island';
    is.innerHTML = '<button type="button" class="compact">Invented</button>';
    document.body.append(is);
    is.querySelector('button').click();
    is.remove();
  });
  // A reply's Open chip.
  await page.click('#talk .chip');
  // The ring by key: it opens on Music; six steps round to Photos, which comes later (no page to
  // leave for).
  await page.evaluate(() => document.querySelector('[data-skip="apps"]').click());
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
}

test('the shell and home send what the owner does, ids and times only', opts, async () => {
  const { page, context, errors, senses } = await open();
  await act(page);
  const want = ['line.seen', 'card.decide', 'briefing.open', 'settings.change', 'app.open', 'app.close', 'island.tap', 'reply.open_chip', 'ring.choice'];
  for (let i = 0; i < 100; i++) {
    const got = new Set((await senses()).map((e) => e.type));
    if (want.every((t) => got.has(t))) break;
    await page.waitForTimeout(100);
  }
  const all = await senses();
  const of = (type) => all.filter((e) => e.type === type).map((e) => [e.ref ?? null, e.data ?? null]);
  assert.deepEqual(of('line.seen'), [[`ledger:${L1}`, null], [`ledger:${L2}`, null]], 'each line of the Overnight card, once');
  assert.deepEqual(of('card.decide').map(([ref, data]) => [ref.startsWith('proposal:'), data]), [[true, { class: 'money' }]]);
  assert.deepEqual(of('briefing.open'), [[null, null]]);
  assert.deepEqual(of('settings.change'), [['setting:appearance.glass', null]], 'the key, never the value');
  assert.deepEqual(of('app.open').slice(0, 1), [['app:podcasts', null]]);
  assert.equal(of('app.close')[0][0], 'app:podcasts');
  assert.ok(of('app.close')[0][1].ms >= 0 && of('app.close')[0][1].ms < 10_000);
  assert.deepEqual(of('island.tap'), [['app:podcasts', { to: 'details' }]]);
  assert.deepEqual(of('reply.open_chip'), [['app:music', null]]);
  assert.deepEqual(of('ring.choice'), [['app:photos', null]]);
  for (const e of all) assert.ok(Object.hasOwn(SENSE_TYPES, e.type), `${e.type} is in the list`);
  assert.ok(!/Invented|Rain|book is ready|flat|Buy the/.test(JSON.stringify(all)), 'no words travel');
  // The same line seen again (a reload) is not sent again.
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#talk .note[data-ledger]');
  await page.waitForTimeout(800);
  assert.equal((await senses()).filter((e) => e.type === 'line.seen').length, 2);
  assert.deepEqual(errors.filter((e) => !/frame|music/i.test(e)), []);
  await context.close();
});

test('with home and the shell switched off, the same acts send nothing of theirs', opts, async () => {
  const { page, context, senses } = await open({ 'privacy.senses.home': false, 'privacy.senses.shell': false });
  await act(page);
  await page.waitForTimeout(3_500);
  const types = (await senses()).map((e) => e.type);
  assert.deepEqual(types.filter((t) => ['home', 'shell'].includes(SENSE_TYPES[t]?.app)), []);
  await context.close();
});

test('Astra: time watched and a title finished, read from its own progress; nothing with the switch off', opts, async () => {
  // The live site's address (the ported pages load the senses only there), answered by this build.
  const SITE = 'https://thunderhead.z13.web.core.windows.net';
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route(`${SITE}/**`, async (route) => route.fulfill({ response: await route.fetch({ url: base + new URL(route.request().url()).pathname }) }));
  const sent = [];
  await context.route(`${API}/**`, (route) => {
    const r = route.request();
    if (r.method() === 'PUT' && new URL(r.url()).pathname.startsWith('/v1/senses/batches/')) sent.push(...r.postDataJSON().events);
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': SITE, 'Access-Control-Allow-Methods': 'POST, PUT', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' }, body: '{"accepted":1,"rejected":[]}' });
  });
  await context.route(/^https:\/\/(?!thunderhead\.z13|api\.th\.test)/, (route) => route.abort());
  const page = await context.newPage();
  await page.goto(`${SITE}/no-such-page`);
  const now = Date.now();
  const entry = (time, completed = false) => ({ type: 'movie', id: 'tt0000001', videoId: 'tt0000001', season: null, episode: null, time, duration: 6000, updated: Date.now(), completed, meta: { id: 'tt0000001', type: 'movie', name: 'An Invented Film' } });
  await page.evaluate(({ token, e, now }) => new Promise((resolve, reject) => {
    // Ten minutes ago this phone saw the film at 10:00; Astra has since saved 15:00.
    localStorage.setItem('th.p.senses.watch', JSON.stringify({ look: now - 600_000, spots: { 'astra:movie:tt0000001': { t: 600_000, d: 6_000_000, done: false, at: now - 660_000 } } }));
    localStorage.setItem('astra.v2.progress', JSON.stringify({ 'movie:tt0000001|tt0000001': e }));
    const req = indexedDB.open('th-auth', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => {
      const tx = req.result.transaction('kv', 'readwrite');
      tx.objectStore('kv').put({ session_id: 's1', token, signed_in_at: Date.now(), username: 'example-owner' }, 'session');
      tx.oncomplete = () => { req.result.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }), { token: TOKEN, e: entry(900), now });
  await page.goto(`${SITE}/astra/`, { waitUntil: 'load' });
  const until = async (ok) => { for (let i = 0; i < 100 && !ok(); i++) await page.waitForTimeout(100); };
  await until(() => sent.some((e) => e.type === 'media.watch'));
  assert.deepEqual(sent.filter((e) => e.type.startsWith('media.')).map((e) => [e.type, e.ref, e.data]), [['media.watch', 'astra:movie:tt0000001', { ms: 300_000 }]]);
  // Played to the end, then paused: a finish, heard from the video's pause.
  const pause = (e) => page.evaluate((x) => {
    localStorage.setItem('astra.v2.progress', JSON.stringify({ 'movie:tt0000001|tt0000001': { ...x, updated: Date.now() } }));
    const v = document.createElement('video');
    document.body.append(v);
    v.dispatchEvent(new Event('pause'));
    v.remove();
  }, e);
  await pause(entry(6000, true));
  await until(() => sent.some((e) => e.type === 'media.finish'));
  assert.deepEqual(sent.filter((e) => e.type === 'media.finish').map((e) => e.ref), ['astra:movie:tt0000001']);
  assert.ok(!JSON.stringify(sent).includes('Invented'), 'an id, never a name');
  // Astra and My Media switched off: another title watched sends nothing.
  await page.evaluate(() => localStorage.setItem('th.p.settings', JSON.stringify({ 'privacy.senses.media': false })));
  const before = sent.length;
  await pause({ ...entry(1200), id: 'tt0000009', videoId: 'tt0000009' });
  await page.waitForTimeout(6_000);
  assert.equal(sent.length, before);
  await context.close();
});

test('send.js names each type’s app as the contract does', opts, async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${base}/no-such-page`);
  const types = Object.keys(SENSE_TYPES);
  const apps = await page.evaluate(async (ts) => {
    const m = await import('/th/senses/send.js');
    return ts.map((t) => m.appOf(t));
  }, types);
  assert.deepEqual(Object.fromEntries(types.map((t, i) => [t, apps[i]])), Object.fromEntries(types.map((t) => [t, SENSE_TYPES[t].app])));
  await context.close();
});

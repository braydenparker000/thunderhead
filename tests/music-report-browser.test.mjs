// Music's playback log to the Worker (frontend/th/music/report.js; MUSIC.md §5.10), in Chromium at
// phone size against the mock Worker (tests/fixtures/mock-api.mjs): signed in, the real player plays
// two songs (its demo queue, each given a short tone made in the page), the log gains each play's
// time to first sound, and when the page is hidden one batch goes to POST /v1/ops/reports with the
// session: the track ids and timings, never a title, an artist, an album or a blob address. The page
// then going sends only what came after. Signed out, nothing goes. Local only; no network.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { API, mockApi, TOKEN } from './fixtures/mock-api.mjs';
import { outlast, until } from './fixtures/waits.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (mocked API)', timeout: 90_000 };
/** The demo queue's words (frontend/music/src/dev/demo.js): none may leave the phone. */
const WORDS = ['Northern Lights', 'Glass Harbor', 'Low Tide', 'Paper Satellites', 'The Quiet Hours', 'Orbit Songs'];
let site, browser, base;

before(async () => {
  if (live) return;
  site = await serve(0, { api: API });
  base = `http://127.0.0.1:${site.address().port}`;
  browser = await chromium.launch({
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: ['--autoplay-policy=no-user-gesture-required'],
  });
});
after(async () => { await browser?.close(); site?.close(); });

async function musicPage(signedIn) {
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
  // Nothing outside this machine: the old Worker the player still names is never reached.
  await context.route(/^https:\/\/(?!api\.th\.test\/)/, (route) => route.abort());
  const page = await context.newPage();
  // The audio engine stays out: once it runs (sooner or later, by the runner's pace) it joins the next
  // song to the one playing, and a joined song has no wait to time (th/music/report.js firstSound).
  await page.addInitScript(() => { AudioWorklet.prototype.addModule = () => new Promise(() => {}); });
  const api = await mockApi(page);
  await page.goto(`${base}/no-such-page`);
  if (signedIn) await page.evaluate((token) => new Promise((resolve, reject) => {
    const req = indexedDB.open('th-auth', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => {
      const tx = req.result.transaction('kv', 'readwrite');
      tx.objectStore('kv').put({ session_id: 's1', token, signed_in_at: Date.now(), username: 'example-owner' }, 'session');
      tx.oncomplete = () => { req.result.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }), TOKEN);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/music/?demo`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__cp?.player?.queue?.length >= 4 && !!window.__cp.ctx.playbackLog, null, { timeout: 30_000 });
  // The report looks for the log every 500 ms (th/music/report.js installReport): past its next look,
  // on the page's own timers, it times each play. A play before that is not timed at all.
  await outlast(page, 600);
  return { context, page, api, errors };
}

/** Plays the demo's first song, then skips to the second, each a 20-second tone made in the page. */
async function playTwo(page) {
  await page.evaluate(() => {
    const tone = (freq) => {
      const rate = 8000, n = rate * 20, buf = new DataView(new ArrayBuffer(44 + n * 2));
      const text = (at, s) => [...s].forEach((c, i) => buf.setUint8(at + i, c.charCodeAt(0)));
      text(0, 'RIFF'); buf.setUint32(4, 36 + n * 2, true); text(8, 'WAVEfmt '); buf.setUint32(16, 16, true);
      buf.setUint16(20, 1, true); buf.setUint16(22, 1, true); buf.setUint32(24, rate, true); buf.setUint32(28, rate * 2, true);
      buf.setUint16(32, 2, true); buf.setUint16(34, 16, true); text(36, 'data'); buf.setUint32(40, n * 2, true);
      for (let i = 0; i < n; i++) buf.setInt16(44 + i * 2, Math.round(8000 * Math.sin((2 * Math.PI * freq * i) / rate)), true);
      return URL.createObjectURL(new Blob([buf.buffer], { type: 'audio/wav' }));
    };
    const p = window.__cp.player;
    p.queue[0].src = tone(330);
    p.queue[1].src = tone(440);
    p.shuffle = 0;
    p.load(0, true);
  });
  const sounds = (n) => page.waitForFunction((k) => window.__cp.ctx.playbackLog.events.filter((e) => e.type === 'first sound').length >= k, n, { timeout: 30_000 });
  await sounds(1);
  await page.evaluate(() => window.__cp.player.load(1, true));
  await sounds(2);
}

const hide = (page) => page.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  document.dispatchEvent(new Event('visibilitychange'));
});
const reports = (api) => api.calls.filter((c) => c.call === 'POST /v1/ops/reports');

test('signed in, Music sends one batch when hidden: track ids and timings, no titles', opts, async () => {
  const { context, page, api, errors } = await musicPage(true);
  try {
    await playTwo(page);
    const logged = await page.evaluate(() => window.__cp.ctx.playbackLog.events.filter((e) => e.type === 'first sound'));
    assert.deepEqual(logged.map((e) => e.track), ['demo1', 'demo2']);
    for (const e of logged) assert.ok(Number.isInteger(e.ms) && e.ms >= 0 && e.ms < 20_000, `first sound in ${e.ms} ms`);
    await hide(page);
    await until(() => reports(api).length).catch(() => {});
    const [sent, ...more] = reports(api);
    assert.ok(sent, 'a batch went');
    assert.deepEqual(more, []);
    assert.equal(sent.auth, `Bearer ${TOKEN}`);
    assert.equal(sent.body.kind, 'playback');
    const b = sent.body.body;
    assert.deepEqual([b.v, b.seq, b.why, b.lost, b.dropped], [1, 1, 'hidden', false, 0]);
    assert.match(b.page, /^[0-9a-f]{16}$/);
    assert.deepEqual(b.events.map((e) => e.n), b.events.map((_, i) => i), 'each event numbered in this page load');
    assert.ok(Math.abs(b.t0 - Date.now()) < 120_000, 'the log began this page load');
    const first = b.events.filter((e) => e.type === 'first sound');
    assert.deepEqual(first.map((e) => [e.track, e.ms]), logged.map((e) => [e.track, e.ms]));
    assert.deepEqual(b.events.filter((e) => e.type === 'track').map((e) => e.id).slice(-2), ['demo1', 'demo2']);
    assert.ok(Array.isArray(b.state.decks) && b.state.decks.length >= 1, 'the decks\' counters');
    assert.equal(b.state.track.id, 'demo2');
    const text = JSON.stringify(sent.body);
    for (const w of WORDS) assert.ok(!text.includes(w), `no "${w}" in the batch`);
    assert.doesNotMatch(text, /blob:|"title"|"artist"|"album"|Mozilla/);
    assert.ok(new TextEncoder().encode(text).length < 32 * 1024);

    // The page then goes (pagehide): a batch goes only with what came after (nothing repeats).
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await outlast(page, 500); // a negative read: a repeat would have gone with pagehide's batch
    const lastT = b.events.at(-1).t;
    for (const later of reports(api).slice(1)) {
      assert.equal(later.body.body.seq, 2);
      assert.ok(later.body.body.events.every((e) => e.t >= lastT && e.n >= b.events.length), 'only events after the first batch');
      assert.equal(later.body.body.page, b.page);
    }
    assert.ok(reports(api).length <= 2);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('signed out, Music sends nothing but still times each play', opts, async () => {
  const { context, page, api } = await musicPage(false);
  try {
    await playTwo(page);
    await hide(page);
    await outlast(page, 1000); // a negative read: nothing to wait for but time, on the page's own timers
    assert.equal(reports(api).length, 0);
  } finally {
    await context.close();
  }
});

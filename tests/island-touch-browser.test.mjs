// The island follows the finger (th/island/hand.js, shape.js; HOME.md §12.1), in Chromium against a mock Worker:
// Music dragged half way down and let go slowly springs back, flung it becomes the island; an expanding capsule is
// caught mid-flight and turned round from where it was; a sideways swipe slides the next song in. Local only.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (mocked API)', timeout: 120_000 };
const OLD = 'https://jarvis-hub-api.braydenparker999.workers.dev';
const TOKEN = `th1_${'C'.repeat(43)}abcdef`;
let site, mock, browser, base;

before(async () => {
  if (live) return;
  mock = createServer((req, res) => {
    const cors = { 'Access-Control-Allow-Origin': req.headers.origin ?? '*', Vary: 'Origin' };
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...cors, 'Access-Control-Allow-Methods': 'GET, POST, PUT', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-None-Match, TH-Client' });
      return res.end();
    }
    const url = new URL(req.url, 'http://x');
    const answers = {
      '/v1/music/catalog': { version: 1, kind: 'r2-library', complete: true, count: 0, generatedAt: '2026-11-01T00:00:00.000Z', tracks: [] },
      '/v1/auth/me': { session_id: 's1', notices: [], recovery_confirmed: true },
      '/v1/threads/today': { thread: null, messages: [], seq: 1, day: new Date().toISOString().slice(0, 10) },
      '/v1/settings': { 'owner.tz': 'UTC', 'mind.status': { state: 'asleep', note: null, since: null } },
      '/v1/surfaces': { items: [], seq: 1 }, '/v1/verbs/pending': { items: [] }, '/v1/proposals': { items: [] },
      '/v1/changes': { items: [], next_after: 1, more: false }, '/v1/podcasts/progress': { items: [] }, '/v1/podcasts/browse': { results: [] },
    };
    res.writeHead(url.pathname in answers ? 200 : 404, { ...cors, 'Content-Type': 'application/json' });
    res.end(JSON.stringify(answers[url.pathname] ?? { error: { code: 'not_found', message: 'no', request_id: 't' } }));
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  site = await serve(0, { api: `http://127.0.0.1:${mock.address().port}` });
  base = `http://127.0.0.1:${site.address().port}`;
  browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--autoplay-policy=no-user-gesture-required'] });
});
after(async () => { await browser?.close(); site?.close(); mock?.close(); });

const settle = (page) => page.evaluate(() => import('/th/island/island.js').then((m) => m.whenResting()));
const shape = (page) => page.evaluate(() => import('/th/island/shape.js').then((m) => m.box()));
/** Music in front, ready, with two invented tones queued and playing. */
async function music(context) {
  await context.addInitScript(() => Object.defineProperty(navigator, 'connection', { value: { saveData: true }, configurable: true }));
  await context.route(`${OLD}/**`, (route) => route.abort());
  const page = await context.newPage();
  await page.goto(`${base}/no-such-page`);
  await page.evaluate((token) => new Promise((resolve) => {
    const req = indexedDB.open('th-auth', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => { const tx = req.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put({ session_id: 's1', token, signed_in_at: Date.now(), username: 'example-owner' }, 'session'); tx.oncomplete = () => { req.result.close(); resolve(); }; };
  }), TOKEN);
  await page.goto(`${base}/`);
  await page.evaluate(() => import('/th/island/island.js').then((m) => m.openApp('music')));
  await page.waitForSelector('iframe[data-app=music][data-ready=true]', { state: 'attached', timeout: 20_000 });
  await settle(page);
  const wav = Buffer.alloc(44 + 8000 * 2 * 30);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
  await page.evaluate((data) => {
    const w = document.querySelector('iframe[data-app=music]').contentWindow, p = w.__cp.player;
    const src = w.URL.createObjectURL(new w.Blob([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], { type: 'audio/wav' }));
    p.queue = ['One', 'Two', 'Three'].map((n) => ({ id: `tone-${n}`, title: `An invented tone ${n}`, artist: 'An invented band', durationMs: 30000, src }));
    p.index = 0; p.load(0, true);
  }, wav.toString('base64'));
  return page;
}
/** A drag on the app (its bottom 150 px), dispatched in the page with fixed timestamps: `gap` ms between 5 px moves,
 * held `hold` ms before letting go. Its speed is then the drag's own, not the gaps between calls on a loaded runner. */
const drag = (page, { to, gap, hold = 0 }) => page.evaluate(({ to, gap, hold }) => {
  const f = document.querySelector('iframe[data-app=music]'), w = f.contentWindow, x = 195;
  let y = 760, t = w.performance.now();
  const target = w.document.elementFromPoint(x, y) || w.document.documentElement;
  // The finger is at (x, y) on the screen; in the app that is under its zoom, as a real touch's point is.
  const send = (type) => {
    const r = f.getBoundingClientRect(), k = r.width / f.offsetWidth;
    const e = new w.PointerEvent(type, { clientX: (x - r.left) / k, clientY: (y - r.top) / k, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true, composed: true });
    Object.defineProperty(e, 'timeStamp', { value: t });
    target.dispatchEvent(e);
  };
  send('pointerdown');
  const seen = [];
  for (y += 5; y <= to; y += 5) {
    t += gap;
    send('pointermove');
    seen.push({ clip: f.parentElement.style.clipPath, zoom: new DOMMatrix(getComputedStyle(f).transform).a });
  }
  y -= 5; t += hold;
  send('pointerup');
  return seen;
}, { to, gap, hold });

test('Music follows the finger down: let go slowly half way it springs back, flung it becomes the island', opts, async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'allow', hasTouch: true });
  try {
    const page = await music(context);
    const front = () => page.evaluate(() => { const f = document.querySelector('iframe[data-app=music]'); return { away: f.classList.contains('away'), island: document.body.dataset.island ?? null, clip: f.parentElement.style.clipPath, zoom: f.style.transform }; });
    // Half way (70 of the 160 px the shrink takes), slowly, and held still before letting go.
    const slow = await drag(page, { to: 830, gap: 40, hold: 250 });
    const last = slow.at(-1);
    assert.match(last.clip, /^path\(/, 'the surface is clipped to its shape while dragged');
    assert.ok(last.zoom < .9 && last.zoom > .7, `it shrinks under the finger: ${last.zoom}`);
    assert.ok(slow.every((s, i) => i === 0 || s.zoom <= slow[i - 1].zoom + 1e-6), 'it follows the finger 1:1, never back');
    await settle(page);
    assert.deepEqual(await front(), { away: false, island: null, clip: '', zoom: '' }, 'let go slowly, it springs back whole');
    // The same half way, flung.
    await drag(page, { to: 830, gap: 0 });
    await settle(page);
    const into = await front();
    assert.deepEqual([into.away, into.island], [true, 'music'], 'flung, it becomes the island');
    assert.equal(await page.locator('.th-island').isVisible(), true);
    assert.equal(Math.round((await shape(page))[3]), 36, 'compact');
  } finally { await context.close(); }
});

test('an expanding capsule is caught mid-flight and turned round from where it is; a swipe slides the next song in', opts, async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'allow' });
  try {
    const page = await music(context);
    await page.evaluate(() => import('/th/island/island.js').then((m) => m.collapse('test')));
    await settle(page);
    // Tap: it starts to grow. Two frames on, a finger catches it and drags it back up.
    const [x, , w] = await shape(page);
    await page.mouse.click(x + w / 2, 28);
    // Its height is read in the page as the finger lands (pointerdown), not from outside a moment later.
    await page.evaluate(async () => {
      const m = await import('/th/island/shape.js');
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      addEventListener('pointerdown', () => { window.__caught = m.box()[3]; }, { capture: true, once: true });
    });
    await page.mouse.move(x + w / 2, 40); await page.mouse.down();
    const caught = await page.evaluate(() => window.__caught);
    const heights = [];
    for (let k = 1; k <= 6; k++) { await page.mouse.move(x + w / 2, 40 - 8 * k); heights.push((await shape(page))[3]); }
    await page.mouse.up();
    await settle(page);
    assert.ok(caught > 36 && caught < 150, `caught on its way: ${caught}`);
    assert.ok(Math.max(...heights) < Math.min(180, caught + 60), `it went on from where it was, without a jump: ${caught} then ${heights}`);
    assert.ok(heights.at(-1) < heights[1], `then it followed the finger up: ${heights}`);
    assert.equal(Math.round((await shape(page))[3]), 36, 'let go upwards, it folds back into the capsule');
    // Sideways: the title follows the finger, and the next song slides in from the right.
    const index = () => page.evaluate(() => document.querySelector('iframe[data-app=music]').contentWindow.__cp.player.index);
    const before = await index();
    const [bx, , bw] = await shape(page);
    await page.mouse.move(bx + bw / 2, 28); await page.mouse.down();
    await page.mouse.move(bx + bw / 2 - 20, 28, { steps: 2 });
    const held = await page.locator('.th-island .title:not(.ghost)').evaluate((e) => parseFloat(e.style.translate));
    await page.mouse.move(bx + bw / 2 - 70, 28, { steps: 4 });
    await page.mouse.up();
    const sliding = await page.evaluate(() => ({ ghosts: document.querySelectorAll('.th-island .ghost').length, title: document.querySelector('.th-island .title:not(.ghost)').textContent }));
    await settle(page);
    assert.ok(held < -10, `the title under the finger: ${held}`);
    assert.equal(await index(), before + 1, 'the swipe skipped');
    assert.deepEqual(sliding, { ghosts: 3, title: 'An invented tone Two' }, 'the old title and art slide out as the new arrive');
    assert.equal(await page.locator('.th-island .ghost').count(), 0, 'and are gone at rest');
  } finally { await context.close(); }
});

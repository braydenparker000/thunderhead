// Never means never (frontend/th/music/dj.js stepOver, inside music/src/player/player.js): in the real
// music page (its demo queue, in Chromium at phone size, no network), a song rated "not for me" is
// passed over by next, by previous and when a song ends, shuffled or not; a tap on it still plays it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { API, mockApi } from './fixtures/mock-api.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (mocked API)', timeout: 90_000 };
let site, browser, base;

before(async () => {
  if (live) return;
  site = await serve(0, { api: API });
  base = `http://127.0.0.1:${site.address().port}`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => { await browser?.close(); site?.close(); });

test('a song rated "not for me" is passed over by next, previous and the advance; a tap still plays it', opts, async () => {
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
  await context.route(/^https:\/\/(?!api\.th\.test\/)/, (route) => route.abort());
  const page = await context.newPage();
  await mockApi(page);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/music/?demo`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__cp?.player?.queue?.length >= 4, null, { timeout: 30_000 });
  const r = await page.evaluate(() => {
    const p = window.__cp.player;
    const id = () => p.track.id;
    p.shuffle = 0;
    p.repeat = 1;
    p.order = null;
    p.queue[1].rating = 1;
    p.queue[2].rating = 1;
    const out = {};
    p.load(0, false);
    out.next = (p.step(1), p.index);
    out.prev = (p.step(-1), p.index);
    p.load(0, false);
    out.coming = p.predictNext()?.id === p.queue[3].id;
    out.advance = (p.advance(), p.index);
    p.load(1, false);
    out.tap = p.index;
    out.fromIt = (p.step(1), p.index);
    // Shuffled: never one of them, however it falls.
    p.shuffle = 1;
    p.order = null;
    p.load(0, false);
    out.shuffled = new Set();
    for (let k = 0; k < 3 * p.queue.length; k++) { p.step(1); out.shuffled.add(p.index); }
    out.shuffled = [...out.shuffled];
    out.id = id();
    return out;
  });
  assert.equal(r.next, 3, 'next: past songs 1 and 2');
  assert.equal(r.prev, 0, 'previous: back past them');
  assert.ok(r.coming, 'the song that comes next (preloaded, cross-faded into) is the one after them');
  assert.equal(r.advance, 3, 'a song that ends goes on past them');
  assert.equal(r.tap, 1, 'a tap on one plays it');
  assert.equal(r.fromIt, 3, 'and next from it goes on past the other');
  assert.ok(!r.shuffled.includes(1) && !r.shuffled.includes(2), `shuffled: ${r.shuffled}`);
  assert.deepEqual(errors, []);
  await context.close();
});

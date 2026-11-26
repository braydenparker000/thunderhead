// Guitar's reader keeps the screen on while practising and records the session when the owner leaves
// (GUITAR.md §8.1, §9): a touch holds the screen lock, and 90 s later with nothing playing it is let
// go (the page's clock is held, and moved by the test alone); a session is kept when the page goes
// with the reader open and sent when the page comes back or Guitar next opens, never a second time
// when the reader then closes.
// The tab file is a saved copy on the phone (fixtures/guitar-saved.mjs); the screen lock is a stand-in that counts; no
// network.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { keepScore } from './fixtures/guitar-saved.mjs';
import { outlast } from './fixtures/waits.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (stubbed tab source)' };
const GP = readFileSync(new URL('./fixtures/guitar/practice.gp', import.meta.url));
const SONG = 'g:jarvis-test/practice-song';
const TOKEN = `th1_${'B'.repeat(43)}abcdef`;
let site, browser, base;

before(async () => {
  if (live) return;
  site = await serve(0, {});
  base = `http://127.0.0.1:${site.address().port}`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => {
  await browser?.close();
  site?.close();
});

async function context() {
  const c = await browser.newContext({ viewport: { width: 390, height: 844 } });
  // The tab is a saved copy on this phone: there is no tab source signed out (MIGRATION.md §8).
  await keepScore(c, base, SONG, GP);
  return c;
}
const ready = (page) =>
  page.waitForFunction(() => document.querySelector('.tp-play') && !document.querySelector('.tp-play').disabled, null, { timeout: 30_000 });
const sessions = (page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('th.p.senses') || '[]').filter((e) => e.type === 'guitar.session').length);

test('the screen stays on for 90 s after a touch, then is let go', opts, async () => {
  const c = await context();
  // A screen lock that counts what is held (headless Chrome grants none).
  await c.addInitScript(() => {
    window.__held = 0;
    Object.defineProperty(navigator, 'wakeLock', {
      value: {
        request: async () => {
          const lock = new EventTarget();
          let gone = false;
          lock.release = async () => {
            if (gone) return;
            gone = true;
            window.__held--;
            lock.dispatchEvent(new Event('release'));
          };
          window.__held++;
          return lock;
        },
      },
    });
  });
  const page = await c.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.clock.install();
  await page.goto(`${base}/guitar/#play=${encodeURIComponent(SONG)}`);
  await ready(page);
  assert.equal(await page.evaluate(() => window.__held), 0, 'nothing held before a touch or a play');
  // From here only the test moves the page's clock. A flowing clock runs its timers from a pump of its
  // own, and a pump still finishing after a jump of the test's sets the clock back to the time the pump
  // ran to (Playwright's _runTo ends on _advanceNow of its own end): the 60 s jump was undone, the
  // reader's 90 s timer then lay a minute past the next jump, and the lock was still held (two runs
  // timed out waiting for it to go, one read it held). Held 5 s ahead, past what the call can take.
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 5000));
  /** A touch on the reader, and when it was on the page's clock (the reader's own performance.now()). */
  const touch = () => page.evaluate(() => {
    document.querySelector('.reader').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    return performance.now();
  });
  /** What is held, read at the page's time, with how long after the last touch that is. */
  const read = (since) => page.evaluate((t) => ({ held: window.__held, now: performance.now(), afterTouch: performance.now() - t }), since);
  /** Moves the held clock to `t` on the page's performance.now(), firing each timer due by then, and reads
   * it back: a pump of the flowing clock that was still finishing as it was held could set it back once,
   * and the jump is made again from there. */
  const jumpTo = async (t) => {
    for (let i = 0; i < 3; i++) {
      const now = await page.evaluate(() => performance.now());
      if (now >= t) return;
      await page.clock.fastForward(t - now);
    }
    assert.fail(`the page's clock never reached ${t} (${JSON.stringify(await read(t))})`);
  };
  const first = await touch();
  let s = await read(first);
  assert.equal(s.held, 1, `held at the touch (${JSON.stringify(s)})`);
  await jumpTo(first + 60_000);
  s = await read(first);
  assert.equal(s.held, 1, `still held 60 s after the touch (${JSON.stringify(s)})`);
  const second = await touch();
  await jumpTo(second + 89_900);
  s = await read(second);
  assert.equal(s.held, 1, `a touch starts the 90 s again, one lock, not two: held 89.9 s after it, 149.9 s after the first (${JSON.stringify(s)})`);
  // The reader looks again 50 ms past the 90 s (holdScreen's idle timer).
  await jumpTo(second + 90_100);
  s = await read(second);
  assert.equal(s.held, 0, `let go by 90.1 s after the last touch (${JSON.stringify(s)})`);
  assert.deepEqual(errors, []);
  await c.close();
});

test('the session is kept when the owner leaves with the reader open, once', opts, async () => {
  const c = await context();
  const page = await c.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/no-such-page`);
  // Signed in on this phone, so the senses wait to be sent (this site has no API, so they stay).
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
  const seconds = () => page.evaluate((song) => JSON.parse(localStorage.getItem('jarvis.guitar.v2') || '{}').songs?.[song]?.seconds ?? 0, SONG);
  /** Plays until the library counts 10 s more of practice (two of the reader's 5 s steps). */
  const play = async () => {
    const from = await seconds();
    await page.click('.tp-play');
    await page.waitForFunction(
      ({ song, n }) => (JSON.parse(localStorage.getItem('jarvis.guitar.v2') || '{}').songs?.[song]?.seconds ?? 0) >= n,
      { song: SONG, n: from + 10 },
      { timeout: 30_000 },
    );
  };

  await page.goto(`${base}/guitar/#play=${encodeURIComponent(SONG)}`);
  await ready(page);
  await play();
  // The page goes with the reader open (kept for Back): the session is kept then, and sent when the
  // page comes back.
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('th.p.guitar.session')).length), 1);
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('th.p.senses') || '[]').some((e) => e.type === 'guitar.session'));
  assert.equal(await page.evaluate(() => localStorage.getItem('th.p.guitar.session')), null, 'taken out once sent');
  // Back on the page, the reader closes: no second session.
  await page.goBack();
  await page.locator('.reader:not(.closing)').waitFor({ state: 'detached' });
  await outlast(page, 500); // a negative read: nothing to wait for but time, on the page's own timers
  assert.equal(await sessions(page), 1, 'one session, not two');

  // Going to another page with the reader open keeps the next session too.
  await page.goto(`${base}/no-such-page`);
  await page.goto(`${base}/guitar/#play=${encodeURIComponent(SONG)}`);
  await ready(page);
  await play();
  await page.goto(`${base}/no-such-page`);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('th.p.guitar.session') || '[]').length), 1, 'kept as the page went');
  // Sent when Guitar next opens.
  await page.goto(`${base}/guitar/`);
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('th.p.senses') || '[]').filter((e) => e.type === 'guitar.session').length === 2, null, { timeout: 10_000 });
  assert.equal(await page.evaluate(() => localStorage.getItem('th.p.guitar.session')), null);
  assert.deepEqual(errors, []);
  await c.close();
});

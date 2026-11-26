// Guitar's reader keeps the screen on while practising and records the session when the owner leaves
// (GUITAR.md §8.1, §9): a touch holds the screen lock, and 90 s later with nothing playing it is let
// go (the page's clock is moved), however the reader scrolls its own sheet meanwhile; a session is kept
// when the page goes with the reader open and sent when the page comes back or Guitar next opens, never
// a second time when the reader then closes.
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
  await page.locator('.reader').dispatchEvent('pointerdown');
  await page.waitForFunction(() => window.__held === 1);
  await page.clock.fastForward(60_000);
  assert.equal(await page.evaluate(() => window.__held), 1, 'still held 60 s after the touch');
  await page.locator('.reader').dispatchEvent('pointerdown');
  await page.clock.fastForward(60_000);
  assert.equal(await page.evaluate(() => window.__held), 1, 'a touch starts the 90 s again; one lock, not two');
  await page.clock.fastForward(31_000);
  await page.waitForFunction(() => window.__held === 0);
  // The sheet scrolling itself (following the playing line, drawn again for a new width) is not a touch:
  // 60 s after a touch the reader scrolls its sheet, and the screen is still let go 90 s after the touch.
  await page.locator('.reader').dispatchEvent('pointerdown');
  await page.waitForFunction(() => window.__held === 1);
  await page.clock.fastForward(60_000);
  const scrolled = await page.evaluate(() => new Promise((resolve) => {
    const s = document.querySelector('.rd-scroll');
    s.querySelector('.rd-sheet').style.paddingBottom = '2000px'; // room to scroll, whatever the tab's length
    // Heard after the reader's own listener (added first), so the reader has seen this scroll.
    s.addEventListener('scroll', () => resolve(s.scrollTop), { once: true });
    s.scrollTo({ top: 300 });
  }));
  assert.ok(scrolled > 0, `the sheet scrolled (to ${scrolled})`);
  await page.clock.fastForward(31_000);
  assert.equal(await page.evaluate(() => window.__held), 0, 'the reader scrolling its own sheet does not keep the screen on');
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

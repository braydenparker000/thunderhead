// Guitar's practice loop in the real reader (th/guitar/practice.js, NEXT-BATCH.md part 9, GUITAR.md
// §4.3, §8.1): with yesterday's records on the phone, the song opens on the bars that went worst at
// the ladder's speed, with Undo; each pass of the loop asks Clean or Not yet, two clean in a row step
// the speed up, an unanswered pass is not counted; each marked pass, the new best and the session
// wait as practice senses with numbers only. The tab file comes from a stubbed old Worker; no network.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { outlast } from './fixtures/waits.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (stubbed tab source)' };
const OLD = 'https://jarvis-hub-api.braydenparker999.workers.dev';
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

const yesterday = () => {
  const d = new Date(Date.now() - 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

test('the ladder: opens on the worst bars, asks after each pass, steps up after two clean; senses wait with numbers only', opts, async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route(`${OLD}/**`, (route) =>
    route.request().url().includes('gprotab/file')
      ? route.fulfill({ status: 200, contentType: 'application/octet-stream', body: GP })
      : route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"none"}' }),
  );
  // Every toast, in order (the sounds' 404 replaces the first one in a moment).
  await context.addInitScript(() => {
    window.__toasts = [];
    new MutationObserver(() => {
      const t = document.querySelector('#toast');
      if (t && t.classList.contains('show') && window.__toasts.at(-1) !== t.textContent) window.__toasts.push(t.textContent);
    }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/no-such-page`);
  // Signed in on this phone, so the senses wait to be sent (this site has no API, so they stay).
  await page.evaluate(({ token, song, day }) => new Promise((resolve, reject) => {
    localStorage.setItem('th.p.guitar.ladder', JSON.stringify({
      prefs: { on: true, start: 70, step: 4, target: 100 },
      songs: { [song]: {
        '0-1': { day, passes: 10, clean: 8, ceiling: 80, best: 80, last: null },
        '4-4': { day, passes: 10, clean: 3, ceiling: 72, best: 72, last: null },
      } },
    }));
    const req = indexedDB.open('th-auth', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => {
      const tx = req.result.transaction('kv', 'readwrite');
      tx.objectStore('kv').put({ session_id: 's1', token, signed_in_at: Date.now(), username: 'example-owner' }, 'session');
      tx.oncomplete = () => { req.result.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }), { token: TOKEN, song: SONG, day: yesterday() });

  await page.goto(`${base}/guitar/#play=${encodeURIComponent(SONG)}`);
  // Section 4-4 is the score's fifth bar, which its own numbering (repeats) calls measure 3.
  await page.waitForFunction(() => window.__toasts.some((t) => /^Starting on bar \d+, the hardest last time \(3 of 10 clean\)\.Undo$/.test(t)), null, { timeout: 30_000 });
  const n = (await page.evaluate(() => window.__toasts.join('\n'))).match(/Starting on bar (\d+)/)[1];
  assert.equal(await page.textContent('.tp-btn[aria-label="Speed"] .tp-value'), '70%', "yesterday's ceiling 72 less 8 is under the start: 70 %");
  assert.equal(await page.textContent('.tp-btn[aria-label="Loop"] small'), `${n}–${n}`);

  await page.click('.tp-play');
  const strip = page.locator('.th-judge');
  await strip.waitFor({ timeout: 15_000 });
  assert.match(await strip.getAttribute('aria-label'), /How was that pass at 67 BPM\?/);
  await page.click('.th-judge .th-clean');
  await strip.waitFor({ state: 'detached' });
  await strip.waitFor({ timeout: 15_000 });
  await page.keyboard.press('c');
  await page.waitForFunction(() => document.querySelector('.tp-btn[aria-label="Speed"] .tp-value')?.textContent === '74%');
  // A pass nobody marks is not counted: the strip goes after 3 s. Paused first, so the next pass
  // (3.4 s at 74 %) can't bring the next strip before this one has gone.
  await strip.waitFor({ timeout: 15_000 });
  await page.click('.tp-play');
  await strip.waitFor({ state: 'detached', timeout: 5_000 });

  const kept = await page.evaluate((song) => JSON.parse(localStorage.getItem('th.p.guitar.ladder')).songs[song]['4-4'], SONG);
  assert.equal(kept.passes, 2);
  assert.equal(kept.clean, 2);
  assert.equal(kept.ceiling, 70);
  assert.deepEqual(kept.last, { day: yesterday(), passes: 10, clean: 3, ceiling: 72 });

  // Leaving the reader closes the session.
  await page.goBack();
  await page.waitForFunction(() => (JSON.parse(localStorage.getItem('th.p.senses') || '[]')).some((e) => e.type === 'guitar.session'));
  const senses = await page.evaluate(() => JSON.parse(localStorage.getItem('th.p.senses') || '[]').filter((e) => e.type.startsWith('guitar.') && e.type !== 'guitar.open'));
  const passes = senses.filter((e) => e.type === 'guitar.pass');
  assert.equal(passes.length, 2);
  assert.deepEqual(passes[0].data, { bpm: 67, speed_pct: 70, clean: true, by: 'owner' });
  assert.equal(passes[0].ref, `tab:${SONG}#b${n}-${n}`);
  assert.equal(senses.filter((e) => e.type === 'guitar.bpm').length, 0, '70 % is under the best of 72 %');
  const session = senses.find((e) => e.type === 'guitar.session');
  assert.equal(session.ref, `tab:${SONG}`);
  assert.deepEqual(session.data.sections, ['4-4']);
  assert.equal(session.data.bpm, 67, 'the best clean tempo the session reached');
  assert.ok(session.data.seconds > 5 && session.data.played_seconds >= 5, JSON.stringify(session.data));
  assert.deepEqual(senses.filter((e) => e.type === 'guitar.piece_opened').map((e) => [e.ref, e.data]), [[`tab:${SONG}`, undefined]], 'the piece opened, once');
  assert.ok(JSON.stringify(senses).length < 2000, 'numbers and bar ranges only');

  // With Guitar's senses switched off (Settings › Privacy, as this phone last saw it), opening the
  // piece again sends nothing.
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('th.p.senses') || '[]').length);
  await page.evaluate(() => localStorage.setItem('th.p.settings', JSON.stringify({ 'privacy.senses.guitar': false })));
  await page.goto(`${base}/guitar/#play=${encodeURIComponent(SONG)}`);
  await page.waitForFunction(() => document.querySelector('.tp-play') && !document.querySelector('.tp-play').disabled, null, { timeout: 30_000 });
  await outlast(page, 500); // a negative read: nothing to wait for but time, on the page's own timers
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('th.p.senses') || '[]').length), before, 'nothing kept to send');
  assert.deepEqual(errors, []);
  await context.close();
});

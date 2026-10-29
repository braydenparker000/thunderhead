// Opening Settings → What I remember for the Memory page suites: Chromium at phone size against
// the mocked Worker (mock-api.mjs), signed in, with the page's clock standing still once the page
// is up, so a test moves time itself (the tap guard, the filter's pause, the 10 s undo). No guessed
// delays: `until` waits on what the page shows or what the mock saw.
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { chromium } from 'playwright';
import { serve } from '../../scripts/serve.mjs';
import { API, mockApi, TOKEN } from './mock-api.mjs';

export { API };

export function memoryPages() {
  let server, browser, base;
  return {
    async start() {
      server = await serve(0, { api: API });
      base = `http://127.0.0.1:${server.address().port}`;
      browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
    },
    async stop() { await browser?.close(); server?.close(); },
    base: () => base,
    newContext: () => browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block' }),
    /** A signed-in Memory page; `context` reuses one (its storage too), `mock` seeds the Worker. */
    async open({ theme = 'light', mock = {}, context = null } = {}) {
      const ctx = context ?? (await this.newContext());
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      await page.addInitScript((t) => { try { localStorage.setItem('th-theme', t); } catch {} }, theme);
      await page.clock.install();
      const api = await mockApi(page, mock);
      await page.goto(`${base}/no-such-page`);
      await page.evaluate(([token]) => new Promise((resolve, reject) => {
        const req = indexedDB.open('th-auth', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('kv');
        req.onsuccess = () => {
          const tx = req.result.transaction('kv', 'readwrite');
          tx.objectStore('kv').put({ session_id: 's1', token, signed_in_at: Date.now(), username: 'example-owner' }, 'session');
          tx.oncomplete = () => { req.result.close(); resolve(); };
          tx.onerror = () => reject(tx.error);
        };
      }), [TOKEN]);
      errors.length = 0;
      await page.goto(`${base}/settings/memory/`, { waitUntil: 'load' });
      await ready(page);
      return { page, context: ctx, errors, api };
    },
  };
}

/** The page drew its sections; time then stops, 800 ms on (past the 500 ms tap guard). */
export async function ready(page) {
  await page.waitForSelector('.msections:not([aria-busy])');
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 800));
}

export const headings = (page) => page.$$eval('.msec h2', (hs) => hs.map((h) => h.textContent));
export const ops = (api) => api.calls.filter((c) => c.call === 'POST /v1/memory/ops').map((c) => c.body.ops[0]);
export const forgets = (api) => ops(api).filter((o) => o.op === 'forget').map((o) => o.id);

/** Reads until the value is `want` (5 s at most), then asserts it. */
export async function until(read, want, message) {
  const end = Date.now() + 5_000;
  let got = await read();
  while (!isDeepStrictEqual(got, want) && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 20));
    got = await read();
  }
  assert.deepEqual(got, want, message);
}

/** Forget the fact with `text` through the page: open it, Forget, past the tap guard, confirm. */
export async function forget(page, text) {
  const row = `.mrow:has-text("${text}")`;
  await page.click(`${row} .mtext`);
  await page.click(`${row} button:has-text("Forget")`);
  await page.clock.runFor(600);
  await page.click('.csheet button:has-text("Forget")');
  await page.waitForSelector('.utoast.show');
}

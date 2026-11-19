// Home's movements that used to lay the page out on every frame, in Chromium at 390×844 against the
// mocked Worker: they now move on transforms, opacity and clips (DESIGN-SYSTEM.md §8; apps/home/fold.js).
// A menu group folding slides the groups under it instead of animating its rows' height.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { API, mockApi, TOKEN } from './fixtures/mock-api.mjs';

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

const THREAD = '0192f0c4-0000-7000-8000-0000000000aa';
const say = (n, author, body, meta = null) => ({ seq: n, id: `0192f0c4-0000-7000-8000-${String(900 + n).padStart(12, '0')}`, thread_id: THREAD, author, origin: author === 'owner' ? 'owner_device' : 'mind', kind: 'text', body, meta, attachments: [], reply_to: null, created_at: Date.now() - (100 - n) * 60_000, delivered_at: null, acked_at: null, answered_at: Date.now() });

async function open({ messages = [say(1, 'owner', 'A calm start, please.')], reduced = false, ls = {} } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, serviceWorkers: 'block', reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript((ls) => { try { localStorage.setItem('th-theme', 'light'); localStorage.setItem('th.p.sent', '1'); for (const [k, v] of Object.entries(ls)) localStorage.setItem(k, v); } catch {} }, ls);
  const api = await mockApi(page, { chat: { messages } });
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
  errors.length = 0;
  await page.goto(`${base}/`, { waitUntil: 'load' });
  await page.waitForSelector('#talk .you');
  return { page, context, errors, api };
}

/** Whether `sel` has a running animation of its transform. */
const slides = (page, sel) => page.$eval(sel, (e) => e.getAnimations().some((a) => a.playState === 'running' && a.effect.getKeyframes().some((k) => /translate/.test(k.transform ?? ''))));

test('a menu group folding slides the groups under it on a transform; its rows never animate their height', opts, async () => {
  const { page, context, errors } = await open();
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('th:go', { detail: 'side' })));
  await page.waitForSelector('#convos .cg + .cg .ghead');
  await page.waitForTimeout(800);
  assert.doesNotMatch(await page.$eval('.gbody', (b) => getComputedStyle(b).transitionProperty), /grid/);
  await page.click('#convos .cg .ghead');
  assert.equal(await page.$eval('#convos .cg', (g) => g.classList.contains('closed')), true);
  assert.equal(await slides(page, '#convos .cg + .cg'), true, 'the next group slides up');
  await page.click('#convos .cg .ghead');
  assert.equal(await slides(page, '#convos .cg + .cg'), true, 'and back down');
  assert.deepEqual(errors, []);
  await context.close();
});

test('a disc chosen in the ring fades its fill, icon and lift on the compositor: no visibility flip rides with them', opts, async () => {
  const { page, context, errors } = await open();
  await page.waitForSelector('#ring .pet .fill', { state: 'attached' });
  const transitions = await page.$eval('#ring .pet', (p) => ['.fill', 'svg.on', '.lift'].map((s) => getComputedStyle(p.querySelector(s)).transitionProperty));
  assert.deepEqual(transitions, ['opacity', 'opacity', 'opacity']);
  assert.deepEqual(errors, []);
  await context.close();
});

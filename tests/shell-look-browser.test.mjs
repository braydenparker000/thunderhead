// The shell's one look (DESIGN-SYSTEM.md §6, §8.4, §12; ui/shell.css) in Chromium at phone size
// against the mocked Worker: in each view at most 2 surfaces blur what is behind them (the ask bar
// and one overlay), so a long conversation, the Briefing and Settings scroll and slide smoothly;
// Settings sits on home's own field with a round back button and focuses its title, not a ring;
// the 404 wears the shell's field and voice; with reduced motion nothing keeps moving on home; the
// shell's pages cross-fade, and opening an app from home throws nothing, even on a slow phone.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { API, mockApi, TOKEN } from './fixtures/mock-api.mjs';
import { briefingState } from './fixtures/mock-briefing.mjs';

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

const msg = (i, author, body) => ({ seq: i, id: `0192f0c4-0000-7000-8000-${String(i).padStart(12, '0')}`, thread_id: '0192f0c4-0000-7000-8000-0000000000aa', author, origin: author === 'owner' ? 'owner_device' : 'mind', kind: 'text', body, meta: author === 'mind' ? { chip: { label: 'Open in Music', app: 'music', path: '/music/' } } : null, attachments: [], reply_to: null, created_at: Date.now() - (40 - i) * 60_000, delivered_at: null, acked_at: null, answered_at: Date.now() });

async function open({ reducedMotion = 'no-preference', path = '/', signedIn = true } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', reducedMotion });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => { try { localStorage.setItem('th.p.sent', '1'); } catch {} });
  const messages = Array.from({ length: 16 }, (_, i) => msg(i + 1, i % 2 ? 'mind' : 'owner', i % 2 ? 'Done. It is in Music, under Evening.' : 'Put on something calm'));
  await mockApi(page, { chat: { messages }, briefing: briefingState() });
  if (signedIn) {
    await page.goto(`${base}/no-such-page`);
    await page.evaluate((token) => new Promise((resolve) => { const req = indexedDB.open('th-auth', 1); req.onupgradeneeded = () => req.result.createObjectStore('kv'); req.onsuccess = () => { const tx = req.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put({ session_id: 's1', token, signed_in_at: Date.now(), username: 'example-owner' }, 'session'); tx.oncomplete = () => { req.result.close(); resolve(); }; }; }), TOKEN);
  }
  await page.goto(`${base}${path}`, { waitUntil: 'load' });
  if (path === '/') await page.waitForSelector('#talk .you');
  await page.waitForTimeout(1200);
  return { page, context, errors };
}
/** Elements with a live backdrop-filter that show in the viewport. */
const blurs = (page) => page.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => {
  const f = getComputedStyle(e).backdropFilter;
  if (!f || f === 'none') return false;
  const r = e.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight && getComputedStyle(e).visibility !== 'hidden' && Number(getComputedStyle(e).opacity) > 0;
}).map((e) => e.id || e.className));
const go = (page, view) => page.evaluate((v) => document.dispatchEvent(new CustomEvent('th:go', { detail: v })), view);

test('at most two surfaces blur what is behind them, in every view', opts, async () => {
  const { page, context, errors } = await open();
  assert.ok((await page.$$('#talk .you')).length >= 8, 'a long conversation');
  assert.deepEqual(await blurs(page), ['ask'], 'home: the ask bar only; bubbles, chips and tiles are flat glass');
  await go(page, 'brief');
  await page.waitForTimeout(800);
  assert.ok((await blurs(page)).length <= 2, `briefing: ${await blurs(page)}`);
  await go(page, 'side');
  await page.waitForTimeout(800);
  assert.ok((await blurs(page)).length <= 2, `menu: ${await blurs(page)}`);
  assert.deepEqual(errors, []);
  await context.close();
});

test('Settings sits on home’s field with a round back button and focuses its title', opts, async () => {
  const { page, context, errors } = await open({ path: '/settings/devices/' });
  await page.waitForSelector('.spage.in .sback');
  const look = await page.evaluate(() => {
    const s = document.querySelector('.spage');
    return {
      blur: getComputedStyle(s).backdropFilter,
      field: Boolean(s.querySelector(':scope > .field')),
      back: [document.querySelector('.sback').getAttribute('aria-label'), document.querySelector('.sback svg use').getAttribute('href')],
      focused: document.activeElement?.tagName,
    };
  });
  assert.deepEqual(look, { blur: 'none', field: true, back: ['Back to Settings', '/ui/icons.svg#arrow-left'], focused: 'H1' });
  assert.ok((await blurs(page)).length <= 2);
  assert.deepEqual(errors, []);
  await context.close();
});

test('the 404 wears the shell: the field, and the voice line in Fraunces', opts, async () => {
  const { page, context } = await open({ path: '/nowhere-at-all/', signedIn: false });
  assert.deepEqual(await page.evaluate(() => [Boolean(document.querySelector('.bg .field')), getComputedStyle(document.querySelector('.voice')).fontStyle, getComputedStyle(document.querySelector('.voice')).fontFamily.split(',')[0]]), [true, 'italic', 'Fraunces']);
  await context.close();
});

test('with reduced motion, nothing on home keeps moving', opts, async () => {
  const { page, context } = await open({ reducedMotion: 'reduce' });
  await page.waitForTimeout(1000);
  assert.deepEqual(await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').map((a) => a.animationName ?? a.transitionProperty ?? 'animation')), []);
  await context.close();
});

test('opening an app from home skips the cross-fade cleanly, even on a slow phone', opts, async () => {
  const { page, context, errors } = await open();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
  assert.equal(await page.evaluate(() => CSS.supports('selector(::view-transition)')), true);
  await page.evaluate(() => { location.href = '/music/'; });
  await page.waitForURL(`${base}/music/`);
  await page.waitForTimeout(1500);
  assert.deepEqual(errors, []);
  await context.close();
});

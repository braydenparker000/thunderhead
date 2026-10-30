// The shell's one look (DESIGN-SYSTEM.md §6, §8.4, §12; ui/shell.css) in Chromium at phone size
// against the mocked Worker: in each view at most 2 surfaces blur what is behind them (the ask bar
// and one overlay), so a long conversation, the Briefing and Settings scroll and slide smoothly;
// Settings sits on home's own field with a round back button and focuses its title, not a ring;
// the 404 wears the shell's field and voice; with reduced motion nothing keeps moving on home; the
// shell's pages cross-fade, and neither opening an app from home nor home handing a signed-out
// owner on to sign-in throws anything, even on a slow phone; with a real touchscreen a sideways
// drag is a swipe even when it starts on the conversation with a little arc, a quick flick
// commits, a slow short drag springs back, and an upward drag still scrolls; the ask box is a
// text area (no autofill bar over the keyboard) that grows to five lines and keeps the
// conversation clear of it, Enter sends and Shift+Enter starts a new line.
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

async function open({ reducedMotion = 'no-preference', path = '/', signedIn = true, touch = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', reducedMotion, ...(touch ? { hasTouch: true, isMobile: true } : {}) });
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

test('signed out, the 404’s Back home goes on to sign-in without a cross-fade error, even on a slow phone', opts, async () => {
  // Home leaves before it shows, so the cross-fade into it is dropped; without the catch this threw
  // in about half the runs at 6× slower.
  for (let i = 0; i < 4; i++) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await mockApi(page, {});
    await (await context.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: 6 });
    await page.goto(`${base}/no-such-page`, { waitUntil: 'load' });
    await page.click('a.home');
    await page.waitForURL(/\/signin\//);
    await page.waitForTimeout(1000);
    assert.deepEqual(errors, [], `run ${i + 1}`);
    await context.close();
  }
});

/** A touch drag through `pts` ({ x, y }), one touch event every `ms` by the events' own clock, so
 * a flick's speed doesn't depend on how fast the runner delivers them. */
async function touchDrag(page, cdp, pts, ms = 12) {
  const t0 = Date.now() / 1000;
  const send = (type, touchPoints, i) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints, timestamp: t0 + (i * ms) / 1000 });
  await send('touchStart', [pts[0]], 0);
  for (const [i, p] of pts.slice(1).entries()) await send('touchMove', [p], i + 1);
  await send('touchEnd', [], pts.length);
  await page.waitForTimeout(700);
}
const line = (x0, y0, x1, y1, n) => Array.from({ length: n + 1 }, (_, i) => ({ x: x0 + ((x1 - x0) * i) / n, y: y0 + ((y1 - y0) * i) / n }));

test('swipes start easily on a touchscreen: arcs, flicks, and scrolling still scrolls', opts, async () => {
  const { page, context, errors } = await open({ touch: true });
  const cdp = await context.newCDPSession(page);
  const where = () => page.evaluate(() => ({ brief: Math.round(document.querySelector('#brief').getBoundingClientRect().left) === 0, side: document.querySelector('#side').getBoundingClientRect().left < innerWidth - 1, top: Math.round(document.querySelector('.convo').scrollTop) }));
  // Every drag starts on a bubble, where a hold never opens the ring, so a slow runner can't turn
  // a drag into a pick: the newest reply (left) and the owner's newest bubble (right).
  const at = (sel) => page.$$eval(sel, (els) => { const r = els[els.length - 1].getBoundingClientRect(); return { l: r.left + 12, r: r.right - 12, y: r.top + r.height / 2 }; });
  const reply = await at('#talk .reply');
  const mine = await at('#talk .you');
  // A thumb that first moves 9 px across and 8 down, on the conversation: a swipe, not a dead touch.
  await touchDrag(page, cdp, [...line(reply.l, reply.y, reply.l + 9, reply.y + 8, 2), ...line(reply.l + 9, reply.y + 8, reply.l + 270, reply.y + 20, 30)]);
  assert.equal((await where()).brief, true, 'arc → Briefing');
  // A quick 90 px flick back (well under 28% of the width) commits; the Briefing's own content is
  // under the finger now, which is fine: swipes start anywhere.
  await touchDrag(page, cdp, line(330, 500, 240, 500, 3));
  assert.equal((await where()).brief, false, 'flick → home');
  // …and finishes at the finger's speed, quicker than a settle from a slow drag.
  const ms = await page.$eval('#home', (h) => parseFloat(h.style.transitionDuration));
  assert.ok(ms >= 180 && ms < 460, `flick settle ${ms} ms`);
  await touchDrag(page, cdp, line(mine.r, mine.y, mine.r - 90, mine.y, 3));
  assert.equal((await where()).side, true, 'flick left → menu');
  await page.click('#dim', { position: { x: 20, y: 300 } });
  await page.waitForTimeout(700);
  // A slow 80 px drag springs back.
  await touchDrag(page, cdp, line(reply.l, reply.y, reply.l + 80, reply.y, 40), 40);
  assert.equal((await where()).brief, false, 'slow short drag springs back');
  // Dragging down the conversation scrolls it up.
  const before = (await where()).top;
  const high = await page.$$eval('#talk .reply', (els) => { const r = els.map((e) => e.getBoundingClientRect()).find((b) => b.top > 120); return { x: r.left + 40, y: r.top + r.height / 2 }; });
  await touchDrag(page, cdp, [...line(high.x, high.y, high.x + 3, high.y + 10, 2), ...line(high.x + 3, high.y + 10, high.x + 10, high.y + 300, 20)]);
  const after = await where();
  assert.ok(after.top < before, `scrolled: ${before} → ${after.top}`);
  assert.equal(after.brief || after.side, false);
  assert.deepEqual(errors, []);
  await context.close();
});

test('the ask box: a text area that grows, Enter sends, Shift+Enter a new line', opts, async () => {
  const { page, context, errors } = await open();
  assert.deepEqual(await page.$eval('#q', (q) => [q.tagName, q.getAttribute('autocomplete'), q.getAttribute('enterkeyhint')]), ['TEXTAREA', 'off', 'send']);
  const size = () => page.evaluate(() => ({ bar: document.querySelector('#ask').offsetHeight, gap: Math.round(document.querySelector('#ask').getBoundingClientRect().top - document.querySelector('.convo').getBoundingClientRect().bottom) }));
  const one = await size();
  assert.equal(one.bar, 54);
  await page.click('#q');
  await page.keyboard.type('First line');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('second line');
  assert.equal(await page.inputValue('#q'), 'First line\nsecond line');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('third');
  // The bar's height reaches the conversation through a resize observer, which runs before the
  // next paint: wait a frame or two for it rather than reading in the same task.
  await page.waitForFunction((g) => Math.round(document.querySelector('#ask').getBoundingClientRect().top - document.querySelector('.convo').getBoundingClientRect().bottom) === g, one.gap, { timeout: 2000 });
  const three = await size();
  assert.ok(three.bar > 54 + 40, `grew: ${three.bar}`);
  assert.equal(three.gap, one.gap, 'the conversation keeps clear of it');
  for (let i = 0; i < 6; i++) { await page.keyboard.press('Shift+Enter'); await page.keyboard.type('more'); }
  assert.ok((await size()).bar <= 54 + 130 - 42, 'at most five lines');
  const before = (await page.$$('#talk .you')).length;
  await page.keyboard.press('Enter');
  await page.waitForFunction((n) => document.querySelectorAll('#talk .you').length > n, before);
  assert.equal(await page.inputValue('#q'), '');
  await page.waitForFunction(() => document.querySelector('#ask').offsetHeight === 54, null, { timeout: 2000 }).catch(() => {});
  assert.equal((await size()).bar, 54, 'back to one line once sent');
  assert.match(await page.$$eval('#talk .you', (els) => els[els.length - 1].textContent), /^First line\nsecond line\nthird/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('at the top of the conversation, pulling down 64 px opens Find in today; a short pull does not', opts, async () => {
  const { page, context, errors } = await open({ touch: true });
  const cdp = await context.newCDPSession(page);
  await page.$eval('.convo', (c) => { c.scrollTop = 0; });
  const top = await page.$$eval('#talk .reply', (els) => { const r = els.map((e) => e.getBoundingClientRect()).find((b) => b.top > 70); return { x: r.left + 30, y: r.top + 10 }; });
  await touchDrag(page, cdp, line(top.x, top.y, top.x + 2, top.y + 40, 8));
  assert.equal(await page.$('.findbar'), null, 'a 40 px pull is not enough');
  await touchDrag(page, cdp, line(top.x, top.y, top.x + 2, top.y + 110, 12));
  await page.waitForSelector('.findbar.in');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Find in today');
  assert.equal(await page.$eval('.pullfind', (p) => getComputedStyle(p).opacity), '0', 'the hint goes once it has opened');
  assert.deepEqual(errors, []);
  await context.close();
});

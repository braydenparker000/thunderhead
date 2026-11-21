// Android Back closes one layer, never the app (GESTURES.md §7), in Chromium at 390×844 against the
// mocked Worker (tests/fixtures/mock-api.mjs): each row of §7's table opened the way the owner does
// (a swipe, a tap, a hold, a pull), then page.goBack(): the layer closes and home is still the page,
// at the same address, with the conversation there. Also: Back twice from a Settings sub-page, Back
// with Music in the island (the island's own entry still works), a reload on a layer (no stale steps),
// Remind me, the voice memo strip, Find in today and a photo full screen. th/layers.js keeps the stack.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { API, mockApi, TOKEN } from './fixtures/mock-api.mjs';
import { resting, until } from './fixtures/waits.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (mocked API)', timeout: 90_000 };
const launch = (args = []) => chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args });
let server, browser, base;
before(async () => {
  if (live) return;
  server = await serve(0, { api: API });
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await launch();
});
after(async () => { await browser?.close(); server?.close(); });

const TODAY = '0192f0c4-0000-7000-8000-0000000000aa';
const SAID = 'Good morning, a calm start';
const owner = { seq: 1, id: 'm1', thread_id: TODAY, author: 'owner', origin: 'owner_device', kind: 'text', body: SAID, meta: null, attachments: [], reply_to: null, created_at: Date.now() - 300_000, delivered_at: null, acked_at: null, answered_at: null };

async function open({ chat = { messages: [owner] }, b = browser, context = null, touch = false } = {}) {
  context ??= await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block', hasTouch: touch, timezoneId: 'UTC' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  const api = await mockApi(page, { chat });
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
  await page.waitForSelector('#ask .sendline', { state: 'attached' });
  await page.waitForSelector('#talk .you');
  return { page, context, errors, api };
}

const layers = (page) => page.evaluate(() => import('/th/layers.js').then((m) => m.names()));
/** Home is the page: the same address, the conversation there, no layer of ours open. */
async function home(page, message) {
  await until(async () => (await layers(page)).length === 0, { message: `${message}: a layer stayed open` });
  const u = new URL(page.url());
  assert.equal(u.origin + u.pathname, `${base}/`, `${message}: still home`);
  assert.ok((await page.textContent('#talk .you')).includes(SAID), `${message}: the conversation is there`);
}
/** System Back, once the stack holds what is open. */
async function back(page) {
  await page.goBack();
  await resting(page);
}
/** A drag on the open home (home.js), as a finger: from x0 to x1 at `y`. */
async function drag(page, x0, x1, y = 300) {
  await page.mouse.move(x0, y); await page.mouse.down();
  await page.mouse.move(x0 + (x1 - x0) * 0.3, y, { steps: 4 }); await page.mouse.move(x1, y, { steps: 8 });
  await page.mouse.up();
  await resting(page);
}
const sideOpen = (page) => page.$eval('#side', (s) => s.classList.contains('open'));
async function menu(page) {
  await drag(page, 330, 60);
  await page.waitForSelector('#convos .row.thr');
  await until(async () => (await layers(page)).includes('side'), { message: 'the menu is a layer' });
}
/** A hold on a conversation row in the menu: its sheet (th/convos/actions.js). */
async function hold(page) {
  const r = await page.locator('#convos .row.thr').first().boundingBox();
  await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
  await page.mouse.down();
  await page.waitForSelector('.holdsheet');
  await page.mouse.up();
  await resting(page);
}

test('Keyboard open: the bar taking focus adds no step for Back (Android closes the keyboard)', opts, async () => {
  const { page, context, errors } = await open();
  const n = await page.evaluate(() => history.length);
  await page.click('#q');
  assert.equal(await page.evaluate(() => history.length), n);
  assert.deepEqual(await layers(page), []);
  assert.deepEqual(errors, []);
  await context.close();
});

test('Long-press action menu: Back closes it and the menu stays', opts, async () => {
  const { page, context, errors } = await open();
  await menu(page);
  await hold(page);
  await back(page);
  await page.waitForSelector('.holdsheet', { state: 'detached' });
  assert.ok(await sideOpen(page), 'the menu is still open');
  await back(page);
  assert.equal(await sideOpen(page), false);
  await home(page, 'after the hold sheet and the menu');
  assert.deepEqual(errors, []);
  await context.close();
});

test('Confirm sheet: Back closes it, choosing Keep', opts, async () => {
  const { page, context, errors, api } = await open();
  await menu(page);
  await hold(page);
  await page.locator('.holdsheet .del').click();
  await page.waitForSelector('.csheet[aria-label="Delete this conversation?"]');
  await until(async () => (await layers(page)).at(-1) === 'sheet', { message: 'the confirm is a layer' });
  await back(page);
  await page.waitForSelector('.csheet', { state: 'detached' });
  assert.equal(api.calls.filter((c) => c.call.startsWith('DELETE')).length, 0, 'nothing was deleted');
  assert.ok(await sideOpen(page), 'the menu is still open');
  await back(page);
  await home(page, 'after the confirm');
  assert.deepEqual(errors, []);
  await context.close();
});

test('+ sheet: Back closes it', opts, async () => {
  const { page, context, errors } = await open();
  await page.click('#plus');
  await page.waitForSelector('#opts.show');
  await back(page);
  await page.waitForSelector('#opts:not(.show)', { state: 'attached' });
  await home(page, 'after the + sheet');
  assert.deepEqual(errors, []);
  await context.close();
});

test('Sub-page inside Settings: Back to the Settings list, Back to the menu, Back home', opts, async () => {
  const { page, context, errors } = await open();
  await menu(page);
  await page.click('#settings');
  await page.waitForSelector('.spage.in:not(.moving) .slink[data-page]');
  await page.locator('.spage .slink[data-page]').first().click();
  await until(async () => (await page.locator('.spage').count()) === 2, { message: 'the sub-page opened' });
  await resting(page);
  await back(page);
  await until(async () => (await page.locator('.spage').count()) === 1, { message: 'Back left the sub-page' });
  assert.equal(await page.getAttribute('.spage', 'aria-label'), 'Settings');
  await back(page);
  await page.waitForSelector('.spage', { state: 'detached' });
  assert.ok(await sideOpen(page), 'back in the menu');
  await back(page);
  assert.equal(await sideOpen(page), false);
  await home(page, 'after Settings');
  assert.deepEqual(errors, []);
  await context.close();
});

test('Menu: Back closes it (home)', opts, async () => {
  const { page, context, errors } = await open();
  await menu(page);
  await back(page);
  assert.equal(await sideOpen(page), false);
  await home(page, 'after the menu');
  assert.deepEqual(errors, []);
  await context.close();
});

test('Briefing: Back closes it (home)', opts, async () => {
  const { page, context, errors } = await open();
  await drag(page, 60, 330);
  assert.equal(await page.$eval('#brief', (e) => Math.round(e.getBoundingClientRect().left)), 0, 'the Briefing is in view');
  await back(page);
  assert.ok(await page.$eval('#brief', (e) => e.getBoundingClientRect().right <= 1), 'the Briefing left');
  await home(page, 'after the Briefing');
  assert.deepEqual(errors, []);
  await context.close();
});

test('An open app: Back makes Music the island (its own entry), then Back from the menu leaves it there', opts, async () => {
  const { page, context } = await open();
  assert.equal(await page.evaluate(() => import('/th/island/island.js').then((m) => m.openApp('music'))), true);
  await page.waitForSelector('iframe.th-app[data-app=music]', { state: 'attached' });
  await page.evaluate(() => import('/th/island/island.js').then((m) => m.whenResting()));
  assert.equal(await page.evaluate(() => history.state?.th), 'app');
  await page.goBack();
  await page.waitForSelector('.th-island:not([hidden])');
  await page.evaluate(() => import('/th/island/island.js').then((m) => m.whenResting()));
  assert.equal(await page.evaluate(() => document.body.dataset.island), 'music');
  await home(page, 'after Music');
  await menu(page);
  await back(page);
  assert.equal(await sideOpen(page), false);
  assert.equal(await page.evaluate(() => document.body.dataset.island), 'music', 'Music is still in the island');
  await home(page, 'after the menu over the island');
  await context.close();
});

test('A filed conversation shown on home: Back to now, in one step', opts, async () => {
  const { page, context, errors } = await open();
  await menu(page);
  await page.locator(`#convos .row.thr:not([data-id="${TODAY}"])`).first().click();
  await page.waitForSelector('#home.pastview');
  await resting(page);
  await back(page);
  await page.waitForSelector('#home:not(.pastview)');
  await until(async () => (await page.evaluate(() => history.state)) === null, { message: 'the menu left no step behind' });
  assert.equal(await sideOpen(page), false);
  await home(page, 'after the filed conversation');
  assert.deepEqual(errors, []);
  await context.close();
});

test('Home root: Back leaves the app, never trapped', opts, async () => {
  const { page, context } = await open();
  await page.goBack();
  assert.equal(new URL(page.url()).pathname, '/no-such-page');
  await context.close();
});

test('A reload on a layer lands on home, and one Back then leaves', opts, async () => {
  const { page, context, errors } = await open();
  await menu(page);
  await page.click('#settings');
  await page.waitForSelector('.spage.in');
  await page.reload({ waitUntil: 'load' });
  // The reloaded page goes back to the entry under the menu in one step, which loads home once more.
  const ready = () => page.evaluate(() => history.state === null && document.readyState === 'complete' && Boolean(document.querySelector('#talk .you'))).catch(() => false);
  await until(ready, { message: 'the old steps were left' });
  assert.equal(await page.locator('.spage').count(), 0);
  await home(page, 'after the reload');
  await page.goBack();
  assert.equal(new URL(page.url()).pathname, '/no-such-page', 'one Back leaves');
  assert.deepEqual(errors, []);
  await context.close();
});

test('Remind me: Back closes the sheet; the + sheet that opened it left no step', opts, async () => {
  const { page, context, errors } = await open();
  await page.click('#plus');
  await page.click('#opts [data-act="remind"]');
  await page.waitForSelector('.remind.in');
  await until(async () => (await layers(page)).join() === 'remind', { message: 'Remind me is the one layer' });
  await back(page);
  await page.waitForSelector('.remind', { state: 'detached' });
  await home(page, 'after Remind me');
  await until(async () => (await page.evaluate(() => history.state)) === null, { message: 'no stale step' });
  assert.deepEqual(errors, []);
  await context.close();
});

test('The voice memo strip: Back stops it and keeps the memo', opts, async (t) => {
  const fake = await launch(['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']);
  t.after(() => fake.close());
  const context = await fake.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block', permissions: ['microphone'] });
  const { page, errors } = await open({ b: fake, context });
  await page.click('#plus');
  await page.click('#opts [data-act="memo"]');
  await page.waitForSelector('#ask.recording .rec .rlevel i');
  await until(async () => (await layers(page)).join() === 'memo', { message: 'the strip is the one layer' });
  // A memo under a second is too short to keep: wait on the page's own clock for its timer to pass 0:01.
  await page.waitForFunction(() => document.querySelector('.rec .rtime')?.textContent >= '0:01');
  await back(page);
  await page.waitForSelector('#ask:not(.recording)');
  await page.waitForSelector('#ask.hasfiles');
  await home(page, 'after the memo');
  assert.deepEqual(errors, []);
  await context.close();
});

test('Find in today: pulled down by a finger, Back closes it', opts, async () => {
  const { page, context, errors } = await open({ touch: true });
  const cdp = await context.newCDPSession(page);
  const touch = (type, points = []) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y]) => ({ x, y })) });
  // On the owner's bubble, where a hold never opens the ring; down 110 px from the top of the conversation.
  await page.$eval('#convo', (c) => { c.scrollTop = 0; });
  const b = await page.locator('#talk .you').first().boundingBox();
  const x = b.x + 12, y0 = b.y + b.height / 2;
  await touch('touchStart', [[x, y0]]);
  for (let i = 1; i <= 12; i++) await touch('touchMove', [[x + i / 6, y0 + (110 * i) / 12]]);
  await touch('touchEnd');
  await page.waitForSelector('.findbar.in');
  await until(async () => (await layers(page)).join() === 'find', { message: 'Find is the one layer' });
  await back(page);
  await page.waitForSelector('.findbar', { state: 'detached' });
  await home(page, 'after Find in today');
  assert.deepEqual(errors, []);
  await context.close();
});

test('A photo full screen: Back closes it', opts, async () => {
  const scratch = await browser.newContext();
  const p = await scratch.newPage();
  const png = Buffer.from(await p.evaluate(async () => {
    const c = new OffscreenCanvas(60, 40);
    const g = c.getContext('2d');
    g.fillStyle = '#2e7d5b'; g.fillRect(0, 0, 60, 40);
    return [...new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer())];
  }));
  await scratch.close();
  const files = { f1: { ref: 'file:f1', name: 'chart.png', type: 'image/png', bytes: png.length, body: png } };
  const reply = { ...owner, seq: 2, id: 'm2', author: 'mind', origin: 'mind', body: 'Here it is.', attachments: [{ ref: 'file:f1', name: 'chart.png', type: 'image/png', bytes: png.length }], reply_to: 'm1', created_at: owner.created_at + 1000 };
  const { page, context, errors } = await open({ chat: { messages: [owner, reply], files } });
  await page.waitForSelector('#talk .reply .atts .pic.ready');
  await page.click('#talk .reply .pic');
  await page.waitForSelector('.viewer.in');
  await back(page);
  await page.waitForSelector('.viewer', { state: 'detached' });
  await home(page, 'after the photo');
  assert.deepEqual(errors, []);
  await context.close();
});

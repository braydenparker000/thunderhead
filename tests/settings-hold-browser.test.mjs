// Settings holds on to what the owner did (the phone-size audit of 2026-11-23), in Chromium at 390×844
// against the mocked Worker: a catalogue page or "How I talk" whose first read failed says so at its
// top, looks unavailable and loads by itself once the connection is back; typed text is never thrown
// away by Back or a drag from the edge without asking first; a new recovery code's warning follows
// the real state and a failed confirm says so; and a phone whose storage is full is told so when a
// phone setting or Go quiet now can't be kept. Local only; invented text.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { API, mockApi, TOKEN } from './fixtures/mock-api.mjs';
import { guardOpen, until } from './fixtures/waits.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (mocked API)' };
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'Authorization, Content-Type, TH-Client', 'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE' };
let server, browser, base;
before(async () => {
  if (live) return;
  server = await serve(0, { api: API });
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => { await browser?.close(); server?.close(); });

/** Signed in on home, with the shell started. */
async function open(overrides = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => { try { localStorage.setItem('th.p.sent', '1'); localStorage.setItem('th-theme', 'light'); } catch {} });
  const mock = await mockApi(page, overrides);
  await page.goto(`${base}/no-such-page`);
  await page.evaluate((token) => new Promise((resolve) => { const req = indexedDB.open('th-auth', 1); req.onupgradeneeded = () => req.result.createObjectStore('kv'); req.onsuccess = () => { const tx = req.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put({ session_id: 's1', token, signed_in_at: Date.now(), username: 'example-owner' }, 'session'); tx.oncomplete = () => { req.result.close(); resolve(); }; }; }), TOKEN);
  await page.goto(`${base}/`, { waitUntil: 'load' });
  await page.waitForSelector('html[data-signed-in]');
  return { page, context, errors, mock };
}

/** Opens a Settings page by name and waits for it to rest. */
async function show(page, name, ready = '.spage.in') {
  await page.evaluate((n) => document.dispatchEvent(new CustomEvent('th:open', { detail: { name: n } })), name);
  await page.waitForSelector(ready);
  await page.waitForFunction(() => { const p = [...document.querySelectorAll('.spage')].at(-1); return p && !p.classList.contains('moving') && !p.getAnimations().length; });
  await guardOpen(page);
}

/** A switch for one API path: `cut.on = true` makes every GET of it fail as offline. */
async function cut(page, path) {
  const c = { on: true };
  await page.route(`${API}${path}`, (r) => (c.on && r.request().method() === 'GET' ? r.abort('internetdisconnected') : r.fallback()));
  return c;
}

/** The phone's storage is full: every write to localStorage throws, as Chrome's QuotaExceededError. */
const fill = (page) => page.evaluate(() => {
  Storage.prototype.setItem = function () { throw new DOMException('The quota has been exceeded.', 'QuotaExceededError'); };
});
const toasts = (page) => page.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent));
const pages = (page) => page.$$eval('.spage', (ps) => ps.map((p) => p.getAttribute('aria-label')));

for (const name of ['briefing', 'notifications']) {
  test(`${name}: a first read that fails says so at the top, looks unavailable, and loads once back online`, opts, async () => {
    const { page, context, errors } = await open();
    const net = await cut(page, '/v1/settings');
    await show(page, name, `.spage.in .scatalog[data-group="${name}"]:not([aria-busy])`);
    const seen = await page.evaluate(() => {
      const n = document.querySelector('.spage.in [data-unloaded]');
      const h = document.querySelector('.spage.in .scatalog');
      return { shown: Boolean(n && !n.hidden), text: n?.textContent, top: n?.getBoundingClientRect().top, inert: h.inert, dim: Number(getComputedStyle(h).opacity) };
    });
    assert.equal(seen.shown, true, 'the page says it could not load');
    assert.match(seen.text, /^Couldn't load these settings.*Can't reach the Thunderhead right now/);
    assert.ok(seen.top < 300, `at the top, in view (${seen.top})`);
    assert.equal(seen.inert, true);
    assert.ok(seen.dim < 1, 'the controls look unavailable');
    net.on = false;
    await page.evaluate(() => dispatchEvent(new Event('online')));
    await page.waitForFunction(() => !document.querySelector('.spage.in .scatalog').inert);
    assert.deepEqual(await page.evaluate(() => ({ hidden: document.querySelector('.spage.in [data-unloaded]').hidden, dim: getComputedStyle(document.querySelector('.spage.in .scatalog')).opacity })), { hidden: true, dim: '1' });
    assert.deepEqual(errors, []);
    await context.close();
  });
}

test('a catalogue page that failed loads by itself when the page is shown again', opts, async () => {
  const { page, context } = await open();
  const net = await cut(page, '/v1/settings');
  await show(page, 'briefing', '.spage.in .scatalog[data-group="briefing"]:not([aria-busy])');
  net.on = false;
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForFunction(() => !document.querySelector('.spage.in .scatalog').inert);
  await context.close();
});

test('"How I talk" that failed to read reads again once back online', opts, async () => {
  const { page, context } = await open();
  const net = await cut(page, '/v1/mind/voice');
  await show(page, 'mind', '.spage.in .scatalog[data-group="mind"]:not([aria-busy])');
  await until(async () => /Can't reach/.test(await page.$eval('#voice-state', (n) => n.textContent)), { message: 'the failed read is said' });
  assert.equal(await page.$eval('#voice-page', (a) => a.disabled), true);
  net.on = false;
  await page.evaluate(() => dispatchEvent(new Event('online')));
  await page.waitForFunction(() => !document.querySelector('#voice-page').disabled);
  await context.close();
});

/** On "How I talk" with a line typed and not saved. */
async function typedVoice() {
  const o = await open();
  await show(o.page, 'mind', '.spage.in .scatalog[data-group="mind"]:not([aria-busy])');
  await o.page.waitForFunction(() => !document.querySelector('#voice-page').disabled);
  const area = o.page.locator('#voice-page');
  await area.scrollIntoViewIfNeeded();
  await area.tap();
  await o.page.keyboard.type(' Keep it short.');
  return { ...o, area };
}
const asked = (page) => page.locator('.sheet[aria-label="What you typed isn\'t saved. Leave anyway?"]');

test('Android Back with typed text asks first: Cancel keeps the text, Leave closes the page', opts, async () => {
  const { page, context, area } = await typedVoice();
  const text = await area.inputValue();
  await page.goBack();
  await asked(page).waitFor();
  assert.deepEqual(await pages(page), ['The mind'], 'still open while it asks');
  await asked(page).getByRole('button', { name: 'Cancel' }).click();
  await asked(page).waitFor({ state: 'detached' });
  assert.equal(await area.inputValue(), text, 'what was typed is still there');
  // Back again asks again (the page is back on the Back stack); Leave goes.
  await page.goBack();
  await asked(page).waitFor();
  await asked(page).getByRole('button', { name: 'Leave' }).click();
  await page.waitForFunction(() => !document.querySelector('.spage'));
  await context.close();
});

test('nothing typed: Back closes the page without asking', opts, async () => {
  const { page, context } = await open();
  await show(page, 'mind', '.spage.in .scatalog[data-group="mind"]:not([aria-busy])');
  await page.waitForFunction(() => !document.querySelector('#voice-page').disabled);
  await page.goBack();
  await page.waitForFunction(() => !document.querySelector('.spage'));
  assert.equal(await asked(page).count(), 0);
  await context.close();
});

/** A touch drag from (x0, y) to (x1, y), as a finger moves. */
async function drag(page, x0, y, x1) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y }] });
  for (let i = 1; i <= 12; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + ((x1 - x0) * i) / 12, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

test('a drag from the left edge with typed text never closes the page unasked; one inside the text box is the text box\'s', opts, async () => {
  const { page, context, area } = await typedVoice();
  const text = await area.inputValue();
  const box = await area.boundingBox();
  // Inside the text box (its left edge plus a little): the page doesn't move.
  await drag(page, box.x + 4, box.y + box.height / 2, 300);
  assert.equal(await page.evaluate(() => document.querySelector('.spage').classList.contains('in')), true);
  assert.equal(await asked(page).count(), 0, 'a drag in the text box is not a way out');
  // From the page's very edge beside it: asked first.
  await drag(page, 1, box.y + box.height / 2, 300);
  await asked(page).waitFor();
  await asked(page).getByRole('button', { name: 'Cancel' }).click();
  await asked(page).waitFor({ state: 'detached' });
  assert.deepEqual(await pages(page), ['The mind']);
  assert.equal(await area.inputValue(), text);
  await context.close();
});

test('the password form asks before Back throws away what was typed', opts, async () => {
  const { page, context } = await open();
  await show(page, 'account', '.spage.in #new-password');
  await page.fill('#new-password', 'an invented long password');
  await page.goBack();
  await asked(page).waitFor();
  await context.close();
});

for (const ok of [true, false]) {
  test(`a new recovery code: ${ok ? 'confirmed, the warning goes' : 'a failed confirm says so and the warning stays'}`, opts, async () => {
    let confirmed = false;
    const { page, context, mock } = await open({ me: () => [200, { session_id: 's1', label: 'Android phone · Chrome', notices: [], recovery_confirmed: confirmed }] });
    await page.route(`${API}/v1/auth/recovery-code/confirm`, (r) => {
      if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
      if (!ok) return r.abort('internetdisconnected');
      confirmed = true;
      return r.fallback();
    });
    await show(page, 'devices', '.spage.in .slist:not([aria-busy])');
    const warn = () => page.$eval('.spage .swarn', (w) => (w.hidden ? null : w.textContent));
    assert.match(await warn(), /haven't confirmed/);
    await page.getByText('Make a new recovery code').click();
    await page.fill('.spage .srec input[type=password]', 'right password here');
    await page.getByRole('button', { name: 'Make code' }).click();
    await page.waitForSelector('#recovery-code');
    const code = await page.$eval('#recovery-code', (n) => n.textContent.replace(/[\s-]/g, ''));
    await page.fill('#confirm-code', code.slice(-5));
    await page.getByRole('button', { name: 'Continue' }).click();
    if (ok) {
      await until(async () => (await toasts(page)).includes('New recovery code saved'), { message: 'saved is said' });
      await until(async () => (await warn()) === null, { message: 'the warning goes' });
    } else {
      const line = page.locator('.spage .srec .line');
      await line.waitFor();
      assert.match(await line.textContent(), /^Your new recovery code isn't confirmed\. Can't reach the Thunderhead right now\. Check your connection\. Make a new one to try again\.$/);
      assert.equal((await toasts(page)).includes('New recovery code saved'), false, 'never says saved');
      assert.match(await warn(), /haven't confirmed/);
      assert.equal(mock.calls.filter((c) => c.call === 'POST /v1/auth/recovery-code/confirm').length, 0);
    }
    await context.close();
  });
}

test('storage full: a phone setting says it won\'t stay, and so does the theme and text size', opts, async () => {
  const { page, context } = await open();
  await show(page, 'appearance', '.spage.in .scatalog[data-group="appearance"]');
  await fill(page);
  await page.click('[data-key="appearance.corners"] [data-v="round"]');
  const FULL = "This phone's storage is full, so that won't stay. See Settings › On this phone.";
  await until(async () => (await toasts(page)).includes(FULL), { message: 'a catalogue phone setting' });
  await page.evaluate(() => document.querySelector('.toast').textContent = '');
  await show(page, 'settings', '.spage.in #set-theme');
  await page.click('#set-text [data-v="l"]');
  await until(async () => (await toasts(page)).includes(FULL), { message: 'the text size' });
  await page.evaluate(() => document.querySelector('.toast').textContent = '');
  await page.click('#set-theme [data-v="dark"]');
  await until(async () => (await toasts(page)).includes(FULL), { message: 'the theme' });
  await context.close();
});

test('storage full: Go quiet now goes to the Worker at once; offline too, it says it couldn\'t', opts, async () => {
  const { page, context, mock } = await open();
  await show(page, 'notifications', '.spage.in .scatalog[data-group="notifications"]:not([aria-busy])');
  await fill(page);
  await page.locator('.spage [data-action="quiet"]', { hasText: '1 hour' }).click();
  await until(() => mock.calls.some((c) => c.call === 'PATCH /v1/settings' && c.body?.['quiet.until'] > Date.now()), { message: 'the order reached the Worker' });
  await until(async () => /^Quiet until/.test(await page.locator('.spage .snow').textContent()), { message: 'and the page says quiet' });
  // Ended, then set again while the Worker can't be reached: said plainly, and not quiet.
  await page.locator('.spage [data-action="quiet"]', { hasText: 'End now' }).click();
  await until(() => mock.calls.some((c) => c.call === 'PATCH /v1/settings' && c.body?.['quiet.until'] === 0), { message: 'the end reached the Worker' });
  await until(async () => (await page.locator('.spage .snow').textContent()) === 'Not quiet now.');
  await page.route(`${API}/v1/settings`, (r) => (r.request().method() === 'PATCH' ? r.abort('internetdisconnected') : r.fallback()));
  await page.locator('.spage [data-action="quiet"]', { hasText: '1 hour' }).click();
  await until(async () => /storage is full/.test(await page.locator('.spage .snow').textContent()), { message: 'says why it is not quiet' });
  assert.equal(await page.locator('.spage .snow').textContent(), "Not changed: this phone's storage is full and the Thunderhead can't be reached. See Settings › On this phone.");
  await context.close();
});

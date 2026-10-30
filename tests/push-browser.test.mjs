// Web Push on the phone in Chromium (frontend/th/push/phone.js, apps/settings/notifications.js and
// the shell's sw.js; MENU-AND-SETTINGS.md §4.3, SECURITY.md §10) against the mocked Worker. Settings
// → Notifications: "Not set up", then "Let me reach you" (permission granted for the test) sends
// this phone's subscription, "Send a test" asks for one, "Turn off on this phone" removes it. The
// headless browser has no push service, so the permission and the subscription are stand-ins; the push is real:
// delivered to the shell's worker over CDP, which fetches its words with the session and shows
// them, or a line that says nothing when it can't (shown where the browser can show one: full
// Chromium, not the headless shell CI uses). Local only; no network.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { API, mockApi, TOKEN } from './fixtures/mock-api.mjs';

// The worker's own requests (the push's words) go through the context's routes too.
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1';
const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (mocked API)' };
const KEY = `B${'A'.repeat(86)}`;
let server, browser, base;

before(async () => {
  if (live) return;
  server = await serve(0, { api: API });
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => { await browser?.close(); server?.close(); });

test('Notifications: on, a test, off; a push shows its words, or a line that says nothing', opts, async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['notifications'], serviceWorkers: 'allow' });
  const calls = [];
  // The worker's fetch of a push's words, with the session.
  await context.route(`${API}/v1/push/items/**`, (route) => {
    const id = route.request().url().split('/').pop();
    calls.push(`SW GET ${id} ${route.request().headers().authorization ?? ''}`);
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'Authorization' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    return id === 'nudge-0001'
      ? route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ title: 'Leave by 16:40', body: 'The bus is 10 minutes early today.', url: '/' }) })
      : route.fulfill({ status: 404, headers: cors, contentType: 'application/json', body: '{"error":{"code":"not_found","message":"Not found.","request_id":"r"}}' });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // A stand-in subscription (no push service in a headless browser), and the page's permission (the
  // headless shell reports "denied" whatever is granted; its worker is granted, as on a phone).
  await page.addInitScript((key) => {
    let granted = false;
    Object.defineProperty(Notification, 'permission', { get: () => (granted ? 'granted' : 'default') });
    Notification.requestPermission = async () => { granted = true; return 'granted'; };
    const bytes = Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
    const fake = { endpoint: 'https://fcm.googleapis.com/fcm/send/fake-phone', options: { applicationServerKey: bytes.buffer }, toJSON: () => ({ endpoint: fake.endpoint, keys: { p256dh: 'BPhone', auth: 'secret' } }), unsubscribe: async () => { sessionStorage.removeItem('fake-sub'); return true; } };
    PushManager.prototype.getSubscription = async () => (sessionStorage.getItem('fake-sub') ? fake : null);
    PushManager.prototype.subscribe = async () => { sessionStorage.setItem('fake-sub', '1'); return fake; };
  }, KEY);
  await mockApi(page);
  await page.route(/\/v1\/push\/(key|subscription|test)$/, async (route) => {
    const r = route.request();
    calls.push(`${r.method()} ${new URL(r.url()).pathname}${r.postData() ? ` ${r.postData()}` : ''}`);
    const json = (status, body) => route.fulfill({ status, headers: { 'access-control-allow-origin': '*' }, contentType: 'application/json', body: body === null ? '' : JSON.stringify(body) });
    if (r.url().endsWith('/key')) return json(200, { vapid_public_key: KEY });
    if (r.url().endsWith('/test')) return json(200, { sent: 1 });
    return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
  });
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
  await page.goto(`${base}/`, { waitUntil: 'load' });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForTimeout(600);

  await page.evaluate(() => document.querySelector('[data-open="notifications"]').click());
  const status = page.locator('.spage .shelp[role="status"]');
  await page.locator('.spage button', { hasText: 'Let me reach you' }).waitFor();
  assert.equal(await status.textContent(), 'Not set up');
  await page.locator('.spage button', { hasText: 'Let me reach you' }).click();
  await page.locator('.spage button', { hasText: 'Send a test' }).waitFor();
  assert.equal(await status.textContent(), 'On');
  assert.ok(calls.includes('GET /v1/push/key'), calls.join('\n'));
  assert.ok(calls.includes('PUT /v1/push/subscription {"endpoint":"https://fcm.googleapis.com/fcm/send/fake-phone","keys":{"p256dh":"BPhone","auth":"secret"}}'), calls.join('\n'));
  await page.locator('.spage button', { hasText: 'Send a test' }).click();
  await page.waitForFunction(() => document.body.textContent.includes('Sent. It should arrive in a moment.'));
  assert.ok(calls.includes('POST /v1/push/test'));

  // A push, delivered to the shell's worker as a push service would.
  const cdp = await context.newCDPSession(page);
  const regs = [];
  cdp.on('ServiceWorker.workerRegistrationUpdated', (e) => regs.push(...e.registrations));
  await cdp.send('ServiceWorker.enable');
  for (let i = 0; i < 50 && !regs.some((r) => r.scopeURL === `${base}/`); i++) await page.waitForTimeout(50);
  const registrationId = regs.find((r) => r.scopeURL === `${base}/`).registrationId;
  const shown = () => page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map((n) => ({ title: n.title, body: n.body, tag: n.tag, url: n.data?.url })));
  // The headless shell can't show a notification at all (CI uses it); full Chromium can.
  const canShow = await page.evaluate(async () => {
    try {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification('probe', { tag: 'probe' });
      for (const n of await reg.getNotifications({ tag: 'probe' })) n.close();
      return true;
    } catch {
      return false;
    }
  });
  const fetched = (id) => calls.includes(`SW GET ${id} Bearer ${TOKEN}`);
  await cdp.send('ServiceWorker.deliverPushMessage', { origin: base, registrationId, data: JSON.stringify({ k: 'nudge', id: 'nudge-0001' }) });
  for (let i = 0; i < 60 && !(fetched('nudge-0001') && (!canShow || (await shown()).length)); i++) await page.waitForTimeout(50);
  assert.ok(fetched('nudge-0001'), calls.join('\n'));
  if (canShow) assert.deepEqual(await shown(), [{ title: 'Leave by 16:40', body: 'The bus is 10 minutes early today.', tag: 'nudge-0001', url: '/' }]);
  await cdp.send('ServiceWorker.deliverPushMessage', { origin: base, registrationId, data: JSON.stringify({ k: 'nudge', id: 'gone-00000' }) });
  for (let i = 0; i < 60 && !(fetched('gone-00000') && (!canShow || (await shown()).length > 1)); i++) await page.waitForTimeout(50);
  assert.ok(fetched('gone-00000'));
  if (canShow) assert.deepEqual((await shown()).find((n) => n.tag === 'gone-00000'), { title: 'Thunderhead', body: 'Thunderhead has something for you.', tag: 'gone-00000', url: '/' });

  await page.locator('.spage button', { hasText: 'Turn off on this phone' }).click();
  await page.locator('.spage button', { hasText: 'Let me reach you' }).waitFor();
  assert.ok(calls.includes('DELETE /v1/push/subscription'));
  assert.deepEqual(errors, []);
  await context.close();
});

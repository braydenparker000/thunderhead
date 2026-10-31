// The shell's error reporter (frontend/ui/error-items.js, ui/errors.js; NEXT-BATCH.md part 1): node
// checks of the items (the inbox's shape, addresses cut to their host, quoted text and patterns cut
// since browsers quote what was typed, a value that isn't an Error by its kind only, where in the
// site's code, a fingerprint per distinct error, "Script error." dropped) and of the batching (2 s after the last,
// at once on flush, repeats as a count, 3 a fingerprint and 20 a page), then Chromium at phone size
// against the mock Worker: signed in, an error thrown on home reaches POST /v1/ops/errors once, with
// the session; signed out, nothing goes. Local only; no network.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { collector, hash, itemOf, PER_PAGE } from '../frontend/ui/error-items.js';
import { API, mockApi, TOKEN } from './fixtures/mock-api.mjs';

const ORIGIN = 'https://site.example';
const base0 = { app: 'home', kind: /** @type {const} */ ('error'), origin: ORIGIN, path: '/', build: 81, at: 1000 };

test('an item: the error\'s words, an address only its host, where in the site\'s code, its own fingerprint', () => {
  const err = new TypeError('cannot read x of https://api.example/v1/files/abc?sig=s3cret');
  err.stack = `TypeError: cannot read x\n    at draw (${ORIGIN}/th/chat/view.js:12:5)\n    at ${ORIGIN}/apps/home/home.js:3:1`;
  const item = itemOf({ ...base0, error: err, message: 'Uncaught TypeError: …' });
  assert.deepEqual(item, {
    fingerprint: `home:${hash('error|TypeError: cannot read x of api.example/…|th/chat/view.js:12:5')}`,
    source: 'client', code: 'home.error', route: '/', message: 'TypeError: cannot read x of api.example/… @ /th/chat/view.js:12:5', build: 81, at: 1000,
  });
  assert.doesNotMatch(JSON.stringify(item), /s3cret|sig=/);
  assert.match(item.fingerprint, /^home:[0-9a-f]{8}$/);
  const other = itemOf({ ...base0, kind: 'rejection', error: new Error('no answer'), path: '/settings/' });
  assert.deepEqual([other.code, other.route, other.message], ['home.rejection', '/settings/', 'Error: no answer']);
  assert.notEqual(other.fingerprint, item.fingerprint);
  assert.equal(itemOf({ ...base0, error: null, message: 'Script error.' }), null, 'cross-origin noise');
  assert.equal(itemOf({ ...base0, error: undefined, message: '' }), null);
  assert.equal(itemOf({ ...base0, error: new Error('x'.repeat(400)) }).message.length, 300);
  assert.equal(itemOf({ ...base0, error: new Error('see HTTP://me:pw@h.example:8080/My Song?q=1') }).message, 'Error: see h.example:8080/…');
});

test('an item never carries what was typed: quoted text and patterns cut, another value by its kind only', () => {
  const words = (error, kind = 'error', message) => itemOf({ ...base0, kind, error, message }).message;
  assert.equal(words(new TypeError('Failed to construct \'URL\': Invalid URL "my typed words"')), 'TypeError: Failed to construct …: Invalid URL …');
  assert.equal(words(new TypeError('"what I typed" cannot be parsed as a URL.')), 'TypeError: … cannot be parsed as a URL.');
  assert.equal(words(new SyntaxError('Unexpected identifier "secret"')), 'SyntaxError: Unexpected identifier …');
  assert.equal(words(new SyntaxError('Invalid regular expression: /my (search/: Unterminated group')), 'SyntaxError: Invalid regular expression: …: Unterminated group');
  assert.equal(words('my typed words', 'rejection'), 'Rejected: not an Error (string)');
  assert.equal(words({ password: 'x' }, 'rejection'), 'Rejected: not an Error (object)');
  assert.equal(words(undefined, 'rejection'), 'Rejected: not an Error (undefined)');
  assert.equal(words('my typed words', 'error', 'Uncaught my typed words'), 'Thrown: not an Error (string)');
  // An "error" event with no value at all: the browser's own words, cleaned the same way.
  assert.equal(words(null, 'error', 'ResizeObserver loop completed with undelivered notifications.'), 'ResizeObserver loop completed with undelivered notifications.');
  const a = itemOf({ ...base0, error: new SyntaxError('Unexpected identifier "one"') });
  const b = itemOf({ ...base0, error: new SyntaxError('Unexpected identifier "two"') });
  assert.equal(a.fingerprint, b.fingerprint, 'the same error whatever was typed');
});

test('batches: 2 s after the last, at once on flush, a repeat as a count, 3 a fingerprint and 20 a page', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const posts = [];
  const c = collector((items) => posts.push(items.map((i) => ({ ...i }))));
  const item = (n) => itemOf({ ...base0, error: new Error(`boom ${n}`) });
  assert.equal(c.add(item(1)), true);
  t.mock.timers.tick(1500);
  c.add(item(1));
  c.add(item(2));
  t.mock.timers.tick(1999);
  assert.equal(posts.length, 0, 'waits 2 s after the last');
  t.mock.timers.tick(1);
  assert.deepEqual(posts[0].map((i) => [i.message, i.count]), [['Error: boom 1', 2], ['Error: boom 2', undefined]]);
  assert.equal(c.add(item(1)), true, 'a third time');
  assert.equal(c.add(item(1)), false, 'not a fourth');
  c.flush();
  assert.equal(posts.length, 2);
  for (let n = 3; n < 40; n++) c.add(item(n));
  c.flush();
  t.mock.timers.tick(2000);
  t.mock.timers.tick(2000);
  assert.equal(posts.flat().length, PER_PAGE, '20 items a page at most');
  assert.ok(posts.every((p) => p.length <= 10), 'up to 10 a batch');
  assert.equal(c.add(null), false);
});

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

async function home(signedIn) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const api = await mockApi(page);
  await page.goto(`${base}/no-such-page`);
  if (signedIn) await page.evaluate((token) => new Promise((resolve, reject) => {
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
  return { context, page, api };
}
const inbox = (api) => api.calls.filter((c) => c.call === 'POST /v1/ops/errors');

test('signed in, an error thrown on home reaches the inbox once, with the session', opts, async () => {
  const { context, page, api } = await home(true);
  await page.waitForFunction(() => document.documentElement.dataset.signedIn !== undefined);
  // The same error twice (a repeat is its count), then the page hidden: one request, one item.
  await page.evaluate(() => {
    for (let i = 0; i < 2; i++) setTimeout(() => { throw new Error('test boom on home https://h.example/x?k=1'); });
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  for (let i = 0; i < 40 && !inbox(api).length; i++) await page.waitForTimeout(100);
  await page.waitForTimeout(2500);
  const sent = inbox(api);
  assert.equal(sent.length, 1, 'one request');
  assert.equal(sent[0].auth, `Bearer ${TOKEN}`);
  const [item, ...rest] = sent[0].body.items;
  assert.deepEqual(rest, []);
  assert.deepEqual({ ...item, at: 0, fingerprint: '', build: 0 }, { fingerprint: '', source: 'client', code: 'home.error', route: '/', message: 'Error: test boom on home h.example/…', build: 0, at: 0, count: 2 });
  assert.ok(Number.isInteger(item.build), 'the site build');
  assert.match(item.fingerprint, /^home:[0-9a-f]{8}$/);
  await context.close();
});

test('signed out, nothing goes', opts, async () => {
  const { context, page, api } = await home(false);
  // Signed out, home goes to sign-in; an error there before it leaves is not sent.
  await page.evaluate(() => setTimeout(() => { throw new Error('signed out boom'); })).catch(() => {});
  await page.waitForTimeout(2500);
  assert.equal(inbox(api).length, 0);
  await context.close();
});

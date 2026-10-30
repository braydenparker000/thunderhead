// The ported pages' error reports (frontend/assets/error-report.js; MIGRATION.md §2.5) in Chromium,
// served at the live site's address (the reporter sends only from there): signed in, a moved app's
// page (Music, as staged, with the API host in its CSP) sends an uncaught error to the new
// Worker's inbox (mocked) with the session, in the inbox's shape; a page whose app hasn't moved (Astra) still
// sends to the old Worker's inbox, without the session. Local only; no network.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (mocked API)' };
const SITE = 'https://thunderhead.z13.web.core.windows.net';
const OLD = 'https://jarvis-hub-api.braydenparker999.workers.dev';
const TOKEN = `th1_${'A'.repeat(43)}abcdef`;
const API = 'https://api.example.test';
let site, browser, base;
const inbox = [];

before(async () => {
  if (live) return;
  site = await serve(0, { api: API });
  base = `http://127.0.0.1:${site.address().port}`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => { await browser?.close(); site?.close(); });

async function signedIn() {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  // The live site's address, answered by the local build.
  await context.route(`${SITE}/**`, async (route) => route.fulfill({ response: await route.fetch({ url: base + new URL(route.request().url()).pathname }) }));
  const old = [];
  await context.route(`${OLD}/**`, (route) => {
    old.push({ path: new URL(route.request().url()).pathname, auth: route.request().headers().authorization ?? '', body: route.request().postDataJSON() });
    return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': SITE } });
  });
  // The new Worker's inbox.
  await context.route(`${API}/**`, (route) => {
    const r = route.request();
    const cors = { 'Access-Control-Allow-Origin': SITE, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' };
    if (r.method() !== 'OPTIONS') inbox.push({ path: new URL(r.url()).pathname, auth: r.headers().authorization ?? '', body: r.postDataJSON() });
    return route.fulfill({ status: 204, headers: cors });
  });
  await context.route(/^https:\/\/(?!thunderhead\.z13|jarvis-hub-api|api\.example\.test)/, (route) => route.abort());
  const page = await context.newPage();
  await page.goto(`${SITE}/no-such-page`);
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
  return { context, page, old };
}
const boom = (page, words) => page.evaluate((w) => setTimeout(() => { throw new Error(w); }), words);

test('a moved app reports to the new inbox with the session; one not yet moved, to the old inbox', opts, async () => {
  const { context, page, old } = await signedIn();
  await page.goto(`${SITE}/music/`, { waitUntil: 'load' });
  await page.waitForTimeout(300);
  await boom(page, 'test boom in music');
  for (let i = 0; i < 40 && !inbox.length; i++) await page.waitForTimeout(100);
  assert.equal(inbox.length, 1, 'one batch reached the new inbox');
  assert.equal(inbox[0].path, '/v1/ops/errors');
  assert.equal(inbox[0].auth, `Bearer ${TOKEN}`);
  const [item] = inbox[0].body.items.filter((i) => i.message.includes('test boom'));
  assert.deepEqual({ ...item, at: 0 }, { source: 'client', code: 'player.error', route: '/music/', message: 'Error: test boom in music', build: 0, at: 0 });

  await page.goto(`${SITE}/astra/`, { waitUntil: 'load' });
  await boom(page, 'test boom in astra');
  for (let i = 0; i < 40 && !old.some((o) => o.path === '/claude-chat/errors'); i++) await page.waitForTimeout(100);
  const sent = old.filter((o) => o.path === '/claude-chat/errors');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].auth, '', 'never the session');
  assert.ok(sent[0].body.reports.some((r) => r.app === 'astra' && r.message === 'Error: test boom in astra'));
  assert.equal(inbox.length, 1, 'nothing more reached the new inbox');
  await context.close();
});

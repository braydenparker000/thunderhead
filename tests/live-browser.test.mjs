// The live site as the owner opens it (TESTING.md §11): the real config.js (with the API address, so sign-in is
// on) and the service worker allowed, unlike tests/home-browser.test.mjs, which stubs both. A signed-out visit to
// home lands on /signin/, no page reports a CSP violation, and the service worker reaches `activated`. Read-only:
// it never signs in and never writes. Runs only when SITE_URL is set (the Deploy workflow sets it).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const site = process.env.SITE_URL?.replace(/\/$/, '');
const opts = { skip: !site && 'SITE_URL not set' };
let browser;
before(async () => { if (site) browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}); });
after(async () => { await browser?.close(); });

test('a signed-out visit lands on /signin/ with no CSP violation, and the service worker activates', opts, async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'allow' });
  const page = await context.newPage();
  // Recorded inside each page and handed out through a binding that outlives the redirect; an address is cut to
  // its path, so a query never reaches the log.
  const violations = [];
  await page.exposeFunction('thLiveCsp', (/** @type {string} */ v) => violations.push(v));
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      // @ts-ignore: the binding above
      window.thLiveCsp(`${location.pathname}: ${e.violatedDirective} ${String(e.blockedURI).split(/[?#]/)[0]}`);
    });
  });
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error' && /Content Security Policy/i.test(m.text())) consoleErrors.push(m.text().split(/[?#]/)[0]); });
  try {
    await page.goto(`${site}/`, { waitUntil: 'load' });
    await page.waitForURL((u) => u.pathname === '/signin/', { timeout: 30_000 });
    await page.waitForLoadState('load');
    // The worker home registered before it sent the visit on (th/update.js); /signin/ is inside its scope.
    await page.waitForFunction(async () => (await navigator.serviceWorker.getRegistration('/'))?.active?.state === 'activated', null, { polling: 500, timeout: 90_000 });
    assert.equal(new URL(page.url()).pathname, '/signin/');
    assert.deepEqual(violations, [], 'no CSP violation');
    assert.deepEqual(consoleErrors, [], 'no CSP error in the console');
  } finally {
    await context.close();
  }
});

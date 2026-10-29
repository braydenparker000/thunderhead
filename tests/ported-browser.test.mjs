// Opens each ported app (P1b) in Chromium at phone size from the local copy of the site: the page
// runs with no uncaught error, nothing breaks its CSP, and every file it asks this site for exists.
// Outside hosts (the old Worker, CDNs, Google) are blocked, so the check needs no network and sends
// nothing; that each app really plays and lists is checked on the live site after the deploy.
// SHOTS=<dir> also saves a screenshot of each page.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

const PAGES = ['/music/', '/guitar/', '/guitar/credits.html', '/podcasts/', '/astra/', '/astra/lab/', '/media/'];
let server, browser, base;
before(async () => {
  server = await serve(0);
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => { await browser?.close(); server?.close(); });

for (const path of PAGES) {
  test(`${path} opens with no errors, within its CSP, with every local file present`, async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const errors = [], missing = [];
    page.on('pageerror', e => errors.push(e.message));
    // Blocked outside requests log "Failed to load resource"; CSP violations name the policy.
    page.on('console', m => { if (m.type() === 'error' && /Content Security Policy|Refused to/i.test(m.text())) errors.push(m.text()); });
    page.on('response', r => { if (r.url().startsWith(base) && r.status() >= 400) missing.push(`${r.status()} ${r.url().slice(base.length)}`); });
    await page.route(url => !url.href.startsWith(base), route => route.abort());
    // Written at deploy from the DRIVE_CONFIG_JSON secret (stage.mjs); here the old repo's empty placeholder.
    await page.route('**/assets/drive-config.json', route => route.fulfill({ contentType: 'application/json', body: '{"apiKey":"","folderId":"","videoFolderId":""}' }));
    await page.goto(base + path, { waitUntil: 'load' });
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(800);
    if (process.env.SHOTS) await page.screenshot({ path: join(process.env.SHOTS, `${path.replace(/\W+/g, '-').replace(/^-|-$/g, '') || 'home'}.png`) });
    assert.deepEqual(missing, [], `${path} asked for files the site does not have`);
    assert.deepEqual(errors, [], `${path} had errors`);
    await page.close();
  });
}

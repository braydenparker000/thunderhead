// The anime pick (frontend/th/astra/open.js; ASTRA.md §4.1, the owner's day-1 request) in the real
// Astra, against one invented add-on served by the test: `/astra/?find=…&type=series&max_mb=200`
// opens the title's Details (never Streams or the player) and leaves the address clean; on Streams
// the "Under 200 MB" chip hides a larger stream (one of unknown size stays) until it is removed;
// nothing plays by itself (the stream rule).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { bestMatch } from '../frontend/th/astra/open.js';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (invented add-on)' };
const ADDON = 'https://addon.example';
const TITLE = 'Frieren: Beyond Journey’s End';
const META = { id: 'tt0000101', type: 'series', name: TITLE, description: 'An invented series for the test.', videos: [{ id: 'tt0000101:1:1', season: 1, episode: 1, title: 'One' }] };
let site, browser, base;

before(async () => {
  if (live) return;
  site = await serve(0, {});
  base = `http://127.0.0.1:${site.address().port}`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => {
  await browser?.close();
  site?.close();
});

test('the best match by name: the same, else one that starts so, else the first', () => {
  const r = [{ name: 'Frieren Extras' }, { name: TITLE }, { name: 'Other' }];
  assert.equal(bestMatch(r, 'frieren beyond journeys end').name, TITLE);
  assert.equal(bestMatch(r, 'frieren').name, 'Frieren Extras');
  assert.equal(bestMatch([], 'x'), null);
});

test('a link opens the title’s Details; Streams keeps to the size asked until the chip is removed', opts, async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const asked = [];
  await context.route(`${ADDON}/**`, (route) => {
    const u = new URL(route.request().url());
    asked.push(u.pathname);
    const json = (v) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(v) });
    if (u.pathname === '/manifest.json')
      return json({ id: 'example', name: 'Example', version: '1.0.0', resources: ['catalog', 'meta', 'stream'], types: ['series'], idPrefixes: ['tt'], catalogs: [{ type: 'series', id: 'all', name: 'All', extra: [{ name: 'search' }] }] });
    if (u.pathname.startsWith('/catalog/series/all/search='))
      return json({ metas: [{ id: 'tt0000102', type: 'series', name: 'Frieren Extras' }, { id: META.id, type: 'series', name: TITLE }] });
    if (u.pathname.startsWith('/meta/series/')) return json({ meta: META });
    if (u.pathname.startsWith('/stream/'))
      return json({ streams: [
        { name: 'Small', title: 'Ep 1 💾 150 MB', url: 'https://cdn.example/small.mp4' },
        { name: 'Large', title: 'Ep 1 💾 1.2 GB', url: 'https://cdn.example/large.mp4' },
        { name: 'Unknown', title: 'Ep 1', url: 'https://cdn.example/unknown.mp4' },
      ] });
    return route.fulfill({ status: 404, body: '' });
  });
  await context.route('https://v3-cinemeta.strem.io/**', (route) => route.fulfill({ status: 404, body: '' }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/astra/`);
  await page.evaluate((url) => localStorage.setItem('astra.v2.addons', JSON.stringify([{ url: `${url}/manifest.json`, enabled: true, name: 'Example' }])), ADDON);
  await page.goto(`${base}/astra/?find=${encodeURIComponent('Frieren beyond journeys end')}&type=series&max_mb=200`);
  await page.locator('.screen.details').waitFor({ timeout: 20_000 });
  await page.waitForFunction((t) => document.querySelector('.screen.details')?.textContent.includes(t), TITLE);
  assert.equal(new URL(page.url()).search, '', 'the link is read once and removed');
  assert.equal(await page.locator('.screen.streams').count(), 0, 'Details, never Streams');
  // Streams, as the owner would open them: the limit holds.
  await page.waitForFunction(() => window.astra.stack.at(-1)?.screen?.meta?.videos);
  await page.evaluate(() => { const d = window.astra.stack.at(-1).screen; window.astra.openStreams(d.meta, d.meta.videos[0]); });
  await page.locator('.screen.streams').waitFor();
  await page.waitForFunction(() => document.querySelectorAll('.screen.streams .stream-group .group-body > *:not(.stream-skeleton)').length >= 2);
  const shown = async () => page.locator('.screen.streams .group-body').first().textContent();
  assert.match(await shown(), /150 MB/);
  assert.match(await shown(), /Unknown/);
  assert.doesNotMatch(await shown(), /1\.2 GB/);
  await page.getByRole('button', { name: /Under 200 MB/ }).click();
  await page.waitForFunction(() => document.querySelector('.screen.streams .group-body')?.textContent.includes('1.2 GB'));
  // Nothing plays by itself.
  await page.waitForTimeout(500);
  assert.deepEqual(await page.evaluate(() => ({ player: document.querySelectorAll('.screen.player').length, playing: [...document.querySelectorAll('video')].filter((v) => !v.paused).length })), { player: 0, playing: 0 });
  assert.deepEqual(errors, []);
  await context.close();
});

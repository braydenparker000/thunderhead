// Astra's browse screens in a real Chromium at phone size, with an invented add-on and pictures: a poster
// travels into Details and lands where Details' poster is, and Back sends it home to its card; Back in
// mid-flight leaves nothing behind (no copy, every picture shown); Settings › Browse changes what it says
// at once (poster titles, spoiler blur); Library's layout change moves the posters and leaves none moved;
// the hero settles where it was sent, even when sent again mid-settle.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (invented add-on and pictures)', timeout: 60_000 };
const ADDON = 'https://addon.example';
const metas = Array.from({ length: 8 }, (_, i) => ({ id: `tt00009${i}0`, type: i ? 'movie' : 'series', name: `Invented Title ${i}`, releaseInfo: '2001', poster: `https://img.example/p${i}.svg`, background: `https://img.example/b${i}.svg`, description: 'Invented for the test.' }));
const svg = (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#3b5a7a"/></svg>`;
let site, browser, base;

before(async () => {
  if (live) return;
  site = await serve(0, {});
  base = `http://127.0.0.1:${site.address().port}`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => { await browser?.close(); site?.close(); });

async function open() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route('https://img.example/**', (route) => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: route.request().url().includes('/b') ? svg(1280, 720) : svg(300, 450) }));
  await context.route(`${ADDON}/**`, (route) => {
    const u = new URL(route.request().url());
    const json = (v) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(v) });
    if (u.pathname === '/manifest.json') return json({ id: 'example', name: 'Example', version: '1.0.0', resources: ['catalog', 'meta'], types: ['movie', 'series'], idPrefixes: ['tt'], catalogs: [{ type: 'movie', id: 'top', name: 'Top' }] });
    if (u.pathname.startsWith('/catalog/')) return json({ metas });
    if (u.pathname.startsWith('/meta/')) {
      const id = decodeURIComponent(u.pathname.split('/').pop().replace('.json', ''));
      const m = metas.find((x) => x.id === id) || metas[1];
      return json({ meta: { ...m, videos: m.type === 'series' ? [1, 2, 3].map((e) => ({ id: `${id}:1:${e}`, season: 1, episode: e, name: `Invented Episode ${e}`, overview: 'An invented story.', thumbnail: m.background })) : [] } });
    }
    return route.fulfill({ status: 404, body: '' });
  });
  await context.route('https://v3-cinemeta.strem.io/**', (route) => route.fulfill({ status: 404, body: '' }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((url) => {
    localStorage.setItem('astra.v2.addons', JSON.stringify([{ url: `${url}/manifest.json`, enabled: true, name: 'Example' }]));
    localStorage.setItem('astra.v2.settings', JSON.stringify({ hero: true }));
  }, ADDON);
  await page.goto(`${base}/astra/`);
  await page.waitForFunction(() => document.querySelectorAll('.tab-view[data-tab=home] .rows .poster-card:not(.ph) img.poster-img').length >= 4 && window.astra.screens.home.carousel);
  await page.evaluate(() => window.astra.screens.home.carousel.pause());
  return { context, page, errors };
}

// Copies a travel leaves in the body while it flies (ui/motion.js travel).
const COPIES = () => document.querySelectorAll('body > [aria-hidden="true"][style*="fixed"]').length;

test('a poster travels into Details and home again; Back mid-flight leaves nothing behind', opts, async () => {
  const { context, page, errors } = await open();
  await page.evaluate(() => window.astra.screens.home.view.scrollTo(0, 360));
  const card = '.tab-view[data-tab=home] .rows .poster-card:nth-child(2) .poster-art';
  await page.locator(card).click();
  assert.equal(await page.evaluate(COPIES), 1, 'the poster flies');
  await page.waitForFunction(() => !document.querySelectorAll('body > [aria-hidden="true"][style*="fixed"]').length && document.querySelector('.screen.details .details-poster'));
  const landed = await page.evaluate((card) => {
    const p = document.querySelector('.screen.details .details-poster');
    return { shown: getComputedStyle(p).visibility, src: p.querySelector('img').src, cardSrc: document.querySelector(card + ' img').src, card: getComputedStyle(document.querySelector(card)).visibility };
  }, card);
  assert.deepEqual(landed, { shown: 'visible', src: landed.cardSrc, cardSrc: landed.cardSrc, card: 'visible' }, 'the same picture lands; both shown');
  const log = await page.evaluate(async () => (await import('/astra/src/ui/feel-log.js')).feelEntries().map((e) => e.name));
  assert.ok(log.includes('travel:poster-details') && log.includes('rise:details'), log.join());
  // Back: the picture goes home to its card.
  await page.evaluate(() => window.astra.back());
  assert.equal(await page.evaluate(COPIES), 1, 'it flies home');
  await page.waitForFunction(() => !document.querySelector('.screen-layer') && !document.querySelectorAll('body > [aria-hidden="true"][style*="fixed"]').length);
  assert.equal(await page.locator(card).evaluate((el) => getComputedStyle(el).visibility), 'visible');
  // Open, then Back at once, twice over: no copy left, the card shown, no screen left.
  for (let i = 0; i < 2; i++) {
    await page.locator(card).click();
    await page.evaluate(() => window.astra.back());
  }
  await page.waitForFunction(() => !document.querySelector('.screen-layer') && !document.querySelectorAll('body > [aria-hidden="true"][style*="fixed"]').length);
  assert.equal(await page.locator(card).evaluate((el) => getComputedStyle(el).visibility), 'visible');
  // The hero's button: its backdrop travels to Details' backdrop.
  await page.evaluate(() => window.astra.screens.home.view.scrollTo(0, 0));
  await page.locator('.hero-slide[aria-hidden="false"] .hero-cta').click();
  assert.equal(await page.evaluate(COPIES), 1);
  await page.waitForFunction(() => !document.querySelectorAll('body > [aria-hidden="true"][style*="fixed"]').length && document.querySelector('.screen.details .details-bg img'));
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.screen.details .details-bg')).visibility), 'visible');
  assert.deepEqual(errors, []);
  await context.close();
});

test('Settings › Browse changes what it says at once: poster titles, spoiler blur', opts, async () => {
  const { context, page, errors } = await open();
  const title = () => page.evaluate(() => getComputedStyle(document.querySelector('.rows .poster-card:not(.ph) .poster-title')).display);
  assert.notEqual(await title(), 'none');
  await page.evaluate(() => window.astra.saveSetting('posterTitles', false));
  assert.equal(await title(), 'none');
  await page.evaluate(() => window.astra.saveSetting('posterTitles', true));
  assert.notEqual(await title(), 'none');
  // A series' unwatched episodes: blurred and storyless with Hide spoilers; the first tap reveals, it does not play.
  await page.evaluate(() => window.astra.openTitle({ id: 'tt0000900', type: 'series', name: 'Invented Title 0', poster: 'https://img.example/p0.svg' }));
  await page.waitForSelector('.screen.details .episode-card');
  assert.equal(await page.locator('.screen.details .episode-veil').count(), 0, 'off by default');
  await page.evaluate(() => window.astra.saveSetting('spoilerBlur', true));
  await page.waitForFunction(() => document.querySelectorAll('.screen.details .episode-card.veiled .episode-veil').length === 3, null, { timeout: 5000 });
  assert.equal(await page.locator('.screen.details .episode-card').first().locator('.episode-overview').textContent(), 'Tap to show the story');
  await page.locator('.screen.details .episode-card').first().click();
  await page.waitForFunction(() => !document.querySelector('.screen.details .episode-card').classList.contains('veiled') && !document.querySelector('.screen.details .episode-card').querySelector('.episode-veil'));
  assert.equal(await page.locator('.screen.details .episode-card').first().locator('.episode-overview').textContent(), 'An invented story.');
  assert.equal(await page.locator('.screen.streams').count(), 0, 'the reveal does not play');
  assert.deepEqual(errors, []);
  await context.close();
});

test('Library: a layout change moves the posters and leaves none moved; the hero settles where it was sent', opts, async () => {
  const { context, page, errors } = await open();
  await page.evaluate(() => { for (const m of window.astra.screens.home.previewItems().slice(0, 5)) window.astra.library.toggle(m); window.astra.selectTab('library', true); });
  await page.waitForSelector('.tab-view[data-tab=library] .row .poster-card');
  await page.locator('.layout-toggle').click();
  await page.waitForSelector('.tab-view[data-tab=library] .grid .poster-card');
  const moving = await page.evaluate(() => [...document.querySelectorAll('.library .grid .poster-card')].filter((c) => c.getAnimations().length).length);
  assert.ok(moving >= 3, `${moving} posters move`);
  await page.waitForFunction(() => [...document.querySelectorAll('.library .grid .poster-card')].every((c) => !c.getAnimations().length && getComputedStyle(c).transform === 'none' && !c.style.transformOrigin));
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('astra.v2.libraryLayout'))), 'grid', 'remembered');
  // The hero: sent to 2, then to 3 mid-settle, it rests exactly on 3.
  await page.evaluate(() => window.astra.selectTab('home', true));
  const rest = await page.evaluate(async () => {
    const c = window.astra.screens.home.carousel;
    c.go(2); await new Promise((r) => setTimeout(r, 60)); c.go(3);
    await new Promise((r) => setTimeout(r, 900));
    return { x: new DOMMatrixReadOnly(getComputedStyle(c.track).transform).m41, w: c.el.clientWidth, index: c.index, anims: c.track.getAnimations().length };
  });
  assert.deepEqual(rest, { x: -3 * rest.w, w: rest.w, index: 3, anims: 0 });
  assert.deepEqual(errors, []);
  await context.close();
});

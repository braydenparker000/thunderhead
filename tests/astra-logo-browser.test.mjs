// Every hero logo can be read (frontend/astra/src/screens/logo.js): measured on a small canvas where the image's
// host allows a page to read it, a dark wordmark of little colour is lifted to light, a dark coloured one gives way
// to the title in text, a light or coloured one is left exactly as it is, and one that cannot be measured (its host
// refuses CORS) still shows, with a soft light rim. Home's hero and the Streams header, at phone size, with made
// images on an invented host answered by route interception; every DNS answer but the local host's is refused.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { logoTone } from '../frontend/astra/src/screens/logo.js';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (invented add-on and images)', timeout: 60_000 };
const ADDON = 'https://addon.example';
const IMG = 'https://img.example';
const LOGOS = { black: '#000000', grey: '#2a2a2a', white: '#ffffff', red: '#e50914', deep: '#5a0a0a', refused: '#000000' };
const images = new Map();
const asked = []; // each logo request: its name, and whether it was asked with CORS
let site, browser, base, plainHost, TITLES;

before(async () => {
  if (live) return;
  site = await serve(0, {});
  base = `http://127.0.0.1:${site.address().port}`;
  // The "refused" logo's host sends no CORS header: a page may show its image but not read it.
  plainHost = createServer((req, res) => {
    asked.push(`refused.png ${req.headers.origin ? 'cors' : 'plain'}`);
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
    res.end(images.get('refused'));
  });
  await new Promise((r) => plainHost.listen(0, '127.0.0.1', r));
  TITLES = Object.keys(LOGOS).map((k, i) => ({ id: `tt000060${i}`, type: 'movie', name: `Invented ${k}`, background: `${IMG}/still.png`,
    logo: k === 'refused' ? `http://127.0.0.1:${plainHost.address().port}/refused.png` : `${IMG}/${k}.png` }));
  browser = await chromium.launch({ args: ['--no-proxy-server', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'], ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  // The images, made on a canvas: a dark still, and a wordmark in each colour on a transparent ground.
  const page = await browser.newPage();
  const made = await page.evaluate((logos) => {
    const png = (w, ht, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = ht; draw(c.getContext('2d')); return c.toDataURL('image/png').split(',')[1]; };
    const out = { still: png(640, 360, (g) => { const grad = g.createLinearGradient(0, 0, 640, 360); grad.addColorStop(0, '#1d2430'); grad.addColorStop(1, '#0b0d10'); g.fillStyle = grad; g.fillRect(0, 0, 640, 360); g.fillStyle = '#3a4250'; g.fillRect(380, 40, 160, 220); }) };
    for (const [k, colour] of Object.entries(logos)) out[k] = png(520, 200, (g) => { g.fillStyle = colour; g.font = 'bold 96px sans-serif'; g.textBaseline = 'middle'; g.fillText('INVENTED', 10, 100); g.fillRect(10, 160, 500, 18); });
    return out;
  }, LOGOS);
  for (const [k, b64] of Object.entries(made)) images.set(k, Buffer.from(b64, 'base64'));
  await page.close();
});
after(async () => { await browser?.close(); site?.close(); plainHost?.close(); });

async function app(t) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  t.after(() => context.close());
  const json = (route, v) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(v) });
  await context.route((url) => !/^(http:\/\/127\.0\.0\.1|https:\/\/(addon|img)\.example\/)/.test(url.href), (route) => route.abort());
  await context.route(`${ADDON}/**`, (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === '/manifest.json') return json(route, { id: 'example', name: 'Example', version: '1.0.0', resources: ['catalog', 'stream'], types: ['movie'], idPrefixes: ['tt'], catalogs: [{ type: 'movie', id: 'top', name: 'Top' }] });
    if (u.pathname.startsWith('/catalog/')) return json(route, { metas: TITLES });
    if (u.pathname.startsWith('/stream/')) return json(route, { streams: [] });
    return route.fulfill({ status: 404, body: '' });
  });
  asked.length = 0;
  await context.route(`${IMG}/**`, (route) => {
    const u = new URL(route.request().url());
    asked.push(`${u.pathname.slice(1)} ${route.request().headers().origin ? 'cors' : 'plain'}`);
    return route.fulfill({ status: 200, contentType: 'image/png', headers: { 'Access-Control-Allow-Origin': '*' }, body: images.get(u.pathname.slice(1).replace('.png', '')) });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/astra/`);
  await page.evaluate((url) => localStorage.setItem('astra.v2.addons', JSON.stringify([{ url: `${url}/manifest.json`, enabled: true, name: 'Example' }])), ADDON);
  await page.goto(`${base}/astra/`);
  await page.waitForSelector('.hero-slide');
  return { page, errors };
}

/** What each title's hero shows once its logo has arrived: the logo's treatment, or the title in text. */
async function heroLogos(page) {
  const names = TITLES.map((m) => m.name);
  await page.evaluate(() => { const c = window.astra.screens.home.carousel; c.slides.forEach((s) => s.querySelectorAll('img').forEach((i) => { i.loading = 'eager'; })); });
  await page.waitForFunction((n) => [...document.querySelectorAll('.hero-slide')].filter((s) => s.querySelector('.hero-title') || s.querySelector('.hero-logo-img[data-tone]')).length === n, names.length);
  return page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.hero-slide')].map((s) => {
    const img = s.querySelector('.hero-logo-img');
    return [s.getAttribute('aria-label'), img ? ['lift', 'rim'].find((c) => img.classList.contains(`logo-${c}`)) || 'as is' : s.querySelector('.hero-title') ? 'text' : 'none'];
  })));
}

test('a logo is measured from its pixels: dark and grey, dark and coloured, light, coloured, boxed, empty', () => {
  const px = (rgba, n = 100, ground = [0, 0, 0, 0], cover = 0.3) => Uint8ClampedArray.from({ length: n * 4 }, (_, i) => ((i >> 2) < n * cover ? rgba : ground)[i % 4]);
  assert.equal(logoTone(px([0, 0, 0, 255])).tone, 'dark');
  assert.equal(logoTone(px([40, 40, 44, 255])).tone, 'dark');
  assert.equal(logoTone(px([26, 42, 74, 255])).tone, 'dark', 'a dark navy: little colour');
  assert.equal(logoTone(px([90, 10, 10, 255])).tone, 'dark-colour');
  assert.equal(logoTone(px([255, 255, 255, 255])).tone, 'light');
  assert.equal(logoTone(px([229, 9, 20, 255])).tone, 'light', 'a bright red reads on dark art: left as it is');
  assert.equal(logoTone(px([200, 160, 40, 255])).tone, 'light');
  assert.equal(logoTone(px([0, 0, 0, 255], 100, [250, 250, 250, 255])).tone, 'boxed', 'a logo on its own opaque box');
  assert.equal(logoTone(px([0, 0, 0, 0])).tone, 'empty');
  assert.equal(logoTone(px([0, 0, 0, 20])).tone, 'empty', 'nearly transparent pixels are not the logo');
});

test("Home's hero: dark logos lifted, a dark coloured one as text, the others as they are, a refused one rimmed", opts, async (t) => {
  const { page, errors } = await app(t);
  assert.deepEqual(await heroLogos(page), {
    'Invented black': 'lift', 'Invented grey': 'lift', 'Invented white': 'as is', 'Invented red': 'as is', 'Invented deep': 'text', 'Invented refused': 'rim',
  });
  // The refused logo was asked with CORS, refused, then asked plainly once; the others once each, with CORS.
  assert.deepEqual(asked.filter((a) => a.startsWith('refused')), ['refused.png cors', 'refused.png plain']);
  assert.deepEqual(asked.filter((a) => a.startsWith('white')), ['white.png cors']);
  // The lifted logo is light where it is drawn; the one left as it is was not touched.
  assert.match(await page.locator('.hero-slide[aria-label="Invented black"] .hero-logo-img').evaluate((el) => getComputedStyle(el).filter), /invert\(1\)/);
  assert.doesNotMatch(await page.locator('.hero-slide[aria-label="Invented white"] .hero-logo-img').evaluate((el) => getComputedStyle(el).filter), /invert|255, 255, 255/);
  if (process.env.ASTRA_SHOTS) {
    for (const m of TITLES) {
      await page.evaluate((name) => { const c = window.astra.screens.home.carousel; c.go(c.items.findIndex((x) => x.name === name), false); }, m.name);
      await page.waitForTimeout(100);
      await page.locator('.hero').screenshot({ path: `${process.env.ASTRA_SHOTS}/hero-${m.name.split(' ')[1]}.png` });
    }
  }
  assert.deepEqual(errors, []);
});

test('the Streams header uses the same logo: a black wordmark is lifted there too', opts, async (t) => {
  const { page, errors } = await app(t);
  await page.evaluate((m) => window.astra.openStreams(m), TITLES[0]);
  await page.waitForFunction(() => document.querySelector('.streams-logo[data-tone]'));
  assert.equal(await page.locator('.streams-logo').evaluate((el) => el.classList.contains('logo-lift')), true);
  await page.evaluate(() => window.astra.back());
  await page.evaluate((m) => window.astra.openStreams(m), TITLES[4]);
  await page.waitForFunction(() => document.querySelectorAll('.screen.streams').length === 1 && document.querySelector('.screen.streams .streams-name'));
  assert.equal(await page.locator('.screen.streams .streams-name').textContent(), 'Invented deep', 'a dark coloured logo: the title in text');
  if (process.env.ASTRA_SHOTS) await page.screenshot({ path: `${process.env.ASTRA_SHOTS}/streams-header.png` });
  assert.deepEqual(errors, []);
});

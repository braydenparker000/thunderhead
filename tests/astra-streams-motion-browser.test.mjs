// How the stream list moves (FEEL.md), in the real app at phone size: from Details, the backdrop and title
// logo stay exactly where Details had them through the whole push (the screen slides, they do not), and Back
// in the middle of it leaves Details at rest; a filter chip's fill springs in and ends filled; an empty state
// fades in place and ends opaque. An invented add-on answers by route interception; nothing reaches a real host.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (invented add-on)', timeout: 60_000 };
const ADDON = 'https://addon.example';
const META = { id: 'tt0000601', type: 'movie', name: 'An Invented Film', runtime: '118 min', background: `${ADDON}/bg.png`, logo: `${ADDON}/logo.png`, genres: ['Drama'] };
const STREAMS = [
  { name: 'Example\n1080p', description: 'Invented.Film.2019.1080p.WEB-DL.x265-INV\n💾 1.4 GB', url: 'https://cdn.example/a.mkv' },
  { name: 'Example\n720p', description: 'Invented.Film.2019.720p.WEB-DL.x264-INV\n💾 700 MB', url: 'https://cdn.example/b.mkv' },
];

/** A small PNG, every pixel from `px(x, y)` ([r, g, b, a]). */
function png(w, ht, px) {
  const raw = Buffer.alloc((w * 4 + 1) * ht);
  let o = 0;
  for (let y = 0; y < ht; y++) { raw[o++] = 0; for (let x = 0; x < w; x++) for (const v of px(x, y)) raw[o++] = v; }
  const crc = (b) => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const head = Buffer.alloc(13); head.writeUInt32BE(w, 0); head.writeUInt32BE(ht, 4); head[8] = 8; head[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const BG = png(64, 36, (x, y) => [40 + x * 2, 60 + y * 2, 120, 255]);
const LOGO = png(60, 20, (x, y) => (y > 4 && y < 16 && x % 12 < 9 ? [240, 220, 120, 255] : [0, 0, 0, 0]));

let site, browser, base;
before(async () => {
  if (live) return;
  site = await serve(0, {});
  base = `http://127.0.0.1:${site.address().port}`;
  browser = await chromium.launch({ args: ['--no-proxy-server', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'], ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
});
after(async () => { await browser?.close(); site?.close(); });

async function app(t, { addons = true, streams = STREAMS } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  t.after(() => context.close());
  const json = (route, v) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(v) });
  await context.route((url) => !/^(http:\/\/127\.0\.0\.1|https:\/\/addon\.example\/)/.test(url.href), (route) => route.abort());
  await context.route(`${ADDON}/**`, (route) => {
    const u = new URL(route.request().url());
    const image = (body) => route.fulfill({ status: 200, contentType: 'image/png', headers: { 'Access-Control-Allow-Origin': '*' }, body });
    if (u.pathname === '/bg.png') return image(BG);
    if (u.pathname === '/logo.png') return image(LOGO);
    if (u.pathname === '/manifest.json') return json(route, { id: 'example', name: 'Example', version: '1.0.0', resources: ['stream'], types: ['movie'], idPrefixes: ['tt'], catalogs: [] });
    if (u.pathname.startsWith('/stream/')) return json(route, { streams });
    return route.fulfill({ status: 404, body: '' });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/astra/`);
  await page.evaluate((url) => {
    localStorage.setItem('astra.v2.addons', JSON.stringify(url ? [{ url: `${url}/manifest.json`, enabled: true, name: 'Example' }] : []));
    localStorage.setItem('astra.v2.settings', JSON.stringify({ hero: false }));
    localStorage.setItem('astra.v2.device', JSON.stringify({ motion: 'full' }));
  }, addons ? ADDON : null);
  await page.goto(`${base}/astra/`);
  await page.waitForFunction((n) => window.astra?.openTitle && window.astra.manifests?.size === n, addons ? 1 : 0);
  return { page, errors };
}

test('from Details the backdrop and logo stay where Details had them; Back during the push leaves Details at rest', opts, async (t) => {
  const { page, errors } = await app(t);
  await page.evaluate((m) => window.astra.openTitle(m), META);
  await page.waitForFunction(() => document.querySelector('.screen.details .details-logo')?.complete && document.querySelector('.screen.details .details-bg img')?.complete);
  await page.waitForTimeout(500); // Details' own entry is done
  // Where Details shows them; then, every frame of the push, where the stream list shows its copies.
  const drift = await page.evaluate(async (m) => {
    const box = (el) => { const r = el.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; };
    const was = { logo: box(document.querySelector('.screen.details .details-logo')), art: box(document.querySelector('.screen.details .details-bg')) };
    window.astra.openStreams(window.astra.stack.at(-1).screen.meta || m);
    let worst = 0, frames = 0;
    const end = performance.now() + 450;
    while (performance.now() < end) {
      await new Promise((r) => requestAnimationFrame(r));
      const logo = document.querySelector('.screen.streams .streams-logo.kept'), art = document.querySelector('.screen.streams .streams-img.kept');
      if (!logo || !art) return { missing: true };
      for (const [a, b] of [[box(logo), was.logo], [box(art), was.art]]) worst = Math.max(worst, ...a.map((v, i) => Math.abs(v - b[i])));
      frames++;
    }
    return { worst, frames };
  }, META);
  assert.equal(drift.missing, undefined, 'the stream list shows copies of Details\' backdrop and logo');
  assert.ok(drift.frames >= 5, `frames: ${drift.frames}`);
  assert.ok(drift.worst < 1, `moved by ${drift.worst}px during the push`);
  // The list rises under them; then Back in the middle of the next push: Details ends at rest, the list gone.
  await page.waitForFunction(() => document.querySelectorAll('.screen.streams .stream-card').length === 2);
  await page.evaluate(() => window.astra.back());
  await page.waitForFunction(() => !document.querySelector('.screen.streams'));
  await page.evaluate(() => { window.astra.openStreams(window.astra.stack.at(-1).screen.meta); return new Promise((r) => setTimeout(r, 120)); });
  await page.evaluate(() => window.astra.back());
  await page.waitForFunction(() => !document.querySelector('.screen.streams'));
  const rest = await page.evaluate(() => { const layer = document.querySelector('.screen.details').closest('.screen-layer'); const s = getComputedStyle(layer); return { transform: s.transform, opacity: s.opacity }; });
  assert.deepEqual(rest, { transform: 'none', opacity: '1' });
  assert.deepEqual(errors, []);
});

test('a chosen filter chip springs its fill in and ends filled; the order chosen is kept for the next title', opts, async (t) => {
  const { page, errors } = await app(t);
  await page.evaluate((m) => window.astra.openStreams(m), META);
  await page.waitForFunction(() => document.querySelectorAll('.screen.streams .stream-card').length === 2);
  const chip = page.locator('.screen.streams .filter-chips.facts .chip', { hasText: 'HEVC' });
  await chip.click();
  assert.equal(await chip.locator('.chip-fill').evaluate((el) => el.getAnimations().length), 1, 'the fill is moving');
  await page.waitForFunction(() => document.querySelectorAll('.screen.streams .stream-card').length === 1);
  await chip.locator('.chip-fill').evaluate((el) => Promise.all(el.getAnimations().map((x) => x.finished)));
  assert.deepEqual(await chip.evaluate((el) => [el.getAttribute('aria-pressed'), getComputedStyle(el.querySelector('.chip-fill')).opacity]), ['true', '1']);
  // Settings › Streams: the starting order is the newest choice, and a remembered list keeps the owner's own.
  await page.evaluate(() => window.astra.saveSetting('streamSort', 'smallest'));
  await page.evaluate((m) => { window.astra.back(); window.astra.openStreams(m); }, META);
  await page.waitForFunction(() => document.querySelectorAll('.screen.streams').length === 1 && document.querySelector('.screen.streams .chip.sort[aria-pressed="true"]'));
  assert.equal(await page.locator('.screen.streams .chip.sort').textContent(), 'Smallest first');
  assert.equal(await page.locator('.screen.streams .filter-chips.facts .chip', { hasText: 'HEVC' }).getAttribute('aria-pressed'), 'true', 'the filter is remembered');
  await page.evaluate(() => window.astra.saveSetting('streamRemember', false));
  await page.evaluate((m) => { window.astra.back(); window.astra.openStreams(m); }, META);
  await page.waitForFunction(() => document.querySelectorAll('.screen.streams').length === 1 && document.querySelectorAll('.screen.streams .stream-card').length === 2);
  assert.equal(await page.locator('.screen.streams .filter-chips.facts .chip', { hasText: 'HEVC' }).getAttribute('aria-pressed'), 'false', 'not remembered: a fresh start');
  assert.deepEqual(errors, []);
});

test('an empty state fades in place and ends opaque', opts, async (t) => {
  const { page, errors } = await app(t, { addons: false });
  await page.evaluate((m) => window.astra.openStreams(m), META);
  const card = page.locator('.screen.streams .state-card');
  await card.waitFor();
  assert.match(await card.textContent(), /No add-ons installed/);
  await page.waitForFunction(() => !document.querySelector('.screen.streams .state-card').getAnimations().length);
  assert.equal(await card.evaluate((el) => getComputedStyle(el).opacity), '1');
  assert.deepEqual(errors, []);
});

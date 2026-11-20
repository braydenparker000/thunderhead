// Ink and Lamp in Chromium at 390×844 against the mocked Worker (frontend/look/, ui/theme.js): off, home
// asks for nothing of it and <html> carries no attribute; on, the attribute is there before the first
// paint and no classic frame shows, the ground is the Ink grey by day and black by night, the
// typefaces load; Settings turns it on and off at once; and a second visit with the network cut
// still shows it whole, from the service worker's lasting cache.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { API, mockApi, TOKEN } from './fixtures/mock-api.mjs';
import { outlast } from './fixtures/waits.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (mocked API)' };
const KIT = readdirSync(new URL('../frontend/look/kit/', import.meta.url));
const INK = 'rgb(214, 214, 210)', CLASSIC_DAY = 'rgb(238, 241, 247)';
let server, browser, base;
before(async () => {
  if (live) return;
  server = await serve(0, { api: API });
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => { await browser?.close(); server?.close(); });

/** A signed-in phone with `theme` and the look as given; every frame until the page shows is recorded. */
async function phone({ theme = 'light', look = '', workers = 'block' } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: workers });
  await context.addInitScript(([t, l]) => {
    try {
      if (!localStorage.getItem('th.p.sent')) {
        localStorage.setItem('th.p.sent', '1');
        localStorage.setItem('th-theme', t);
        if (l) localStorage.setItem('th.s.appearance.look', l);
      }
    } catch {}
    // Each frame until the page is first on screen: the attribute, and the ground if anything shows.
    const frames = (window.__frames = []);
    const look = () => {
      const root = document.documentElement, body = document.body;
      const shown = root && body && getComputedStyle(root).visibility === 'visible' && getComputedStyle(body).visibility === 'visible';
      frames.push({ look: root?.getAttribute('data-look') ?? null, shown: Boolean(shown), ground: shown ? getComputedStyle(body).backgroundColor : '' });
      if (!shown) requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  }, [theme, look]);
  const page = await context.newPage();
  const errors = [], asked = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => asked.push(new URL(r.url()).pathname));
  return { context, page, errors, asked };
}

/** Home, signed in (a session in IndexedDB as the shell keeps it). @param {import('playwright').Page} page */
async function home(page) {
  await mockApi(page, {});
  await page.goto(`${base}/no-such-page`);
  await page.evaluate((token) => new Promise((resolve) => { const req = indexedDB.open('th-auth', 1); req.onupgradeneeded = () => req.result.createObjectStore('kv'); req.onsuccess = () => { const tx = req.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put({ session_id: 's1', token, signed_in_at: Date.now(), username: 'example-owner' }, 'session'); tx.oncomplete = () => { req.result.close(); resolve(); }; }; }), TOKEN);
  await page.goto(`${base}/`, { waitUntil: 'load' });
  await page.waitForSelector('html[data-signed-in]');
}

/** The look as drawn: the ground, a plate's fill, and whether each typeface loads. @param {import('playwright').Page} page */
const drawn = (page) => page.evaluate(async () => {
  const probe = Object.assign(document.createElement('div'), { style: 'background:var(--plate)' });
  document.body.append(probe);
  const plate = getComputedStyle(probe).backgroundColor;
  probe.remove();
  const faces = {};
  for (const f of ['400 19px "EB Garamond"', '500 30px "EB Garamond"', 'italic 400 19px "EB Garamond"', '28px "Jacquard 24"', 'italic 16px "Lamp Fell"', '400 11px "Geist Mono"', '500 11px "Geist Mono"', '900 15px "Doto"']) {
    const loaded = await document.fonts.load(f, f.includes('Doto') ? '17:58' : 'Thursday');
    faces[f] = loaded.length > 0 && loaded.every((x) => x.status === 'loaded');
  }
  return { ground: getComputedStyle(document.body).backgroundColor, plate, faces, ready: document.documentElement.hasAttribute('data-look-ready') };
});

test('with the look off, home asks for nothing of it and <html> has no look attribute', opts, async () => {
  const { context, page, errors, asked } = await phone();
  await home(page);
  await outlast(page, 600); // a negative read: past the first paint, when the look's script would load
  assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-look')), false);
  assert.deepEqual(asked.filter((p) => p.startsWith('/look/')), []);
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), CLASSIC_DAY);
  assert.deepEqual(errors, []);
  await context.close();
});

for (const [theme, ground, plate] of [['light', INK, 'rgb(228, 228, 224)'], ['dark', 'rgb(0, 0, 0)', 'rgb(16, 16, 18)']])
  test(`with it on, the look is there before the first paint (${theme === 'light' ? 'Ink' : 'Lamp'}) and its typefaces load`, opts, async () => {
    const { context, page, errors } = await phone({ theme, look: 'ink-lamp' });
    // The look's files come late, each 60 ms (its sheet, then the three it imports: well within the 400 ms
    // ui/theme.js waits at most), so the page would show the classic look meanwhile.
    await page.route('**/look/**', async (route) => { await new Promise((r) => setTimeout(r, 60)); await route.continue(); });
    await home(page);
    await page.waitForSelector('html[data-look-ready]');
    const frames = await page.evaluate(() => window.__frames);
    assert.equal(frames[0].look, 'ink-lamp', 'the attribute is on <html> at the first frame');
    const shown = frames.filter((f) => f.shown);
    assert.ok(shown.length, 'the page came on screen');
    assert.deepEqual([...new Set(shown.map((f) => f.ground))], [ground], 'no frame shows another ground');
    const look = await drawn(page);
    assert.equal(look.ground, ground);
    assert.equal(look.plate, plate);
    assert.deepEqual(Object.entries(look.faces).filter(([, ok]) => !ok), [], 'every typeface loads');
    assert.equal(await page.evaluate(() => document.documentElement.style.visibility), '', 'the page is not left hidden');
    assert.deepEqual(errors, []);
    await context.close();
  });

test('Settings › Appearance › Look turns it on and off at once', opts, async () => {
  const { context, page, errors } = await phone();
  await home(page);
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('th:open', { detail: { name: 'appearance' } })));
  await page.waitForSelector('.spage.in .scatalog[data-group="appearance"]:not([aria-busy])');
  await page.click('[data-key="appearance.look"] [data-v="ink-lamp"]');
  await page.waitForFunction(() => document.querySelector('link[data-look]')?.sheet && document.documentElement.hasAttribute('data-look-ready'));
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), INK);
  await page.click('[data-key="appearance.look"] [data-v="classic"]');
  assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-look')), false);
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), CLASSIC_DAY);
  assert.deepEqual(errors, []);
  await context.close();
});

test('after one visit, a second with the network cut still shows the look whole', opts, async () => {
  const { context, page, errors } = await phone({ look: 'ink-lamp', workers: 'allow' });
  await home(page);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15000 });
  await page.waitForSelector('html[data-look-kept]', { timeout: 15000 });
  server.signal(false);
  try {
    const again = await context.newPage();
    again.on('pageerror', (e) => errors.push(e.message));
    await mockApi(again, {});
    await again.goto(`${base}/`, { waitUntil: 'load' });
    await again.waitForSelector('html[data-look-ready]');
    const look = await drawn(again);
    assert.equal(look.ground, INK);
    assert.equal(look.plate, 'rgb(228, 228, 224)');
    assert.deepEqual(Object.entries(look.faces).filter(([, ok]) => !ok), [], 'every typeface loads with no signal');
    const missing = await again.evaluate(async (kit) => {
      const { LOOK } = await import(document.querySelector('link[data-look]').href.replace(/look\.css$/, 'look.js'));
      const all = [...kit.map((k) => `kit/${k}`), 'emblems.svg'];
      const got = await Promise.all(all.map((p) => fetch(LOOK + p).then((r) => r.ok, () => false)));
      return all.filter((_, i) => !got[i]);
    }, KIT);
    assert.deepEqual(missing, [], 'every picture of the kit and the emblems come from the phone');
  } finally {
    server.signal(true);
  }
  assert.deepEqual(errors, []);
  await context.close();
});

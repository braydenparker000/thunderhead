// Opening an app ahead of the finger (frontend/apps/home/prewarm.js, HOME.md §12): resting on an
// app in the ring names its page for the browser to load out of sight (a speculation rule, which
// the shell's CSP allows and nothing else inline); sliding on names the next one and only that;
// closing the ring without a choice drops it; Music and Podcasts, which open inside home, are
// never named; the owner's switch turns it off. The test driver keeps the browser from actually
// prerendering, so this checks what is asked for; scripts/open/ring.cjs measures the real thing.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { afterFirstPaint, until } from './fixtures/waits.mjs';

let server, browser, base;
before(async () => {
  server = await serve(0);
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => { await browser?.close(); server?.close(); });

async function open(prefs = {}) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(p => { for (const [k, v] of Object.entries(p)) localStorage.setItem(`th.s.${k}`, v); }, prefs);
  await page.route('**/config.js', route => route.fulfill({ contentType: 'text/javascript', body: "export const CONFIG = { api: '', build: 0, commit: 'dev', repo_url: '' };" }));
  await page.goto(`${base}/`, { waitUntil: 'load' });
  await afterFirstPaint(page);
  return { page, errors };
}
/** The pages the browser is asked to load ahead, from every rule on the page. */
const asked = page => page.evaluate(() => [...document.querySelectorAll('script[type=speculationrules]')].flatMap(s => JSON.parse(s.textContent).prerender.flatMap(r => r.urls)));
/** Waits until exactly `want` is asked for. */
const asks = (page, want, timeout = 15_000) => until(async () => JSON.stringify(await asked(page)) === JSON.stringify(want), { timeout, message: `never asked for exactly ${JSON.stringify(want)}` });
/** The ring's places, clockwise from the top (th/registry/apps.js RING). */
const PLACE = { music: 0, guitar: 1, podcasts: 2, astra: 3, media: 4, study: 5, photos: 6 };
const X = 195, Y = 480;
const hold = async page => { await page.mouse.move(X, Y); await page.mouse.down(); await page.waitForFunction(() => document.querySelector('#ring').classList.contains('show')); };
const slideTo = async (page, app) => {
  const a = (Math.PI * 2 / 7) * PLACE[app];
  await page.mouse.move(X + Math.sin(a) * 70, Y - Math.cos(a) * 70, { steps: 4 });
  await page.waitForFunction(n => document.querySelector('#lbl').textContent === n, { music: 'Music', guitar: 'Guitar', podcasts: 'Podcasts', astra: 'Astra', media: 'My Media', study: 'Study', photos: 'Photos' }[app]);
};

test('resting on an app names its page, sliding on names the next and only that; none chosen, none kept', async () => {
  const { page, errors } = await open();
  assert.match(await page.$eval('meta[http-equiv="Content-Security-Policy"]', m => m.content), /script-src 'self' 'inline-speculation-rules';/);
  assert.equal(await page.evaluate(() => HTMLScriptElement.supports('speculationrules')), true);
  await hold(page);
  assert.deepEqual(await asked(page), [], 'the ring alone asks for nothing');
  await slideTo(page, 'guitar');
  await asks(page, ['/guitar/']);
  await slideTo(page, 'astra');
  await asks(page, ['/astra/']);
  // Back to the middle: no app is chosen, and the page being loaded is kept for now.
  await page.mouse.move(X, Y, { steps: 4 });
  await page.waitForFunction(() => !document.querySelector('#lbl').classList.contains('show'));
  assert.deepEqual(await asked(page), ['/astra/']);
  await page.mouse.up();
  const dropMs = await page.evaluate(async () => (await import('/apps/home/prewarm.js')).DROP_MS);
  await asks(page, [], dropMs + 3000);
  assert.equal(new URL(page.url()).pathname, '/');
  assert.deepEqual(errors, []);
  await page.close();
});

test('a quick slide across the ring names nothing until the finger rests', async () => {
  const { page } = await open();
  await hold(page);
  const dwell = await page.evaluate(async () => (await import('/apps/home/prewarm.js')).DWELL_MS);
  // Two apps inside one dwell: only the one the finger ends on is asked for.
  await page.evaluate(() => { for (const id of ['guitar', 'astra', 'study']) document.dispatchEvent(new CustomEvent('th:ring', { detail: id })); });
  assert.deepEqual(await asked(page), []);
  await page.waitForTimeout(dwell + 80);
  assert.deepEqual(await asked(page), ['/study/']);
  await page.close();
});

test('Music and Podcasts open inside home and are never named, unless the island is off', async () => {
  const { page } = await open();
  const [inHome, layered] = await page.evaluate(async () => [(await import('/apps/home/prewarm.js')).IN_HOME, (await import('/th/island/island.js')).LAYERED]);
  assert.deepEqual([...inHome], [...layered]);
  await hold(page);
  await slideTo(page, 'music');
  await page.waitForTimeout(250);
  assert.deepEqual(await asked(page), []);
  await page.mouse.move(X, Y); await page.mouse.up();
  await page.close();

  const off = await open({ 'island.mode': 'off' });
  assert.equal(await off.page.evaluate(() => document.documentElement.dataset.island), 'off');
  await hold(off.page);
  await slideTo(off.page, 'music');
  await asks(off.page, ['/music/']);
  await off.page.close();
});

test('"Open apps ahead" off, or a phone on data saver: nothing is named and the app opens as before', async () => {
  const { page } = await open({ 'gestures.prewarm': 'false' });
  await hold(page);
  await slideTo(page, 'guitar');
  await page.waitForTimeout(250);
  assert.deepEqual(await asked(page), []);
  await page.route('**/guitar/**', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Guitar</title>' }));
  await Promise.all([page.waitForURL('**/guitar/'), page.mouse.up()]);
  await page.close();

  const saver = await open();
  await saver.page.evaluate(() => Object.defineProperty(navigator, 'connection', { value: { saveData: true }, configurable: true }));
  await hold(saver.page);
  await slideTo(saver.page, 'guitar');
  await saver.page.waitForTimeout(250);
  assert.deepEqual(await asked(saver.page), []);
  await saver.page.close();
});

test('Photos is the new editor: the ring, a chip and a tile land in its Library; Classic brings the shelf back', async () => {
  const { page, errors } = await open();
  const lands = () => page.evaluate(async () => { const { landing } = await import('/th/registry/apps.js'); return ['/photos/', '/photos/?photo=abc', '/guitar/', '/music/'].map(landing); });
  assert.deepEqual(await lands(), ['/lab/editor/', '/photos/?photo=abc', '/guitar/', '/music/'], 'only the front page moves; a link into the shelf still goes there');
  await hold(page);
  await slideTo(page, 'photos');
  await asks(page, ['/lab/editor/']);
  // Let go on Photos: the new editor opens, not the shelf.
  await page.route('**/lab/editor/', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Photos</title>' }));
  await Promise.all([page.waitForURL('**/lab/editor/'), page.mouse.up()]);
  assert.deepEqual(errors, []);
  await page.close();

  const classic = await open({ 'photos.editor': 'classic' });
  assert.equal(await classic.page.evaluate(async () => (await import('/th/registry/apps.js')).landing('/photos/')), '/photos/');
  await hold(classic.page);
  await slideTo(classic.page, 'photos');
  await asks(classic.page, ['/photos/']);
  await classic.page.close();
});

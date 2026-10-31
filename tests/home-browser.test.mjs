// Drives the home page in Chromium at phone size: no errors, and the hold, swipe and + gestures work.
// Set SITE_URL to check a deployed site instead of the local copy; against a live site the
// checks are read-only (nothing is sent).
// CSP violations show up as console errors, so every test also proves the page fits the CSP.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

let server, browser, base;
before(async () => {
  if (process.env.SITE_URL) base = process.env.SITE_URL.replace(/\/$/, '');
  else { server = await serve(0); base = `http://127.0.0.1:${server.address().port}`; }
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => { await browser?.close(); server?.close(); });

async function open(theme = 'light', path = '/') {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(t => { try { localStorage.setItem('th-theme', t); } catch {} }, theme);
  // The gestures are checked signed out of the API: with an API address the shell would go to
  // /signin/ (tests/signin-browser.test.mjs covers that against a mocked Worker).
  await page.route('**/config.js', route => route.fulfill({ contentType: 'text/javascript', body: "export const CONFIG = { api: '', build: 0, commit: 'dev', repo_url: '' };" }));
  await page.goto(base + path, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  return { page, errors };
}
const drag = async (page, x0, x1, y = 300) => {
  await page.mouse.move(x0, y); await page.mouse.down();
  await page.mouse.move(x0 + (x1 - x0) * 0.3, y, { steps: 4 }); await page.mouse.move(x1, y, { steps: 8 });
  await page.mouse.up();
  // The page settles with a transition whose length follows the flick: wait for it to end rather
  // than a fixed time, which a busy machine outruns.
  await page.waitForTimeout(50);
  await page.waitForFunction(() => !document.getAnimations().some(a => a instanceof CSSTransition && a.playState === 'running'), null, { timeout: 3000 });
};
// `+ 0` turns -0 into 0.
const left = (page, sel) => page.$eval(sel, el => Math.round(el.getBoundingClientRect().left) + 0);

test('loads clean in day and night', async () => {
  for (const theme of ['light', 'dark']) {
    const { page, errors } = await open(theme);
    assert.equal(await page.getAttribute('html', 'data-theme'), theme);
    assert.deepEqual(errors, []);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert.ok(overflow <= 0, 'no sideways scroll');
    await page.close();
  }
});

test('the page refuses to show inside a frame', async () => {
  // a fresh page: our own pages forbid frames, so the parent must be a neutral document
  const page = await browser.newPage({ serviceWorkers: 'block' });
  await page.setContent(`<iframe src="${base}/" width="390" height="844"></iframe>`);
  let frame;
  for (let i = 0; i < 50 && !frame; i++) {
    frame = page.frames().find(f => f !== page.mainFrame() && f.url().startsWith(base));
    if (!frame) await page.waitForTimeout(100);
  }
  assert.ok(frame, 'the framed page loaded');
  await frame.waitForLoadState('load');
  assert.equal(await frame.evaluate(() => getComputedStyle(document.body).visibility), 'hidden');
  const top = await open();
  assert.equal(await top.page.evaluate(() => getComputedStyle(document.body).visibility), 'visible');
  await top.page.close(); await page.close();
});

test('holding still opens the Compass ring; sliding picks an app', async () => {
  const { page, errors } = await open();
  await page.mouse.move(200, 300); await page.mouse.down(); await page.waitForTimeout(320);
  assert.ok(await page.$eval('#ring', el => el.classList.contains('show')), 'ring opens');
  await page.mouse.move(200, 230, { steps: 5 }); await page.waitForTimeout(150);
  assert.equal(await page.textContent('#lbl'), 'Music');
  // The app itself is checked in tests/ported-browser.test.mjs; here only the hand-off counts.
  await page.route('**/music/', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Music</title>' }));
  await Promise.all([page.waitForURL(/\/music\/$/, { timeout: 5000 }), page.mouse.up()]);
  assert.deepEqual(errors, []);
  await page.close();
});

test('the ring keeps its pick until the finger is clearly past the boundary (~7 degrees)', async () => {
  const { page, errors } = await open();
  const cx = 200, cy = 420;
  await page.mouse.move(cx, cy); await page.mouse.down(); await page.waitForTimeout(320);
  // angles are measured from where the thumb went down (here the ring's centre too: nothing is clamped)
  const [rx, ry] = [cx, cy];
  const from = deg => [rx + 60 * Math.sin(deg * Math.PI / 180), ry - 60 * Math.cos(deg * Math.PI / 180)];
  // Seven apps: sectors of 360/7 ≈ 51.4°, Music's edge at 25.7°, held until ~7° past it (32.7°) and back (18.7°).
  for (const [deg, want] of [[0, 'Music'], [24, 'Music'], [31, 'Music'], [36, 'Guitar'], [22, 'Guitar'], [15, 'Music'], [-31, 'Music'], [-36, 'Photos']]) {
    await page.mouse.move(...from(deg), { steps: 4 }); await page.waitForTimeout(80);
    assert.equal(await page.textContent('#lbl'), want, `at ${deg} degrees`);
  }
  await page.mouse.move(rx, ry); await page.mouse.up();
  assert.deepEqual(errors, []);
  await page.close();
});

test('near an edge the ring moves in, but a straight swipe up still picks Music', async () => {
  // Owner, 2026-10-31: quick swipes missed. The ring is pulled in from the edge to fit; direction is
  // measured from where the thumb went down, so the thumb's own line counts, not the ring's centre.
  const { page, errors } = await open();
  await page.mouse.move(355, 520); await page.mouse.down(); await page.waitForTimeout(320);
  const rx = await page.$eval('#ring', el => el.getBoundingClientRect().left);
  assert.ok(rx < 330, `the ring is pulled in from the edge (centre at ${rx})`);
  await page.mouse.move(355, 480, { steps: 4 }); await page.waitForTimeout(80);
  assert.equal(await page.textContent('#lbl'), 'Music');
  await page.mouse.move(355, 520, { steps: 2 }); await page.mouse.up();
  assert.deepEqual(errors, []);
  await page.close();
});

test('swipe right opens the briefing, swipe left opens the menu', async () => {
  const { page, errors } = await open();
  await drag(page, 60, 330);
  assert.equal(await left(page, '#brief'), 0, 'briefing in view');
  await drag(page, 330, 40);
  assert.equal(await left(page, '#home'), 0, 'back home');
  await drag(page, 330, 60);
  assert.ok(await left(page, '#side') < 390, 'menu in view');
  await page.click('#dim', { position: { x: 20, y: 300 } }); await page.waitForTimeout(550);
  assert.ok(await left(page, '#side') >= 390, 'menu closed');
  assert.deepEqual(errors, []);
  await page.close();
});

test('+ opens the options sheet; typing swaps the mic for send', async () => {
  const { page, errors } = await open();
  await page.click('#plus'); await page.waitForTimeout(400);
  assert.ok(await page.$eval('#opts', el => el.classList.contains('show')));
  await page.click('#plus');
  await page.fill('#q', 'hello');
  assert.ok(await page.$eval('#ask', el => el.classList.contains('typing')));
  // The mic and send share one spot, centred in the bar (a hit-area rule once stacked them, so the
  // mic rode high and send fell under the bar).
  const boxes = await page.evaluate(() => ['#mic', '#ask .send', '#ask'].map(s => { const r = document.querySelector(s).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }));
  assert.ok(Math.abs(boxes[0][0] - boxes[1][0]) <= 1, 'mic and send at the same x');
  assert.ok(Math.abs(boxes[1][1] - boxes[2][1]) <= 2, 'send centred in the bar');
  if (!process.env.SITE_URL) {
    await page.press('#q', 'Enter'); await page.waitForTimeout(2200);
    assert.equal(await page.textContent('.you'), 'hello');
    assert.ok((await page.textContent('.reply')).length > 10, 'a reply appears');
  }
  assert.deepEqual(errors, []);
  await page.close();
});

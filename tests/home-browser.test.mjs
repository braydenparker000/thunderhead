// Drives the home page in Chromium at phone size: no errors, and the hold, swipe and + gestures work.
// Set SITE_URL to check a deployed site instead of the local copy.
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

async function open(theme = 'light') {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.g/.test(m.text())) errors.push(m.text()); });
  await page.addInitScript(t => { try { localStorage.setItem('th-theme', t); } catch {} }, theme);
  await page.goto(base + '/', { waitUntil: 'load' });
  await page.waitForTimeout(400);
  return { page, errors };
}
const drag = async (page, x0, x1, y = 300) => {
  await page.mouse.move(x0, y); await page.mouse.down();
  await page.mouse.move(x0 + (x1 - x0) * 0.3, y, { steps: 4 }); await page.mouse.move(x1, y, { steps: 8 });
  await page.mouse.up(); await page.waitForTimeout(550);
};
const left = (page, sel) => page.$eval(sel, el => Math.round(el.getBoundingClientRect().left));

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

test('holding still opens the Compass ring; sliding picks an app', async () => {
  const { page, errors } = await open();
  await page.mouse.move(200, 300); await page.mouse.down(); await page.waitForTimeout(320);
  assert.ok(await page.$eval('#ring', el => el.classList.contains('show')), 'ring opens');
  await page.mouse.move(200, 230, { steps: 5 }); await page.waitForTimeout(150);
  assert.equal(await page.textContent('#lbl'), 'Music');
  await page.mouse.up(); await page.waitForTimeout(300);
  assert.match(await page.textContent('#toast'), /Music/);
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
  await page.press('#q', 'Enter'); await page.waitForTimeout(2200);
  assert.equal(await page.textContent('.you'), 'hello');
  assert.ok((await page.textContent('.reply')).length > 10, 'a reply appears');
  assert.deepEqual(errors, []);
  await page.close();
});

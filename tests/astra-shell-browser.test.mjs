// Astra's shell in a real Chromium (FEEL.md "Choreography"): a sheet, a confirm dialog, a toast and the
// lift each come in, rest in place, can be closed midway and leave nothing behind; the first toast
// moves too. Settings, drawn from the registry: its search, an area's page, a change applied at once,
// and "Reset this page".
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only' };
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

async function open() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route(/^https:\/\//, (route) => route.fulfill({ status: 404, body: '' })); // no add-on is reached
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/astra/`);
  await page.waitForFunction(() => window.astra?.tab);
  return { context, page, errors };
}

test('sheet, dialog, toast and lift: in, at rest, closed midway, gone', opts, async () => {
  const { context, page, errors } = await open();
  const r = await page.evaluate(async () => {
    const C = await import('/astra/src/ui/components.js');
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    const t = (sel) => getComputedStyle(document.querySelector(sel)).transform;
    const out = {};
    C.toast('Saved');
    await wait(50);
    out.toastMoving = t('.toast') !== 'matrix(1, 0, 0, 1, ' + -document.querySelector('.toast').offsetWidth / 2 + ', 0)';
    const close = C.sheet('Invented sheet', [{ label: 'One', run() {} }]);
    await wait(50);
    out.sheetMoving = new DOMMatrixReadOnly(t('.sheet-body')).m42 > 0;
    close(); // midway
    await wait(700);
    out.sheetGone = !document.querySelector('.sheet');
    C.confirm('Invented question?', { action: 'Yes' });
    await wait(40);
    out.dialogFrom = new DOMMatrixReadOnly(t('.dialog')).a;
    await wait(500);
    out.dialogRest = [t('.dialog'), getComputedStyle(document.querySelector('.dialog')).opacity];
    document.querySelector('.dialog-btn').click();
    await wait(500);
    out.dialogGone = !document.querySelector('.dialog-layer');
    const src = document.createElement('div');
    src.style.cssText = 'position:fixed;left:20px;top:500px;width:100px;height:150px;background:#c33';
    document.body.append(src);
    const lift = C.liftMenu(src, 'Invented', '2001', [{ label: 'Save', run() {} }]);
    await wait(80);
    out.liftMoving = t('.lift-art') !== 'none';
    out.menuWaits = getComputedStyle(document.querySelector('.lift-menu')).opacity === '0'; // the poster rises first
    await wait(700);
    out.liftRest = [t('.lift-art'), getComputedStyle(document.querySelector('.lift-blur')).opacity];
    lift();
    await wait(600);
    out.liftGone = !document.querySelector('.lift');
    out.toastLeft = !document.querySelector('.toast.show');
    return out;
  });
  assert.deepEqual(r, { toastMoving: true, sheetMoving: true, sheetGone: true, dialogFrom: r.dialogFrom, dialogRest: ['none', '1'], dialogGone: true, liftMoving: true, menuWaits: true, liftRest: ['none', '1'], liftGone: true, toastLeft: true });
  assert.ok(r.dialogFrom >= 0.96 && r.dialogFrom < 1, `the dialog grows from .96 (${r.dialogFrom})`);
  assert.deepEqual(errors, []);
  await context.close();
});

test('Settings: search, an area page, a change applied at once, Reset this page', opts, async () => {
  const { context, page, errors } = await open();
  await page.evaluate(() => window.astra.selectTab('settings', true));
  assert.equal(await page.locator('.settings .set-row', { hasText: 'Stream list' }).count(), 0, 'no rows yet: not listed');
  await page.fill('.settings-search', 'mobile data');
  assert.deepEqual(await page.locator('.settings .set-text b').allTextContents(), ['Save mobile data']);
  await page.fill('.settings-search', '');
  await page.locator('.settings .set-row', { hasText: 'Appearance' }).click();
  await page.locator('.settings-page .swatch[aria-label="Coral"]').click();
  await page.locator('.settings-page .set-row', { hasText: 'Nav bar' }).locator('.chip', { hasText: 'Docked' }).click();
  await page.locator('.settings-page .set-row', { hasText: 'Text size' }).locator('.chip', { hasText: 'Large' }).click();
  const applied = () => page.evaluate(() => ({ accent: getComputedStyle(document.documentElement).getPropertyValue('--accent'), on: getComputedStyle(document.documentElement).getPropertyValue('--on-accent'),
    nav: window.astra.root.dataset.nav, scale: getComputedStyle(document.documentElement).getPropertyValue('--text-scale') }));
  assert.deepEqual(await applied(), { accent: '#ff8a70', on: '#111111', nav: 'docked', scale: '1.12' });
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('astra.v2.settings')).accent), '#ff8a70', 'an Astra setting: it travels in a backup');
  await page.reload();
  await page.waitForFunction(() => window.astra?.tab);
  assert.deepEqual(await applied(), { accent: '#ff8a70', on: '#111111', nav: 'docked', scale: '1.12' }, 'kept and applied at start');
  await page.evaluate(() => window.astra.selectTab('settings', true));
  await page.locator('.settings .set-row', { hasText: 'Appearance' }).click();
  await page.locator('.settings-page .set-reset').click();
  await page.locator('.dialog-btn', { hasText: 'Reset' }).click();
  assert.deepEqual(await applied(), { accent: '#f5f5f5', on: '#111111', nav: 'floating', scale: '1' });
  assert.deepEqual(errors, []);
  await context.close();
});

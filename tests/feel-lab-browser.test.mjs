// The opt-in lab previews and exports tuning without changing ordinary home or a closed panel.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { API, mockApi, TOKEN } from './fixtures/mock-api.mjs';
import { ramp, density } from '../frontend/th/type.js';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (mocked API)' };
let server, browser, base;
before(async () => {
  if (live) return;
  server = await serve(0, { api: API });
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => { await browser?.close(); server?.close(); });

const message = (seq, author) => ({ seq, id: `0192f0c4-0000-7000-8000-${String(seq).padStart(12, '0')}`, thread_id: '0192f0c4-0000-7000-8000-0000000000aa', author, origin: author === 'owner' ? 'owner_device' : 'mind', kind: 'text', body: 'An invented example for the tuning preview.', meta: null, attachments: [], reply_to: null, created_at: Date.now() - 60000, delivered_at: null, acked_at: null, answered_at: Date.now() });
async function open(path = '/?feel', saved = null) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', reducedMotion: 'no-preference' });
  const page = await context.newPage(), errors = [], labRequests = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { if (new URL(r.url()).pathname.startsWith('/lab/feel/')) labRequests.push(r.url()); });
  await mockApi(page, { chat: { messages: [message(1, 'owner'), message(2, 'mind')] } });
  await page.goto(`${base}/no-such-page`);
  await page.evaluate(({ token, saved }) => new Promise(resolve => {
    localStorage.setItem('th.p.sent', '1');
    if (saved !== null) localStorage.setItem('th.lab.feel', saved);
    const req = indexedDB.open('th-auth', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => { const tx = req.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put({ session_id: 's1', token, signed_in_at: Date.now(), username: 'example-owner' }, 'session'); tx.oncomplete = () => { req.result.close(); resolve(); }; };
  }), { token: TOKEN, saved });
  await page.goto(`${base}${path}`);
  await page.waitForSelector('#talk .you');
  if (path.includes('?feel') && !path.includes('?feel=off')) await page.waitForSelector('#feel-lab');
  return { page, context, errors, labRequests };
}
const input = (page, label, value) => page.getByLabel(label, { exact: true }).evaluate((node, value) => { node.value = String(value); node.dispatchEvent(new Event('input', { bubbles: true })); }, value);
const look = page => page.evaluate(() => {
  const root = getComputedStyle(document.documentElement);
  const css = selector => getComputedStyle(document.querySelector(selector));
  return { row: css('#now').fontSize, reply: css('#talk .reply').fontSize, line: css('#talk .reply').lineHeight, ask: css('.ask textarea').fontSize, settle: root.getPropertyValue('--settle'), fast: root.getPropertyValue('--d-fast'), label: root.getPropertyValue('--fs-label') };
});
const physics = page => page.evaluate(async () => {
  const motion = await import('/th/motion.js');
  return { settings: motion.motionSettings(), springs: Object.fromEntries(Object.entries(motion.springs).map(([name, p]) => [name, { stiffness: p.stiffness, damping: p.damping }])) };
});

test('the type axes cover every size and density class while keeping the input floors and literal exceptions', () => {
  const defaults = ramp({ snapOffRamp: false }), tuned = ramp({ base: 14, snapOffRamp: true });
  assert.equal(Object.keys(defaults).length, 30);
  assert.equal(Object.keys(density(1)).length, 17);
  assert.equal(defaults['--fs-body'], '15px');
  assert.equal(defaults['--fs-input'], '16px');
  assert.equal(defaults['--fs-reply'], '16.5px');
  assert.equal(defaults['--fs-x-14-5'], '14.5px');
  assert.equal(tuned['--fs-x-14-5'], '14px');
  for (const text of ['m', 's', 'l']) {
    const values = ramp({ base: 13, text });
    assert.equal(values['--fs-ask'], '16px');
    assert.ok(parseFloat(values['--fs-input']) >= 16);
    assert.equal(values['--fs-x-64'], '64px');
    assert.equal(values['--fs-x-not-found'], 'clamp(32px,9vw,40px)');
    assert.equal(values['--fs-rel-code'], '.84em');
    assert.equal(values['--fs-rel-marker'], '.88em');
    assert.equal(values['--fs-rel-heading'], '1.06em');
  }
  for (const text of ['s', 'l']) {
    const normal = ramp({ base: 16 }), changed = ramp({ base: 16, text });
    assert.deepEqual(Object.keys(changed).filter(key => changed[key] !== normal[key]).sort(), text === 's' ? ['--fs-reply'] : ['--fs-input', '--fs-reply']);
  }
  assert.equal(density(.95)['--lh-reply'], '1.4725');
  assert.equal(density(.95)['--lh-flat'], '1');
  assert.equal(density(.95)['--lh-ask'], '22px');
});

test('home does not load the lab or apply saved tuning without the query', opts, async () => {
  const saved = JSON.stringify({ v: 1, base: 14, tuned: { type: true } });
  const { page, context, errors, labRequests } = await open('/', saved);
  try {
    await page.waitForFunction(() => document.querySelector('#talk .reply'));
    assert.equal(await page.locator('#feel-lab').count(), 0);
    assert.deepEqual(labRequests, []);
    assert.equal((await look(page)).row, '15px');
    assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue('--fs-body')), '');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('the panel tunes springs, sizes and density, follows Appearance, and Reset restores the file values', opts, async () => {
  const { page, context, errors } = await open();
  try {
    const original = await look(page), engine = await physics(page);
    const rect = await page.locator('#feel-lab').boundingBox();
    assert.ok(rect.x >= 0 && rect.x + rect.width <= 390 && rect.y >= 0 && rect.y + rect.height <= 844, 'the sheet fits the phone');
    assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue('--fs-body')), '', 'opening alone keeps the file values');
    await input(page, 'Page stiffness', 700);
    assert.notEqual((await look(page)).settle, original.settle);
    assert.equal((await physics(page)).springs.page.stiffness, 700);
    await page.getByLabel('Snap off-ramp sizes', { exact: true }).check();
    await input(page, 'Base size', 14);
    const changed = await look(page);
    assert.equal(changed.row, '14px');
    assert.notEqual(changed.row, original.row);
    assert.ok(parseFloat(changed.ask) >= 16);
    await input(page, 'Line-height density', .95);
    assert.notEqual((await look(page)).line, changed.line);
    await page.evaluate(() => { document.documentElement.dataset.text = 'l'; });
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#talk .reply')).fontSize === '17px');
    const large = await look(page);
    assert.equal(large.row, changed.row);
    assert.equal(large.ask, '16px');
    await page.evaluate(() => { delete document.documentElement.dataset.text; });
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#talk .reply')).fontSize === '15.5px');
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    assert.deepEqual(await look(page), original);
    assert.deepEqual(await physics(page), engine);
    assert.equal(await page.evaluate(() => localStorage.getItem('th.lab.feel')), null);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('copy exports both axes and Appearance, saved tuning survives reload, and collapse restores the engine and styles', opts, async () => {
  const { page, context, errors, labRequests } = await open();
  try {
    const original = await look(page), engine = await physics(page);
    await input(page, 'Page stiffness', 700);
    await page.getByLabel('Snap off-ramp sizes', { exact: true }).check();
    await input(page, 'Base size', 14);
    await input(page, 'Line-height density', .95);
    await input(page, 'Scale while held', .96);
    await input(page, 'Press-in duration', 120);
    await page.getByLabel('Haptics', { exact: true }).uncheck();
    await page.getByLabel('Reduced motion', { exact: true }).check();
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.getByRole('button', { name: 'Copy tokens', exact: true }).click();
    const exported = await page.getByLabel('Tokens to save', { exact: true }).inputValue();
    const root = exported.slice(0, exported.indexOf('\n}'));
    assert.equal((root.match(/--fs-[\w-]+:/g) || []).length, 30);
    assert.equal((root.match(/--lh-[\w-]+:/g) || []).length, 17);
    assert.match(exported, /:root\[data-text="s"\]\{--fs-reply:14\.5px;--fs-input:16px\}/);
    assert.match(exported, /:root\[data-text="l"\]\{--fs-reply:17px;--fs-input:16px\}/);
    assert.match(exported, /--fs-ask:16px;/);
    assert.match(exported, /--lh-ask:22px;/);
    assert.match(exported, /--press-scale:0\.96;/);
    assert.match(exported, /engine: page \{"stiffness":700,"damping":0\.8\}/);
    await page.waitForFunction(() => document.querySelector('.feel-status').textContent.startsWith('Tokens copied.'));
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), exported);
    const tuned = await look(page);
    await page.reload(); await page.waitForSelector('#feel-lab'); await page.waitForSelector('#talk .reply');
    assert.deepEqual(await look(page), tuned);
    assert.equal(await page.getByLabel('Base size', { exact: true }).inputValue(), '14');
    assert.equal((await physics(page)).settings.reduced, true);
    await page.getByRole('button', { name: 'Collapse', exact: true }).click();
    assert.deepEqual(await look(page), original);
    assert.deepEqual(await physics(page), engine);
    assert.equal(await page.locator('#feel-body').isVisible(), false);
    await page.getByRole('button', { name: 'Open feel', exact: true }).click();
    assert.deepEqual(await look(page), tuned);
    labRequests.length = 0;
    await page.goto(`${base}/?feel=off`); await page.waitForSelector('#talk .reply');
    assert.equal(await page.locator('#feel-lab').count(), 0);
    assert.equal(await page.evaluate(() => localStorage.getItem('th.lab.feel')), null);
    assert.deepEqual(labRequests, []);
    assert.deepEqual(await look(page), original);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('Reset exports the original sizes even with Appearance active, and the panel moves by pointer and keyboard', opts, async () => {
  const { page, context, errors } = await open('/?feel', '{invalid json');
  try {
    await page.evaluate(() => { document.documentElement.dataset.text = 'l'; });
    await input(page, 'Base size', 14);
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    assert.equal((await look(page)).reply, '18.5px');
    await page.getByRole('button', { name: 'Copy tokens', exact: true }).click();
    const exported = await page.getByLabel('Tokens to save', { exact: true }).inputValue();
    assert.match(exported, /--fs-reply:16\.5px;/);
    assert.match(exported, /:root\[data-text="s"\]\{--fs-reply:15px;--fs-input:15px\}/);
    assert.match(exported, /:root\[data-text="l"\]\{--fs-reply:18\.5px;--fs-input:18px\}/);
    await page.getByRole('button', { name: 'Collapse', exact: true }).click();
    const before = await page.locator('#feel-lab').boundingBox(), handle = await page.getByRole('button', { name: 'Move tuning panel' }).boundingBox();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down(); await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2 - 100, { steps: 5 }); await page.mouse.up();
    const moved = await page.locator('#feel-lab').boundingBox();
    assert.ok(moved.y < before.y - 80);
    await page.getByRole('button', { name: 'Move tuning panel' }).press('ArrowDown');
    assert.ok((await page.locator('#feel-lab').boundingBox()).y > moved.y);
    for (let i = 0; i < 50; i++) await page.getByRole('button', { name: 'Move tuning panel' }).press('ArrowUp');
    await page.getByRole('button', { name: 'Open feel', exact: true }).click();
    const reopened = await page.locator('#feel-lab').boundingBox();
    assert.ok(reopened.y >= 8 && reopened.y + reopened.height <= 836, 'reopening after a drag keeps the controls in the viewport');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('stored tuning accepts only the supported finite values', opts, async () => {
  const saved = JSON.stringify({
    v: 1, springs: { page: { stiffness: 1e9, damping: -1 }, ring: { stiffness: 'url(https://invalid.example/)', damping: null } },
    pressScale: -100, pressTime: 1e9, base: 1e9, ratio: '1.25', heroMax: '48px', density: -1,
    haptics: 'false', reduced: 'true', snapOffRamp: false,
    tuned: { motion: true, pressScale: true, pressTime: true, type: true, density: true, haptics: true, reduced: true, arbitrary: true },
  });
  const { page, context, errors } = await open('/?feel', saved);
  try {
    const engine = await physics(page);
    assert.deepEqual(engine.springs.page, { stiffness: 1600, damping: .5 });
    assert.equal(engine.settings.haptics, true);
    assert.equal(engine.settings.reduced, false);
    assert.equal(await page.getByLabel('Base size', { exact: true }).inputValue(), '16');
    assert.equal(await page.getByLabel('Scale ratio', { exact: true }).inputValue(), '1.2');
    assert.equal(await page.getByLabel('Hero maximum', { exact: true }).inputValue(), '46');
    assert.equal(await page.getByLabel('Scale while held', { exact: true }).inputValue(), '0.94');
    assert.equal(await page.getByLabel('Press-in duration', { exact: true }).inputValue(), '200');
    assert.equal(await page.getByLabel('Line-height density', { exact: true }).inputValue(), '0.9');
    assert.equal(await page.evaluate(() => document.documentElement.style.cssText.includes('invalid.example')), false);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('closing restores prior inline token values, priorities, and engine settings', opts, async () => {
  const { page, context, errors } = await open('/');
  try {
    const before = await page.evaluate(async () => {
      const root = document.documentElement;
      root.style.setProperty('--fs-body', '17px', 'important');
      root.style.setProperty('--d-fast', '123ms');
      const motion = await import('/th/motion.js');
      motion.setSpring('page', { stiffness: 600, damping: .9 });
      motion.configureMotion({ reduced: false, haptics: false });
      const before = root.style.cssText;
      await (await import('/lab/feel/panel.js')).start();
      return before;
    });
    const engine = await physics(page);
    assert.equal((await look(page)).row, '17px');
    await page.getByLabel('Snap off-ramp sizes', { exact: true }).check();
    await input(page, 'Base size', 14);
    await input(page, 'Page stiffness', 700);
    await page.getByLabel('Haptics', { exact: true }).check();
    await page.getByLabel('Reduced motion', { exact: true }).check();
    assert.equal((await look(page)).row, '14px');
    await page.getByRole('button', { name: 'Collapse', exact: true }).click();
    assert.equal(await page.evaluate(() => document.documentElement.style.cssText), before);
    assert.deepEqual(await physics(page), engine);
    assert.equal((await look(page)).row, '17px');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

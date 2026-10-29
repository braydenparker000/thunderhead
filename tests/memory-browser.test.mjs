// Settings → What I remember (MEMORY.md §12) in Chromium at phone size against the mocked Worker
// (tests/fixtures/mock-memory.mjs): the groups and shelves, the filter, a fact's detail, Fix,
// Pin and mute, Forget with its confirm and 10 s undo (and the send when the page closes early),
// loose ends and day notes, a kind and a source this build doesn't know, the empty page, and a
// Worker from before memory. TH_SHOTS=<dir> saves screenshots for review. Local only.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { API, mockApi, TOKEN } from './fixtures/mock-api.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (mocked API)' };
const SHOTS = process.env.TH_SHOTS ?? '';
let server, browser, base;
before(async () => {
  if (live) return;
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  server = await serve(0, { api: API });
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => { await browser?.close(); server?.close(); });

async function open({ theme = 'light', mock = {}, clock = false } = {}) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript((t) => { try { localStorage.setItem('th-theme', t); } catch {} }, theme);
  if (clock) await page.clock.install();
  const api = await mockApi(page, mock);
  await page.goto(`${base}/no-such-page`);
  await page.evaluate(([token]) => new Promise((resolve, reject) => {
    const req = indexedDB.open('th-auth', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => {
      const tx = req.result.transaction('kv', 'readwrite');
      tx.objectStore('kv').put({ session_id: 's1', token, signed_in_at: Date.now(), username: 'example-owner' }, 'session');
      tx.oncomplete = () => { req.result.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }), [TOKEN]);
  errors.length = 0;
  await page.goto(`${base}/settings/memory/`, { waitUntil: 'load' });
  await page.waitForSelector('.msections:not([aria-busy])');
  if (clock) await page.clock.runFor(800); // past the 500 ms tap guard
  else await page.waitForTimeout(600);
  return { page, errors, api };
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}.png`) }); };
const headings = (page) => page.$$eval('.msec h2', (hs) => hs.map((h) => h.textContent));
const ops = (api) => api.calls.filter((c) => c.call === 'POST /v1/memory/ops').map((c) => c.body.ops[0]);

test('the page groups what I know, in day and night, with no errors and no sideways scroll', opts, async () => {
  for (const theme of ['light', 'dark']) {
    const { page, errors } = await open({ theme });
    assert.deepEqual(await headings(page), [
      'How to talk to me (1)', 'Beliefs (1)', 'Goals (1)', 'Preferences (1)', 'Routines (1)', 'Other (1)',
      'Loose ends (1)', 'Days (1)', 'Fading (1)', 'Imported, to review (1)',
    ]);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 0, 'no sideways scroll');
    await shot(page, `memory-${theme === 'light' ? 'day' : 'night'}-list`);
    assert.deepEqual(errors, [], theme);
    await page.close();
  }
});

test('a kind and a source this build does not know still render; private text is blurred until tapped', opts, async () => {
  const { page } = await open();
  const other = page.locator('.msec', { hasText: 'Other (1)' });
  assert.equal(await other.locator('.mtext').textContent(), 'A kind from a later build');
  assert.match(await other.locator('.st2').nth(0).textContent(), /^dreamed · Probably, about 7 in 10 · since /);
  const belief = page.locator('.mrow', { hasText: 'Prays every morning' }).locator('.mtext');
  assert.equal(await belief.getAttribute('class'), 'mtext blur');
  assert.equal(await belief.getAttribute('aria-label'), 'Private. Tap to show.');
  await belief.click();
  assert.equal(await belief.getAttribute('class'), 'mtext');
  assert.equal(await page.locator('.mrow', { hasText: 'Prays every morning' }).locator('.mdetail').isHidden(), true, 'the first tap only shows it');
  await page.close();
});

test('the filter narrows every section; nothing matching says so', opts, async () => {
  const { page } = await open();
  await page.fill('.msearch', 'music');
  await page.waitForTimeout(250);
  assert.deepEqual(await headings(page), ['Preferences (1)']);
  await page.fill('.msearch', 'zzz nothing');
  await page.waitForTimeout(250);
  assert.equal(await page.locator('.msections > .sempty').textContent(), 'Nothing matches.');
  await page.close();
});

test("a fact's detail shows what it rests on and why; Fix writes a new version in my words", opts, async () => {
  const { page, api } = await open();
  await page.click('.mrow:has-text("Practises after lunch") .mtext');
  await page.waitForSelector('.mrow:has-text("Practises after lunch") .mev q');
  assert.equal(await page.locator('.mrow:has-text("Practises after lunch") .mev q').textContent(), 'I said: practises after lunch.');
  assert.equal(await page.locator('.mrow:has-text("Practises after lunch") .mwhy').textContent(), 'Why: you mentioned it twice last week');
  await shot(page, 'memory-detail');
  await page.click('.mrow:has-text("Practises after lunch") button:has-text("Fix")');
  await page.fill('.mrow:has-text("Practises after lunch") textarea', 'Practises after dinner now');
  await shot(page, 'memory-edit');
  await page.click('.mrow:has-text("Practises after lunch") button:has-text("Save")');
  await page.waitForSelector('.mrow:has-text("Practises after dinner now")');
  const fix = ops(api).at(-1);
  assert.equal(fix.op, 'supersede');
  assert.deepEqual([fix.new.text, fix.new.evidence], ['Practises after dinner now', []]);
  await page.close();
});

test('pin, mute, still true and yes that is right send their ops', opts, async () => {
  const { page, api } = await open();
  const act = async (row, button) => {
    await page.click(`.mrow:has-text("${row}") .mtext`);
    await page.click(`.mrow:has-text("${row}") button:has-text("${button}")`);
    await page.waitForTimeout(150);
  };
  await act('Likes calm music', 'Pin');
  await act('Likes calm music', "Don't bring this up");
  await act('Was tired last month', 'Still true');
  await act('Has a herb garden', "Yes, that's right");
  assert.deepEqual(ops(api).map((o) => o.op), ['pin', 'may_raise', 'confirm', 'confirm']);
  assert.equal(await page.locator('.msec h2', { hasText: 'Imported, to review' }).count(), 0, 'reviewed: off the review shelf');
  await page.close();
});

test('Forget asks once, hides the fact, and sends only after the 10 s undo; Undo keeps it', opts, async () => {
  const { page, api } = await open({ clock: true });
  const row = '.mrow:has-text("Likes calm music")';
  await page.click(`${row} .mtext`);
  await page.click(`${row} button:has-text("Forget")`);
  await page.waitForSelector('.csheet');
  assert.equal(await page.locator('.csheet h2').textContent(), 'Forget this?');
  await page.clock.runFor(600);
  await page.click('.csheet button:has-text("Forget")');
  await page.waitForSelector('.utoast.show');
  assert.equal(await page.locator(row).count(), 0, 'off the page while the undo runs');
  await page.click('.uundo');
  await page.clock.runFor(11_000);
  assert.equal(ops(api).length, 0, 'undone: nothing sent');
  assert.equal(await page.locator(row).isVisible(), true);
  await page.click(`${row} .mtext`);
  await page.click(`${row} button:has-text("Forget")`);
  await page.clock.runFor(600);
  await page.click('.csheet button:has-text("Forget")');
  await page.clock.runFor(9_000);
  assert.equal(ops(api).length, 0, 'still inside the undo window');
  await page.clock.runFor(1_500);
  await page.waitForTimeout(100);
  assert.deepEqual(ops(api), [{ op: 'forget', id: '0192f0c4-0000-7000-8000-000000000001' }]);
  await page.close();
});

test('the Forget screens: the confirm sheet, then the undo toast (real time, for the screenshots)', opts, async () => {
  const { page, api } = await open();
  const row = '.mrow:has-text("Likes calm music")';
  await page.click(`${row} .mtext`);
  await page.click(`${row} button:has-text("Forget")`);
  await page.waitForSelector('.csheet.on');
  await page.waitForTimeout(400);
  await shot(page, 'memory-forget-confirm');
  await page.click('.csheet button:has-text("Forget")');
  await page.waitForSelector('.utoast.show');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.utoast').getAttribute('role'), 'status');
  await shot(page, 'memory-forget-undo');
  await page.click('.uundo');
  assert.equal(ops(api).length, 0);
  await page.close();
});

test('closing the page inside the undo window sends the Forget at once', opts, async () => {
  const { page, api } = await open({ clock: true });
  await page.click('.mrow:has-text("Practises after lunch") .mtext');
  await page.click('.mrow:has-text("Practises after lunch") button:has-text("Forget")');
  await page.clock.runFor(600);
  await page.click('.csheet button:has-text("Forget")');
  await page.click('.sback');
  await page.waitForTimeout(200);
  assert.deepEqual(ops(api).map((o) => o.op), ['forget']);
  await page.close();
});

test('loose ends close with Done, or Drop with a reason; a day note is edited in place', opts, async () => {
  const { page, api } = await open();
  await page.click('.mrow:has-text("Fix the metronome bug") button:has-text("Drop")');
  await page.fill('.mrow:has-text("Fix the metronome bug") input', 'Not needed any more');
  await page.click('.mrow:has-text("Fix the metronome bug") button:has-text("Drop it")');
  await page.waitForTimeout(200);
  const patch = api.calls.find((c) => c.call.startsWith('PATCH /v1/memory/open-threads/'));
  assert.deepEqual(patch.body, { status: 'dropped', why: 'Not needed any more' });
  await page.click('.mrow[data-day="2026-10-28"] button:has-text("Edit")');
  await page.fill('.mrow[data-day="2026-10-28"] textarea', 'A calm day. The bug report came in the evening.');
  await page.click('.mrow[data-day="2026-10-28"] button:has-text("Save")');
  await page.waitForTimeout(200);
  const put = api.calls.find((c) => c.call === 'PUT /v1/memory/day-notes/2026-10-28');
  assert.deepEqual(put.body, { summary: 'A calm day. The bug report came in the evening.', decisions: ['Fix the metronome first'], importance: 4 });
  await page.close();
});

test('Add saves a fact in my words; an empty memory and an older Worker each say so', opts, async () => {
  const empty = { facts: [], threads: [], days: [], profile: '', ops: [] };
  let { page, api } = await open({ mock: { memory: empty } });
  assert.match(await page.locator('.msections > .sempty').textContent(), /^Nothing yet\./);
  await shot(page, 'memory-empty');
  await page.click('button:has-text("Add something I should know")');
  await page.selectOption('#memory-kind', 'rule');
  await page.fill('#memory-text', 'Answer in two lines on the phone');
  await page.click('.mform button:has-text("Save")');
  await page.waitForSelector('.mrow:has-text("Answer in two lines")');
  assert.deepEqual(ops(api).map((o) => [o.op, o.kind, o.source, o.evidence]), [['add', 'rule', 'user', []]]);
  await page.close();
  ({ page } = await open({ mock: { memory: null } }));
  assert.equal(await page.locator('.msections .sempty').textContent(), 'Memory arrives with the next update of the Thunderhead.');
  await page.close();
});

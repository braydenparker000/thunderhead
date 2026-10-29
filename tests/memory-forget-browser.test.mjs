// The Memory page's review fixes (stage B.5), each a test that fails on cbddd8c. A Forget reaches
// the Worker however the page ends (Back, reload, the app closed: the next open sends it), a
// failed one is tried again and the fact stays off the page meanwhile, and it never flashes back
// while in flight; a private fact's profile line is blurred until tapped; more than 1,000 facts
// all load and the filter finds any of them, while a long section draws its first 100; focus
// moves to the next fact after a Forget; and the page's touch targets are at least 44 px. Local only.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { memoryState } from './fixtures/mock-memory.mjs';
import { API, forget, forgets, memoryPages, ready, until } from './fixtures/memory-page.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (mocked API)' };
const pages = memoryPages();
before(async () => { if (!live) await pages.start(); });
after(() => pages.stop());

const CALM = '0192f0c4-0000-7000-8000-000000000001';
const calmRows = (page) => page.locator('.mrow', { hasText: 'Likes calm music' }).count();
/** Forgets the browser started for `id`. A request started as a page unloads is the browser's to
 * deliver (keepalive), but the mock can't always intercept one, so this counts what started. */
function started(context, id) {
  const seen = [];
  context.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/v1/memory/ops') && (r.postData() ?? '').includes(id)) seen.push(r.url());
  });
  return () => seen.length > 0;
}

for (const [how, leave] of [
  ['goes Back', (page) => page.goBack({ waitUntil: 'load' })],
  ['opens another page', (page) => page.goto(`${pages.base()}/signin/`, { waitUntil: 'load' })],
]) {
  test(`a Forget still goes out when the owner ${how} inside the 10 s undo`, opts, async () => {
    const { page, context } = await pages.open();
    const sent = started(context, CALM);
    await forget(page, 'Likes calm music');
    await leave(page);
    await until(sent, true, 'started as the page went away');
    await context.close();
  });
}

test('a reload inside the undo window: the Forget goes, and the fact stays off the page', opts, async () => {
  const { page, context, api } = await pages.open();
  await forget(page, 'Likes calm music');
  await page.reload({ waitUntil: 'load' });
  await ready(page);
  assert.equal(await calmRows(page), 0, 'not back on the page while it waits');
  await until(async () => forgets(api).includes(CALM), true);
  await until(() => calmRows(page), 0, 'and gone once the Worker has it');
  await context.close();
});

test('the app closed inside the undo window: the next open of the page sends the Forget', opts, async () => {
  const memory = memoryState();
  const first = await pages.open({ mock: { memory } });
  await forget(first.page, 'Likes calm music');
  await first.page.close();
  const again = await pages.open({ mock: { memory }, context: first.context });
  await until(async () => forgets(again.api).includes(CALM) || forgets(first.api).includes(CALM), true);
  await until(() => calmRows(again.page), 0);
  assert.deepEqual(await again.page.evaluate(() => localStorage.getItem('th.p.forget')), null, 'nothing left to send');
  await first.context.close();
});

test('a Forget that fails for the network is tried again, and the fact stays off the page', opts, async () => {
  const { page, context, api } = await pages.open();
  api.state.chat.fail['/v1/memory/ops'] = 1;
  await forget(page, 'Likes calm music');
  await page.clock.runFor(10_500);
  await until(() => page.locator('.toast:not(.utoast)').allTextContents(), ["Not forgotten yet. I'll keep trying."]);
  assert.equal(await calmRows(page), 0, 'still off the page');
  await page.clock.runFor(5_500);
  await until(() => forgets(api), [CALM, CALM], 'the retry went');
  await until(() => calmRows(page), 0);
  await context.close();
});

test('a forgotten fact never comes back while its Forget is in flight', opts, async () => {
  const { page, context, api } = await pages.open();
  /** @type {() => void} */
  let release = () => {};
  const held = new Promise((r) => { release = r; });
  await page.route(`${API}/v1/memory/ops`, async (route) => { await held; await route.fallback(); });
  await forget(page, 'Likes calm music');
  await page.clock.runFor(10_500);
  const loads = api.calls.filter((c) => c.call === 'GET /v1/memory/facts').length;
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('th:changed', { detail: ['fact'] })));
  await until(() => api.calls.filter((c) => c.call === 'GET /v1/memory/profile').length > loads, true);
  assert.equal(await calmRows(page), 0, 'a refresh meanwhile keeps it off the page');
  release();
  await until(() => forgets(api), [CALM]);
  await context.close();
});

test("a private fact's line in the profile is blurred until tapped", opts, async () => {
  const { page, context } = await pages.open();
  await page.click('.mfold summary');
  const line = page.locator('.mprofile .pline', { hasText: 'Prays every morning' });
  assert.deepEqual([await line.getAttribute('class'), await line.getAttribute('aria-label')], ['pline blur', 'Private. Tap to show.']);
  assert.equal(await page.locator('.mprofile .pline.blur').count(), 1, 'only that one');
  await line.click();
  assert.equal(await line.getAttribute('class'), 'pline');
  await context.close();
});

test('1,200 facts all load; the filter finds the last; a long section draws 100 until Show all', opts, async () => {
  const memory = memoryState();
  const base = memory.facts[0];
  memory.facts = Array.from({ length: 1_200 }, (_, i) => ({
    ...base,
    id: `0192f0c4-0000-7000-8000-${String(i).padStart(12, '0')}`,
    text: `Synthetic preference number ${i}`,
  }));
  const { page, context } = await pages.open({ mock: { memory } });
  const prefs = page.locator('.msec', { has: page.locator('h2', { hasText: 'Preferences' }) });
  assert.equal(await prefs.locator('h2').textContent(), 'Preferences (1200)');
  assert.equal(await prefs.locator('.mrow').count(), 100);
  await page.fill('.msearch', 'number 1199');
  await page.clock.runFor(200);
  await until(() => page.locator('.mrow .mtext').allTextContents(), ['Synthetic preference number 1199']);
  await page.fill('.msearch', '');
  await page.clock.runFor(200);
  await page.locator('.mmore', { hasText: 'Show all 1200' }).click();
  await until(() => prefs.locator('.mrow').count(), 1_200);
  await context.close();
});

test('after a Forget, focus moves to the next fact, not to the page', opts, async () => {
  const { page, context } = await pages.open();
  await forget(page, 'Practises after lunch');
  const focused = await page.evaluate(() => [document.activeElement?.className, document.activeElement?.textContent]);
  assert.deepEqual(focused, ['mtext', 'A kind from a later build'], 'the fact after it on the page');
  await context.close();
});

test('touch targets are at least 44 px: search, profile, a fact, Undo', opts, async () => {
  const { page, context } = await pages.open();
  await forget(page, 'Likes calm music');
  const sizes = await page.evaluate(() =>
    ['.msearch', '.mfold summary', '.mrow .mtext', '.uundo'].map((s) => {
      const r = document.querySelector(s)?.getBoundingClientRect();
      return [s, Math.round(Math.min(r?.width ?? 0, r?.height ?? 0))];
    }),
  );
  for (const [s, px] of sizes) assert.ok(px >= 44, `${s}: ${px} px`);
  await context.close();
});

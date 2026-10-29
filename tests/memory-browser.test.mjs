// Settings → What I remember (MEMORY.md §12) in Chromium at phone size against the mocked Worker
// (tests/fixtures/mock-memory.mjs): the groups and shelves, the filter, a fact's detail, Fix,
// Pin and mute, Forget with its confirm and 10 s undo (and the send when the page closes early),
// loose ends and day notes, a kind and a source this build doesn't know, the empty page, and a
// Worker from before memory. TH_SHOTS=<dir> saves screenshots for review. Local only.
// The page helpers (tests/fixtures/memory-page.mjs) wait on what the page shows or what the mock
// saw, never on a guessed delay; once the page is up its clock moves only when a test moves it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { headings, memoryPages, ops, until } from './fixtures/memory-page.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (mocked API)' };
const SHOTS = process.env.TH_SHOTS ?? '';
const pages = memoryPages();
before(async () => {
  if (live) return;
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  await pages.start();
});
after(() => pages.stop());

const open = (o) => pages.open(o);
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}.png`), animations: 'disabled' }); };

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
  assert.equal(await belief.locator('span').getAttribute('aria-hidden'), 'true', 'its words stay out of the accessibility tree');
  await belief.click();
  assert.equal(await belief.getAttribute('class'), 'mtext');
  assert.equal(await belief.locator('span').getAttribute('aria-hidden'), null);
  assert.equal(await page.locator('.mrow', { hasText: 'Prays every morning' }).locator('.mdetail').isHidden(), true, 'the first tap only shows it');
  await page.close();
});

test('the filter narrows every section; nothing matching says so', opts, async () => {
  const { page } = await open();
  await page.fill('.msearch', 'music');
  await page.clock.runFor(200);
  await until(() => headings(page), ['Preferences (1)']);
  await page.fill('.msearch', 'zzz nothing');
  await page.clock.runFor(200);
  await until(() => page.locator('.msections > .sempty').allTextContents(), ['Nothing matches.']);
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

test('pin, mute, still true and yes that is right send their ops, and the page shows each at once', opts, async () => {
  const { page, api } = await open();
  const row = (text) => page.locator('.mrow', { hasText: text });
  const under = (title, text) => page.locator('.msec', { has: page.locator('h2', { hasText: title }) }).locator('.mrow', { hasText: text });
  const act = async (text, button, shown) => {
    await row(text).locator('.mtext').click();
    await row(text).locator('button', { hasText: button }).click();
    await shown.waitFor();
  };
  await act('Likes calm music', 'Pin', row('Likes calm music').locator('.badge', { hasText: 'Pinned' }));
  await act('Likes calm music', "Don't bring this up", row('Likes calm music').locator('.badge', { hasText: "Won't bring up" }));
  await act('Was tired last month', 'Still true', under('Right now', 'Was tired last month'));
  await act('Has a herb garden', "Yes, that's right", under('Facts', 'Has a herb garden'));
  assert.deepEqual(ops(api).map((o) => o.op), ['pin', 'may_raise', 'confirm', 'confirm']);
  assert.equal(await page.locator('.msec h2', { hasText: 'Imported, to review' }).count(), 0, 'reviewed: off the review shelf');
  await page.close();
});

test('Forget asks once, hides the fact, and sends only after the 10 s undo; Undo keeps it', opts, async () => {
  const { page, api } = await open();
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
  await until(() => ops(api), [{ op: 'forget', id: '0192f0c4-0000-7000-8000-000000000001' }]);
  await page.close();
});

test('the Forget screens: the confirm sheet, then the undo toast', opts, async () => {
  const { page, api } = await open();
  const row = '.mrow:has-text("Likes calm music")';
  await page.click(`${row} .mtext`);
  await page.click(`${row} button:has-text("Forget")`);
  await page.clock.runFor(600); // the sheet slides in on the next frame
  await page.waitForSelector('.csheet.on');
  await shot(page, 'memory-forget-confirm');
  await page.click('.csheet button:has-text("Forget")');
  await page.waitForSelector('.utoast.show');
  assert.equal(await page.locator('.utoast').getAttribute('role'), 'status');
  await shot(page, 'memory-forget-undo');
  await page.click('.uundo');
  await page.clock.runFor(11_000);
  assert.equal(ops(api).length, 0);
  await page.close();
});

test('closing the page inside the undo window sends the Forget at once', opts, async () => {
  const { page, api } = await open();
  await page.click('.mrow:has-text("Practises after lunch") .mtext');
  await page.click('.mrow:has-text("Practises after lunch") button:has-text("Forget")');
  await page.clock.runFor(600);
  await page.click('.csheet button:has-text("Forget")');
  await page.waitForSelector('.utoast.show');
  await page.click('.sback');
  await until(() => ops(api).map((o) => o.op), ['forget']);
  await until(() => page.locator('.utoast').count(), 0, 'no Undo left for what was already sent');
  await page.close();
});

test('another toast inside the undo window leaves Undo alone; a second Forget gets its own 10 s', opts, async () => {
  const { page, api } = await open();
  const forget = async (text) => {
    await page.click(`.mrow:has-text("${text}") .mtext`);
    await page.click(`.mrow:has-text("${text}") button:has-text("Forget")`);
    await page.clock.runFor(600);
    await page.click('.csheet button:has-text("Forget")');
    await page.waitForSelector('.utoast.show');
  };
  await forget('Likes calm music');
  await page.click('.mrow:has-text("Practises after lunch") .mtext');
  await page.click('.mrow:has-text("Practises after lunch") button:has-text("Pin")');
  await until(() => page.locator('.toast:not(.utoast)').allTextContents(), ['Pinned']);
  assert.equal(await page.locator('.utoast .uundo').isVisible(), true, 'the Pinned toast did not replace Undo');
  await page.clock.runFor(4_000);
  await forget('Has a herb garden');
  await page.clock.runFor(6_000);
  await until(() => ops(api).map((o) => o.op), ['pin', 'forget'], 'the first went at its 10 s');
  assert.equal(await page.locator('.utoast.show .uundo').isVisible(), true, 'the second still has its Undo');
  await page.click('.uundo');
  await page.clock.runFor(11_000);
  assert.deepEqual(ops(api).map((o) => o.op), ['pin', 'forget'], 'undone: the second never went');
  assert.equal(await page.locator('.mrow:has-text("Has a herb garden")').isVisible(), true);
  await page.close();
});

test('a card number, key or password is refused with its own line, and the words stay to fix', opts, async () => {
  const { page, api } = await open();
  await page.click('button:has-text("Add something I should know")');
  await page.fill('#memory-text', 'My card is 4111 1111 1111 1111');
  await page.click('.mform button:has-text("Save")');
  await until(() => page.locator('.toast').allTextContents(), ["I don't keep passwords, keys or card numbers. Say it without them."]);
  assert.equal(await page.inputValue('#memory-text'), 'My card is 4111 1111 1111 1111', 'the form stays open with the words');
  assert.equal(ops(api).length, 1);
  assert.equal(await page.locator('.mrow', { hasText: 'My card is' }).count(), 0, 'nothing was kept');
  await page.close();
});

test('loose ends close with Done, or Drop with a reason; a day note is edited in place', opts, async () => {
  const { page, api } = await open();
  await page.click('.mrow:has-text("Fix the metronome bug") button:has-text("Drop")');
  await page.fill('.mrow:has-text("Fix the metronome bug") input', 'Not needed any more');
  await page.click('.mrow:has-text("Fix the metronome bug") button:has-text("Drop it")');
  await page.locator('.mrow', { hasText: 'Fix the metronome bug' }).waitFor({ state: 'detached' });
  const bodies = (call) => api.calls.filter((c) => call(c.call)).map((c) => c.body);
  assert.deepEqual(bodies((c) => c.startsWith('PATCH /v1/memory/open-threads/')), [{ status: 'dropped', why: 'Not needed any more' }]);
  await page.click('.mrow[data-day="2026-10-28"] button:has-text("Edit")');
  await page.fill('.mrow[data-day="2026-10-28"] textarea', 'A calm day. The bug report came in the evening.');
  await page.click('.mrow[data-day="2026-10-28"] button:has-text("Save")');
  await page.locator('.mrow[data-day="2026-10-28"]', { hasText: 'edited by you' }).waitFor();
  assert.deepEqual(bodies((c) => c === 'PUT /v1/memory/day-notes/2026-10-28'), [
    { summary: 'A calm day. The bug report came in the evening.', decisions: ['Fix the metronome first'], importance: 4 },
  ]);
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

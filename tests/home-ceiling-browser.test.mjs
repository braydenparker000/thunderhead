// Home's ceiling round in Chromium at 390×844 against the mocked Worker (owner, 2026-11-21): under Ink
// and Lamp the ask bar's words wrap and the bar grows up to four lines, then scrolls inside, its keys
// at its foot and the conversation above it; the docked decision stands 8 px over the bar at every
// height, closed and opened, keyboard up or down (and Classic's never under it); a hold opens the ring
// on the picture, the verse, the header line (also over a message under it), the side margins and the
// gaps between messages, while a message's text and the rec switch keep theirs; for a screen reader,
// in both looks: the closed + sheet is inert, the ring says the chosen app in one polite line, only a
// new reply is said, each turn has its speaker, and the Briefing's and the menu's headings take the
// focus as they open and the ask bar as they close.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { API, mockApi, TOKEN } from './fixtures/mock-api.mjs';
import { proposal } from './fixtures/mock-proposals.mjs';
import { outlast, until } from './fixtures/waits.mjs';

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

const T = '0192f0c4-0000-7000-8000-0000000000aa';
let n = 0;
const msg = (author, body) => ({ seq: ++n, id: `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`, thread_id: T, author, origin: author === 'owner' ? 'owner_device' : author, kind: 'text', body, meta: null, attachments: [], reply_to: null, created_at: Date.now() - 600_000 + n * 1000, delivered_at: null, acked_at: null, answered_at: Date.now() });
const talk = (k = 2) => Array.from({ length: k }, (_, i) => [
  msg('owner', `Could you plan evening number ${i + 1} for me?`),
  msg('mind', 'Here is a plan: dinner at seven, a short walk, then the quiet playlist, and an early night with the window open.'),
]).flat();
const LONG = 'A long message typed on the phone that goes on and on so that it must wrap onto more lines than one, and then more, until the bar has grown as far as it may and the words scroll inside it.';

/** A signed-in phone on home. */
async function open({ look = true, theme = 'light', messages = talk(), proposals = [], touch = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', hasTouch: touch });
  await context.addInitScript(([t, l]) => {
    try {
      if (!localStorage.getItem('th.p.sent')) {
        localStorage.setItem('th.p.sent', '1');
        localStorage.setItem('th-theme', t);
        localStorage.setItem('th.s.appearance.look', l ? 'ink-lamp' : 'classic');
      }
    } catch {}
  }, [theme, look]);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const api = await mockApi(page, { chat: { messages }, proposals });
  await page.goto(`${base}/no-such-page`);
  await page.evaluate((token) => new Promise((resolve) => { const req = indexedDB.open('th-auth', 1); req.onupgradeneeded = () => req.result.createObjectStore('kv'); req.onsuccess = () => { const tx = req.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put({ session_id: 's1', token, signed_in_at: Date.now(), username: 'example-owner' }, 'session'); tx.oncomplete = () => { req.result.close(); resolve(); }; }; }), TOKEN);
  await page.goto(`${base}/`, { waitUntil: 'load' });
  await page.waitForSelector('html[data-signed-in]');
  if (messages.length) await page.waitForSelector('#talk .reply');
  if (look) {
    await page.waitForSelector('.lk-head .lk-day:not(:empty)');
    await page.waitForSelector('.lk-front:not(.lk-bare) .lk-fig img');
  }
  return { context, page, errors, api };
}

/** Writes into the bar as typing does, then (by default) lets go of it. */
const write = (page, text, blur = true) => page.evaluate(([t, b]) => {
  const q = document.getElementById('q');
  q.value = t;
  q.dispatchEvent(new Event('input', { bubbles: true }));
  if (b) q.blur();
}, [text, blur]);

/** The bar, its field, its keys, the conversation and the docked decision, as laid out. */
const layout = (page) => page.evaluate(() => {
  const r = (s) => { const b = document.querySelector(s)?.getBoundingClientRect(); return b && b.height ? { top: b.top, bottom: b.bottom } : null; };
  const q = document.getElementById('q');
  const ask = document.getElementById('ask');
  const convo = document.getElementById('convo');
  return {
    ask: r('#ask'), plus: r('#plus'), btns: r('#ask .btns'), card: r('#decision .card'), convo: r('#convo'),
    askH: getComputedStyle(document.documentElement).getPropertyValue('--ask-h').trim(), offset: ask.offsetHeight,
    q: { white: getComputedStyle(q).whiteSpace, client: q.clientHeight, scroll: q.scrollHeight, wide: q.scrollWidth - q.clientWidth, line: parseFloat(getComputedStyle(q).lineHeight) },
    pad: parseFloat(getComputedStyle(convo).paddingBottom),
  };
});

test('under the look the ask bar wraps and grows to four lines, then scrolls inside; keys at its foot, the conversation above it', opts, async () => {
  const { context, page, errors } = await open();
  const one = await layout(page);
  await write(page, 'Two words');
  const short = await layout(page);
  assert.equal(short.q.white, 'pre-wrap', 'the words wrap');
  await write(page, LONG.slice(0, 70));
  await until(async () => (await layout(page)).offset > short.offset, { message: 'the bar grew with a second line' });
  await write(page, LONG + ' ' + LONG);
  await until(async () => { const l = await layout(page); return l.askH === `${l.offset}px` && l.offset > short.offset + 40; }, { message: '--ask-h follows the bar' });
  const four = await layout(page);
  assert.ok(four.q.client <= 4 * four.q.line + 24 + 1, `at most four lines tall (${four.q.client})`);
  assert.ok(four.q.client >= 4 * four.q.line + 24 - 1, `four lines tall (${four.q.client})`);
  assert.ok(four.q.scroll > four.q.client, 'the rest scrolls inside the field');
  assert.ok(four.q.wide <= 0, 'nothing runs on sideways');
  for (const k of ['plus', 'btns']) assert.ok(Math.abs(four[k].bottom - one[k].bottom) < 1, `${k} stays at the bar's foot`);
  assert.ok(four.convo.bottom <= four.ask.top + 0.5, 'the conversation ends above the bar');
  await write(page, '');
  await until(async () => (await layout(page)).offset === one.offset, { message: 'the bar shrinks back' });
  assert.deepEqual(errors, []);
  await context.close();
});

for (const look of [true, false]) {
  test(`the docked decision stands fully above the ask bar at every height, opened or not, keyboard up or down (${look ? 'Ink and Lamp' : 'Classic'})`, opts, async () => {
    const { context, page, errors } = await open({ look, proposals: [proposal({ question: 'Forget the old address?', options: ['Forget', 'Keep'], created_by: 'mind:chat' })] });
    await page.waitForSelector('#decision .card', { state: 'visible' });
    const gap = async (what) => {
      await until(async () => { const l = await layout(page); return l.askH === `${l.offset}px`; }, { message: `--ask-h follows the bar (${what})` });
      // The card's own arrival and opening have played out (it is read at rest, never mid-flight).
      await until(() => page.evaluate(() => document.getAnimations().every((a) => a.playState !== 'running' || !(a.effect?.target instanceof Element && a.effect.target.closest('#decision, #ask')))), { message: `the decision at rest (${what})` });
      const l = await layout(page);
      const g = l.ask.top - l.card.bottom;
      if (look) assert.ok(Math.abs(g - 8) < 1, `8 px between the decision and the bar (${what}): ${g}`);
      else assert.ok(g >= 0, `the decision is above the bar (${what}): ${g}`);
      assert.ok(l.convo.bottom <= l.card.top + 0.5, `the conversation ends above the decision (${what})`);
    };
    for (const [i, text] of ['', LONG.slice(0, 70), LONG.slice(0, 120), LONG + LONG].entries()) {
      await write(page, text);
      await gap(`${i + 1} line${i ? 's' : ''}`);
    }
    if (look) {
      await page.click('#decision .lk-q');
      await page.waitForSelector('#decision .card.lk-open');
      await gap('opened');
    }
    await page.setViewportSize({ width: 390, height: 500 }); // the keyboard up: the page resizes to it
    await gap('keyboard up');
    await page.setViewportSize({ width: 390, height: 844 });
    await gap('keyboard down');
    assert.deepEqual(errors, []);
    await context.close();
  });
}

test('under the look a hold opens the ring on the picture, the verse, the header line, the margins and the gaps; text and the rec switch keep theirs', opts, async () => {
  const { context, page, errors } = await open({ touch: true, messages: talk(8) });
  await page.waitForSelector('#talk .reply.lk-drop');
  const cdp = await context.newCDPSession(page);
  const shown = () => page.evaluate(() => document.getElementById('ring').classList.contains('show'));
  // Let go; a hold the ring did not take is cancelled, so it is never also a tap (the rec switch).
  const lift = async (type = 'touchEnd') => {
    await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [] });
    await until(async () => !(await shown()), { message: 'the ring closed' });
  };
  const hold = async ([x, y], opens, what) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    if (opens) await until(shown, { message: `a hold on ${what} opens the ring` });
    else {
      await outlast(page, 400);
      assert.equal(await shown(), false, `a hold on ${what} leaves the ring closed`);
    }
    await lift(opens ? 'touchEnd' : 'touchCancel');
  };
  const at = (fn, arg) => page.evaluate(fn, arg);
  const centre = (s) => at((sel) => { const b = document.querySelector(sel).getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; }, s);
  assert.equal(await at(() => getComputedStyle(document.querySelector('.lk-vtext')).userSelect), 'none', 'the verse is held, not selected');
  await at(() => { document.getElementById('convo').scrollTop = 0; });
  await hold(await centre('.lk-fig'), true, 'the picture');
  await hold(await centre('.lk-vtext'), true, 'the verse');
  await hold([150, 70], true, 'the header line');
  await hold(await centre('.lk-rec'), false, 'the rec switch');
  // A message scrolled up under the header line: there the hold is the ring's.
  const reply = await at(() => {
    const c = document.getElementById('convo');
    const r = document.querySelectorAll('#talk .reply')[0];
    c.scrollTop += r.getBoundingClientRect().top - 60;
    const b = r.getBoundingClientRect();
    return { top: b.top, x: b.left + 40 };
  });
  assert.ok(reply.top < 90 && reply.top > 40, `a message sits under the header line (${reply.top})`);
  assert.ok(await at(([x, y]) => Boolean(document.elementFromPoint(x, y)?.closest('.reply')), [reply.x, 70]), 'the point is on the message');
  await hold([reply.x, 70], true, 'the header line over a message');
  // A message's text in the open, the margins beside it and the gap under it.
  const open2 = await at(() => {
    const r = [...document.querySelectorAll('#talk .reply')].find((x) => x.getBoundingClientRect().top > 200 && x.getBoundingClientRect().bottom < 600 && x.closest('.turn').nextElementSibling);
    const b = r.getBoundingClientRect();
    const next = r.closest('.turn').nextElementSibling?.getBoundingClientRect();
    return { mid: [b.left + 60, b.top + 10], y: b.top + 10, gap: next ? (b.bottom + next.top) / 2 : null };
  });
  await hold(open2.mid, false, "a message's text");
  await hold([6, open2.y], true, 'the left margin');
  await hold([384, open2.y], true, 'the right margin');
  assert.ok(open2.gap, 'a gap under the message');
  await hold([200, open2.gap], true, 'the gap between messages');
  assert.deepEqual(errors, []);
  await context.close();
});

for (const look of [true, false]) {
  test(`for a screen reader: the closed + sheet is inert, the ring says its app, only new replies are said, each turn has its speaker, focus follows the pages (${look ? 'Ink and Lamp' : 'Classic'})`, opts, async () => {
    const { context, page, errors, api } = await open({ look });
    // (a) the + sheet
    assert.equal(await page.$eval('#opts', (o) => o.inert), true, 'the closed sheet is inert');
    await page.click('#plus');
    await until(() => page.$eval('#opts', (o) => !o.inert), { message: 'the open sheet is not' });
    await page.click('#plus');
    await until(() => page.$eval('#opts', (o) => o.inert), { message: 'closed again, inert again' });
    // (b) the ring by keyboard
    await page.focus('[data-skip="apps"]');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#ring.show', { state: 'attached' });
    await page.keyboard.press('ArrowRight');
    await until(async () => { const [say, lbl] = await page.$$eval('#ringsay, #lbl', (e) => e.map((x) => x.textContent)); return say && say === lbl; }, { message: 'the live line says the chosen app' });
    assert.equal(await page.getAttribute('#ringsay', 'aria-live'), 'polite');
    await page.keyboard.press('Escape');
    await until(async () => (await page.textContent('#ringsay')) === '', { message: 'the line clears as the ring closes' });
    // (c) only a new reply is said
    assert.equal(await page.getAttribute('#talk', 'aria-live'), null, 'the conversation is not a live region');
    const said = () => page.$eval('#convo .sr[aria-live="polite"]', (e) => e.textContent);
    assert.equal(await said(), '', 'nothing said at start');
    api.chat.reply('A new reply arrives.');
    await until(async () => (await said()).includes('A new reply arrives.'), { message: 'the new reply is said' });
    // (d) the speakers
    const tree = await page.locator('#talk').ariaSnapshot();
    assert.match(tree, /You\s+Could you plan evening number 1/, 'the owner\'s turn is labelled');
    assert.match(tree, /Thunderhead/, 'the reply is labelled');
    // (e) focus follows the pages
    await page.focus('[data-skip="brief"]');
    await page.keyboard.press('Enter');
    await until(() => page.evaluate(() => document.activeElement?.id === 'bdate'), { message: "the Briefing's heading takes the focus" });
    await page.keyboard.press('Escape');
    await until(() => page.evaluate(() => document.activeElement?.id === 'q'), { message: 'the ask bar takes it back' });
    await page.focus('[data-skip="side"]');
    await page.keyboard.press('Enter');
    await until(() => page.evaluate(() => document.activeElement?.classList.contains('sidetitle')), { message: "the menu's heading takes the focus" });
    await page.keyboard.press('Escape');
    await until(() => page.evaluate(() => document.activeElement?.id === 'q'), { message: 'the ask bar takes it back' });
    assert.equal(await page.getAttribute('#q', 'inputmode'), null, 'by keyboard the bar is a plain field');
    assert.deepEqual(errors, []);
    await context.close();
  });
}

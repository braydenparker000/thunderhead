// Ink and Lamp on home in Chromium at 390×844 against the mocked Worker (frontend/look/home*.js,
// home.css, chat.css, keypad.css): with the look off nothing of it is asked for or drawn; on, in Ink
// and in Lamp, each text has its face (the day in Jacquard, his words in EB Garamond with a Jacquard
// initial, the verse in Lamp Fell, the time in Doto, the bar in Geist Mono, the owner's in Switzer),
// the controls carry the kit's pictures, every tap area is 44 px or more and body text keeps 4.5:1;
// a reply takes the right initial or none; s.d.g. only at rest; the rec switch goes off the record
// and back through th/record; the dial puts a decision off on this phone only, and it comes back when
// its time is up or the look goes; the + keypad has a key for every option.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { API, mockApi, TOKEN } from './fixtures/mock-api.mjs';
import { proposal } from './fixtures/mock-proposals.mjs';
import { outlast } from './fixtures/waits.mjs';

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
const msg = (author, body, extra = {}) => ({ seq: ++n, id: `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`, thread_id: T, author, origin: author === 'owner' ? 'owner_device' : author, kind: 'text', body, meta: null, attachments: [], reply_to: null, created_at: Date.now() - 600_000 + n * 1000, delivered_at: null, acked_at: null, answered_at: Date.now(), ...extra });
const talk = () => [
  msg('owner', 'Could you plan a calm evening for me?'),
  msg('mind', 'Here is a plan: dinner at seven, a short walk, then the quiet playlist, and an early night with the window open.'),
  msg('owner', 'And the books?'),
  msg('mind', 'Done. Both reminders are set.'),
];
const DECISION = () => proposal({ question: 'Forget the old address?', options: ['Forget', 'Keep'], created_by: 'mind:chat' });

/** A signed-in phone on home with the look as given. */
async function open({ theme = 'light', look = true, chat = { messages: talk() }, proposals = [] } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await context.addInitScript(([t, l]) => {
    try {
      if (!localStorage.getItem('th.p.sent')) {
        localStorage.setItem('th.p.sent', '1');
        localStorage.setItem('th-theme', t);
        if (l) localStorage.setItem('th.s.appearance.look', 'ink-lamp');
      }
    } catch {}
  }, [theme, look]);
  const page = await context.newPage();
  const errors = [], asked = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => asked.push(new URL(r.url()).pathname));
  const api = await mockApi(page, { chat, proposals });
  await page.goto(`${base}/no-such-page`);
  await page.evaluate((token) => new Promise((resolve) => { const req = indexedDB.open('th-auth', 1); req.onupgradeneeded = () => req.result.createObjectStore('kv'); req.onsuccess = () => { const tx = req.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put({ session_id: 's1', token, signed_in_at: Date.now(), username: 'example-owner' }, 'session'); tx.oncomplete = () => { req.result.close(); resolve(); }; }; }), TOKEN);
  await page.goto(`${base}/`, { waitUntil: 'load' });
  await page.waitForSelector('html[data-signed-in]');
  if (look) {
    await page.waitForSelector('.lk-head .lk-day:not(:empty)');
    await page.waitForSelector('.lk-front:not(.lk-bare) .lk-fig img');
    if (chat.messages?.length) await page.waitForSelector('#talk .reply.lk-drop');
    await page.evaluate(() => document.fonts.ready);
  }
  return { context, page, errors, asked, api };
}

/** The page's look as read: faces, kit pictures, tap areas, contrast. */
const read = (page) => page.evaluate(() => {
  const $ = (s) => document.querySelector(s);
  const face = (el, pseudo) => getComputedStyle(el, pseudo).fontFamily.split(',')[0].replace(/"/g, '').trim();
  const rgb = (c) => (c.match(/[\d.]+/g) ?? []).slice(0, 4).map(Number);
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => { const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const ground = getComputedStyle(document.body).backgroundColor;
  const reply = $('#talk .reply.lk-drop');
  const you = $('#talk .you');
  const size = (el) => Math.min(el.offsetWidth, el.offsetHeight); // its own box, not mid-rise
  return {
    faces: {
      day: face($('.lk-day')), time: face($('.lk-time')), verse: face($('.lk-vtext')), reply: face(reply), initial: face(reply.firstElementChild, '::first-letter'),
      you: face(you), bar: face($('#q')), legend: face($('.lk-legend')), mark: face($('#talk'), '::after'),
    },
    rubric: [getComputedStyle($('.lk-day')).color, getComputedStyle(reply.firstElementChild, '::first-letter').color, getComputedStyle($('#talk'), '::after').color],
    sdg: getComputedStyle($('#talk'), '::after').content,
    kit: {
      plus: getComputedStyle($('#plus'), '::before').backgroundImage,
      mic: getComputedStyle($('#mic'), '::before').backgroundImage,
      thumb: getComputedStyle($('.lk-thumb'), '::before').backgroundImage,
      yes: getComputedStyle($('#decision .decide .yes'), '::before').borderImageSource,
      no: getComputedStyle($('#decision .decide button:not(.yes)'), '::before').borderImageSource,
      dial: getComputedStyle($('.lk-later-b .lk-dial'), '::before').backgroundImage,
    },
    taps: Object.fromEntries([['plus', '#plus'], ['mic', '#mic'], ['rec', '.lk-rec'], ['yes', '#decision .yes'], ['no', '#decision .decide button:not(.yes)'], ['later', '.lk-later-b']].map(([k, s]) => [k, size($(s))])),
    contrast: {
      reply: ratio(getComputedStyle(reply).color, ground),
      you: ratio(getComputedStyle(you).color, getComputedStyle(you).backgroundColor),
      verse: ratio(getComputedStyle($('.lk-vtext')).color, ground),
      legend: ratio(getComputedStyle($('.lk-legend')).color, ground),
      question: ratio(getComputedStyle($('#decision .q')).color, getComputedStyle($('#decision .card')).backgroundColor),
      bar: ratio(getComputedStyle($('#q'), '::placeholder').color, ground),
    },
  };
});

test('with the look off, nothing of home\'s part of it is asked for or drawn', opts, async () => {
  const { context, page, errors, asked } = await open({ look: false, proposals: [DECISION()] });
  await page.waitForSelector('#decision .card');
  await outlast(page, 600); // a negative read: past the first paint, when the look's modules would load
  assert.deepEqual(asked.filter((p) => p.startsWith('/look/')), []);
  assert.equal(await page.$('.lk-head, .lk-front, .lk-later-b, .lk-drop, .lk-raise'), null);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#talk'), '::after').content), 'none');
  assert.deepEqual(errors, []);
  await context.close();
});

for (const theme of ['light', 'dark'])
  test(`on, in ${theme === 'light' ? 'Ink' : 'Lamp'}: the faces, the kit's pictures, 44 px taps and 4.5:1`, opts, async () => {
    const { context, page, errors, asked } = await open({ theme, proposals: [DECISION()] });
    await page.waitForSelector('#decision .card.armed .lk-later-b');
    const look = await read(page);
    assert.deepEqual(look.faces, { day: 'Jacquard 24', time: 'Doto', verse: 'Lamp Fell', reply: 'EB Garamond', initial: 'Jacquard 24', you: 'Switzer', bar: 'Geist Mono', legend: 'Geist Mono', mark: 'Geist Mono' });
    const rubric = theme === 'light' ? 'rgb(179, 18, 26)' : 'rgb(240, 69, 63)';
    // (Sunday's gold, data-day="sunday", is the foundation's own check.)
    if (!(await page.evaluate(() => document.documentElement.dataset.day === 'sunday'))) assert.deepEqual(look.rubric, [rubric, rubric, rubric]);
    assert.equal(look.sdg, '"s.d.g." / ""');
    const pic = (s, name) => assert.match(s, new RegExp(`/look/[0-9a-f]+/kit/${name}\\.webp`), name);
    pic(look.kit.plus, theme === 'light' ? 'round-light-up' : 'round-nearblack-up');
    pic(look.kit.mic, theme === 'light' ? 'round-black-up' : 'round-light-up');
    pic(look.kit.thumb, theme === 'light' ? 'thumb-small-light' : 'thumb-small-grey');
    pic(look.kit.yes, 'key-orange-up');
    pic(look.kit.no, theme === 'light' ? 'key-light-up' : 'key-dark-up');
    pic(look.kit.dial, theme === 'light' ? 'dial-grey-small' : 'dial-dark-small');
    for (const [k, px] of Object.entries(look.taps)) assert.ok(px >= 44, `${k}: ${px} px`);
    for (const [k, r] of Object.entries(look.contrast)) assert.ok(r >= 4.5, `${k}: ${r.toFixed(2)}:1`);
    // The day's plate and its pictures came, and every kit picture asked for was there.
    assert.ok(asked.some((p) => p.startsWith(`/look/pictures/${theme === 'light' ? 'ink' : 'lamp'}/`)), 'the day\'s plate');
    assert.deepEqual(errors, []);
    await context.close();
  });

test('a reply opens with a drop, a raised initial or none, as it begins', opts, async () => {
  const kinds = [
    ['- a list first\n- then more', ''], ['### A heading\nThen words.', ''], ['> A quotation first.\n\nThen words.', ''],
    ['```\ncode first\n```', ''], ['| a | b |\n| --- | --- |\n| 1 | 2 |', ''], ['42 is the answer.', ''], ['🙂 Glad to help.', ''],
    ['https://example.com is open today.', ''], ['`npm test` passes now.', ''], ['¿Qué tal? Bien.', 'lk-raise'], ['“Yes,” you said.', 'lk-raise'],
    ['**Bold** words open this one.', 'lk-raise'], ['Done.', 'lk-raise'],
    ['A long reply that runs on well past the end of one line on a phone, so its letter drops two lines.', 'lk-drop'],
    ['One line first:\n- then a list\n- of two', 'lk-raise'], ['Supercalifragilisticexpialidociousandthensomemoreletterswithoutanyend.', 'lk-drop'],
  ];
  const messages = kinds.flatMap(([body]) => [msg('owner', 'and?'), msg('mind', body)]);
  const { context, page, errors } = await open({ chat: { messages } });
  const got = await page.$$eval('#talk .reply', (rs) => rs.map((r) => (r.classList.contains('lk-drop') ? 'lk-drop' : r.classList.contains('lk-raise') ? 'lk-raise' : '')));
  assert.deepEqual(got, kinds.map(([, k]) => k));
  // Nothing runs off the page sideways, the longest word included.
  assert.ok(await page.$eval('#convo', (c) => c.scrollWidth <= c.clientWidth), 'no sideways scroll');
  assert.deepEqual(errors, []);
  await context.close();
});

test('s.d.g. only at rest; the rec switch goes off the record and back through th/record', opts, async () => {
  const { context, page, errors, api } = await open({ chat: { messages: talk(), reply: { after: 600, text: 'Done. None of this is kept.' } } });
  const mark = () => page.evaluate(() => getComputedStyle(document.querySelector('#talk'), '::after').content);
  assert.equal(await mark(), '"s.d.g." / ""');
  await page.click('.lk-rec');
  await page.waitForSelector('.lk-rec[aria-checked="false"]');
  assert.ok(api.calls.some((c) => /^PUT \/v1\/threads\/[^/]+\/off-record$/.test(c.call)), 'started through th/record');
  assert.equal(await page.textContent('.lk-rec-l'), 'off the\nrecord');
  assert.equal(await page.getAttribute('#q', 'placeholder'), 'Ask, off the record');
  // Awaiting his answer: no mark; answered: the line that says nothing is kept.
  await page.fill('#q', 'Remind me about the library books.');
  await page.press('#q', 'Enter');
  await page.waitForSelector('#talk .turn:last-child > .mine:last-child');
  assert.equal(await mark(), 'none');
  await page.waitForSelector('#talk .reply');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#talk'), '::after').content.includes('nothing from here is kept'));
  await page.click('.lk-rec');
  await page.waitForSelector('.lk-rec[aria-checked="true"]');
  assert.equal(await page.getAttribute('#q', 'placeholder'), 'Ask anything');
  assert.equal(await page.evaluate(() => localStorage.getItem('th.p.otr')), null);
  assert.deepEqual(errors, []);
  await context.close();
});

test('the dial puts a decision off on this phone only; it comes back when its time is up, or the look goes', opts, async () => {
  const p = DECISION();
  const { context, page, errors, api } = await open({ proposals: [p] });
  await page.waitForSelector('#decision .card.armed .lk-later-b');
  assert.equal(await page.getAttribute('.lk-later-b', 'aria-label'), 'Decide later, in one hour');
  // Its keys turn it (as a drag does): 3 h, then back to 1 h.
  await page.focus('.lk-later-b');
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.getAttribute('.lk-later-b', 'aria-label'), 'Decide later, in three hours');
  await page.keyboard.press('ArrowLeft');
  await page.click('.lk-later-b');
  await page.waitForSelector('#decision.lk-later', { state: 'attached' });
  assert.equal(await page.isVisible('#decision .card'), false);
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('th.p.later')));
  assert.deepEqual(Object.keys(kept), [p.id]);
  assert.ok(Math.abs(kept[p.id] - (Date.now() + 3_600_000)) < 60_000, 'an hour from now');
  assert.ok(!api.calls.some((c) => c.call.includes('/decide')), 'nothing is sent');
  // The time is up: it comes back by itself.
  await page.evaluate((id) => { localStorage.setItem('th.p.later', JSON.stringify({ [id]: Date.now() + 300 })); document.dispatchEvent(new Event('visibilitychange')); }, p.id);
  await page.waitForSelector('#decision:not(.lk-later) .card', { state: 'visible' });
  // Put off again, then the look goes: back at once, the dial gone with it.
  await page.click('.lk-later-b');
  await page.waitForSelector('#decision.lk-later', { state: 'attached' });
  await page.evaluate(() => document.documentElement.removeAttribute('data-look'));
  await page.waitForSelector('#decision .card', { state: 'visible' });
  assert.equal(await page.$('.lk-later-b, .lk-head, .lk-front'), null);
  assert.deepEqual(errors, []);
  await context.close();
});

test('the + keypad: a kit key for every option, the + key pressed and orange while open', opts, async () => {
  const { context, page, errors } = await open({ theme: 'dark' });
  const options = await page.$$eval('#opts button', (b) => b.length);
  await page.click('#plus');
  await page.waitForSelector('#opts.show');
  assert.equal(await page.getAttribute('#plus', 'aria-expanded'), 'true');
  assert.match(await page.$eval('#plus', (b) => getComputedStyle(b, '::before').backgroundImage), /kit\/round-orange-pressed\.webp/);
  const keys = await page.$$eval('#opts button', (bs) => bs.map((b) => ({ pic: getComputedStyle(b.querySelector('.oi'), '::before').borderImageSource, h: b.getBoundingClientRect().height, w: b.getBoundingClientRect().width, face: getComputedStyle(b).fontFamily })));
  assert.equal(keys.length, options);
  for (const k of keys) {
    assert.match(k.pic, /kit\/key-dark-up\.webp/);
    assert.ok(k.h >= 44 && k.w >= 44, `${k.w}×${k.h}`);
    assert.match(k.face, /Geist Mono/);
  }
  assert.deepEqual(errors, []);
  await context.close();
});

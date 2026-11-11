// The owner's second batch of settings does what each one says (shared/contract/settings-phone.ts,
// MENU-AND-SETTINGS.md §6; ui/prefs.css, apps/home/prefs.js, home.js, ui/launch.js, th/motion.js,
// th/pref.js). Each case stores the setting the way Settings does (`th.s.<key>`), opens home and
// reads the thing it should have changed; the same read at the default proves the default too.
// Home is signed out here (no API address), as in tests/home-browser.test.mjs. The chat's own
// settings are in tests/chat-browser.test.mjs, the island's in tests/island-browser.test.mjs,
// dictation's in tests/attach-browser.test.mjs and What's new in tests/news-browser.test.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { SETTINGS } from '../shared/contract/settings.ts';
import { afterFirstPaint } from './fixtures/waits.mjs';

let server, browser, base;
before(async () => {
  server = await serve(0);
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => { await browser?.close(); server?.close(); });

/** Home with these settings stored, as Settings stores them. */
async function home(prefs = {}, { clock = false, touch = false } = {}) {
  for (const key of Object.keys(prefs)) assert.ok(SETTINGS.some((s) => s.key === key && s.scope === 'phone'), `${key} is a phone setting`);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', hasTouch: touch });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript((p) => {
    for (const [k, v] of Object.entries(p)) localStorage.setItem(`th.s.${k}`, String(v));
    window.buzzes = [];
    navigator.vibrate = (pattern) => { window.buzzes.push([pattern].flat()[0]); return true; };
  }, prefs);
  await page.route('**/config.js', (route) => route.fulfill({ contentType: 'text/javascript', body: "export const CONFIG = { api: '', build: 0, commit: 'dev', repo_url: '' };" }));
  if (clock) await page.clock.install();
  await page.goto(`${base}/`, { waitUntil: 'load' });
  if (!clock) await afterFirstPaint(page);
  return { page, errors, close: () => context.close() };
}
const css = (page, selector, prop, pseudo = null) => page.evaluate(([s, p, ps]) => getComputedStyle(document.querySelector(s), ps)[p], [selector, prop, pseudo]);

// What a drawing setting changes: [setting, stored value, selector, property, pseudo, at the default, with the setting].
const DRAWN = [
  ['appearance.field', 'plain', '.app > .field', 'display', '::before', 'block', 'none'],
  ['appearance.grain', false, '.app > .grain', 'display', null, 'block', 'none'],
  ['appearance.idle_glow', false, '#edge', 'opacity', '::after', '0.6', '0'],
  ['appearance.ring_label', false, '#lbl', 'display', null, 'block', 'none'],
  ['appearance.press', false, '#press', 'display', null, 'block', 'none'],
  ['appearance.toast', 'top', '#toast', 'top', null, /^[4-9]\d\d(\.\d+)?px$/, '52px'],
  ['appearance.brief_greeting', false, '.brief .btitle', 'display', null, 'block', 'none'],
  ['appearance.brief_tiles', 'compact', '.brief .tile', 'paddingTop', null, '16px', '10px'],
  ['chat.hint', false, '#hint', 'display', null, 'flex', 'none'],
  ['chat.date', 'off', '#date', 'visibility', null, 'visible', 'hidden'],
];

test('each drawing setting changes what it names, and at its default leaves it as it was', async () => {
  const plain = await home();
  for (const [key, , selector, prop, pseudo, was] of DRAWN) {
    const got = await css(plain.page, selector, prop, pseudo);
    if (was instanceof RegExp) assert.match(got, was, `${key} at its default`);
    else assert.equal(got, was, `${key} at its default`);
  }
  assert.deepEqual(plain.errors, []);
  await plain.close();
  const set = await home(Object.fromEntries(DRAWN.map(([key, value]) => [key, value])));
  for (const [key, , selector, prop, pseudo, , now] of DRAWN) assert.equal(await css(set.page, selector, prop, pseudo), now, key);
  assert.deepEqual(set.errors, []);
  await set.close();
});

test('the menu width, the dim behind the ring, the status chip, and what the chat and the island draw', async () => {
  const widths = {};
  for (const w of ['regular', 'narrow', 'full']) {
    const { page, close } = await home(w === 'regular' ? {} : { 'appearance.menu_width': w });
    widths[w] = await page.$eval('#side', (e) => e.offsetWidth);
    await close();
  }
  assert.deepEqual(widths, { regular: 390 - 52, narrow: 300, full: 390 });

  const { page, close } = await home({ 'appearance.ring_dim': 'light', 'appearance.status': false, 'chat.time_markers': false, 'chat.followups': 'none', 'chat.code_wrap': true,
    'island.art': false, 'island.bars': false, 'island.progress': false });
  await page.evaluate(() => {
    document.querySelector('#scrim').classList.add('show');
    document.querySelector('#status').hidden = false;
    document.querySelector('#turns').innerHTML = '<div class="turn" data-time="10:00"><pre>x</pre><div class="follows now in" id="f1"></div><div class="follows choices now in" id="f2"></div></div>';
    const island = document.createElement('div');
    island.className = 'th-island';
    island.innerHTML = '<span class="bars"></span><div class="progress"></div><span class="art has-art"><canvas></canvas></span>';
    document.body.append(island);
  });
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#scrim')).opacity === '0.5', null, { timeout: 5000 }); // light dims half as much, once its fade is done
  assert.equal(await css(page, '#status', 'display'), 'none');
  assert.equal(await css(page, '#turns .turn', 'display', '::before'), 'none', 'no time over a turn');
  assert.equal(await css(page, '#f1', 'display'), 'none', 'no follow-up suggestions');
  assert.notEqual(await css(page, '#f2', 'display'), 'none', 'a choice the reply asks for still shows');
  assert.equal(await css(page, '#turns pre', 'whiteSpace'), 'pre-wrap');
  assert.deepEqual([await css(page, '.th-island .bars', 'display'), await css(page, '.th-island .progress', 'display'), await css(page, '.th-island .art canvas', 'opacity')], ['none', 'none', '0']);
  await close();
  const deep = await home({ 'appearance.ring_dim': 'deep' });
  const regular = await home();
  assert.notEqual(await css(deep.page, '#scrim', 'backgroundColor'), await css(regular.page, '#scrim', 'backgroundColor'), 'deep is darker');
  await deep.close(); await regular.close();
});

test('the ask bar: its words, spelling, capitals, the keyboard on open, the draft and Enter', async () => {
  const plain = await home();
  const bar = (page) => page.$eval('#q', (q) => ({ words: q.placeholder, spell: q.spellcheck, caps: q.getAttribute('autocapitalize'), focused: document.activeElement === q }));
  assert.deepEqual(await bar(plain.page), { words: 'Ask anything', spell: true, caps: 'sentences', focused: false });
  const enter = (page) => page.$eval('#q', (q) => { q.value = 'a line'; q.dispatchEvent(new Event('input')); return !q.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertLineBreak', cancelable: true })); });
  assert.equal(await enter(plain.page), true, 'Enter sends');
  await plain.page.$eval('#q', (q) => { q.value = 'half a thought'; q.dispatchEvent(new Event('input')); });
  assert.equal(await plain.page.evaluate(() => localStorage.getItem('th.p.draft')), 'half a thought');
  await plain.close();

  const set = await home({ 'chat.placeholder': 'Say it', 'chat.spellcheck': false, 'chat.autocap': 'off', 'chat.autofocus': true, 'chat.draft': false, 'chat.enter_sends': false });
  await set.page.waitForFunction(() => document.activeElement?.id === 'q');
  assert.deepEqual(await bar(set.page), { words: 'Say it', spell: false, caps: 'off', focused: true });
  assert.equal(await enter(set.page), false, 'Enter starts a new line');
  assert.equal(await set.page.evaluate(() => localStorage.getItem('th.p.draft')), null, 'no draft is kept');
  // A change in Settings arrives without a reload.
  await set.page.evaluate(() => { localStorage.setItem('th.s.chat.placeholder', 'Go on'); document.dispatchEvent(new CustomEvent('th:setting', { detail: { key: 'chat.placeholder' } })); });
  assert.equal((await bar(set.page)).words, 'Go on');
  assert.deepEqual(set.errors, []);
  await set.close();
});

test('the date long, the 12-hour clock, the springs, and how an app opens', async () => {
  const { page, close } = await home({ 'chat.date': 'long', 'appearance.clock': '12', 'appearance.feel': 'calm', 'appearance.launch': 'fade', 'appearance.launch_ms': 420 });
  const long = await page.evaluate(() => new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }));
  assert.equal(await page.textContent('#date'), long);
  assert.deepEqual(await page.evaluate(async () => { const { clock } = await import('/th/pref.js'); return [clock(new Date(2026, 0, 5, 14, 5).getTime()), clock(new Date(2026, 0, 5, 0, 30).getTime())]; }), ['2:05 pm', '12:30 am']);
  assert.deepEqual(await page.evaluate(async () => { const { springs } = await import('/th/motion.js'); return [springs.page.damping, Math.round(springs.page.stiffness)]; }), [1, 272], 'calm: no bounce, a little slower');
  const cover = await page.evaluate(async () => {
    const { launch } = await import('/ui/launch.js');
    launch('#123456');
    const a = document.querySelector('.launch').getAnimations()[0];
    return { ms: a.effect.getTiming().duration, keys: Object.keys(a.effect.getKeyframes()[0]) };
  });
  assert.equal(cover.ms, 420);
  assert.ok(cover.keys.includes('opacity') && !cover.keys.includes('clipPath'), 'a fade, not the circle');
  await close();

  const plain = await home();
  assert.deepEqual(await plain.page.evaluate(async () => { const { clock } = await import('/th/pref.js'); const { springs } = await import('/th/motion.js'); return [clock(new Date(2026, 0, 5, 14, 5).getTime()), springs.page.damping]; }), ['14:05', 0.86]);
  await plain.close();
  const none = await home({ 'appearance.launch': 'none', 'appearance.feel': 'lively' });
  assert.equal(await none.page.evaluate(async () => { const { launch } = await import('/ui/launch.js'); await launch('#123456'); return document.querySelectorAll('.launch').length; }), 0, 'no cover at all');
  assert.equal(await none.page.evaluate(async () => (await import('/th/motion.js')).springs.page.damping), 0.76);
  await none.close();
});

test('a short notice stays as long as the owner set', async () => {
  for (const [prefs, ms] of [[{}, 2000], [{ 'appearance.toast_ms': 5 }, 5000]]) {
    const { page, close } = await home(prefs, { clock: true });
    await page.clock.runFor(1000);
    await page.evaluate(() => document.querySelector('[data-toast]').click());
    assert.ok(await page.$eval('#toast', (t) => t.classList.contains('show')));
    await page.clock.runFor(ms - 200);
    assert.ok(await page.$eval('#toast', (t) => t.classList.contains('show')), `still there at ${ms - 200} ms`);
    await page.clock.runFor(400);
    assert.equal(await page.$eval('#toast', (t) => t.classList.contains('show')), false, `gone by ${ms + 200} ms`);
    await close();
  }
});

const point = (page, type, x, y, target = 'window') => page.evaluate(([type, x, y, target]) => (target === 'window' ? window : document.querySelector(target))
  .dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, isPrimary: true, pointerId: 5, clientX: x, clientY: y })), [type, x, y, target]);
const view = (page) => page.evaluate(() => (document.querySelector('#brief').hasAttribute('inert') ? (document.querySelector('#side').classList.contains('open') ? 'side' : 'home') : 'brief'));

test('gestures: how far a swipe goes to turn, the edge left to the phone, a hold that may drift, ticks in the ring', async () => {
  // A slow swipe of 34% of the width turns the page at 28% and not at 40%.
  const slow = async (page, x0, dx) => {
    await point(page, 'pointerdown', x0, 400, '#convo');
    for (let i = 1; i <= 6; i++) await point(page, 'pointermove', x0 + (dx * i) / 6, 400);
    await page.waitForTimeout(140); // rest before lifting: a turn by distance, not by a flick
    await point(page, 'pointerup', x0 + dx, 400);
    await page.evaluate(async () => (await import('/th/motion.js')).whenResting());
  };
  const plain = await home();
  await slow(plain.page, 60, 133);
  assert.equal(await view(plain.page), 'brief', '34% turns at the default 28%');
  await plain.close();
  const far = await home({ 'gestures.swipe_commit': 40 });
  await slow(far.page, 60, 133);
  assert.equal(await view(far.page), 'home', '34% does not turn at 40%');
  await far.close();

  // A drag that starts at the screen's side is the phone's own; with the guard off it is a swipe.
  const guarded = await home();
  await slow(guarded.page, 8, 200);
  assert.equal(await view(guarded.page), 'home', 'the edge is left to the phone');
  await guarded.close();
  const open = await home({ 'gestures.edge_guard': false });
  await slow(open.page, 8, 200);
  assert.equal(await view(open.page), 'brief');
  await open.close();

  // A hold that drifts 16 px is dropped at 10 px of steadiness and kept at 28.
  const ring = async (prefs) => {
    const { page, close } = await home(prefs);
    await point(page, 'pointerdown', 195, 420, '#convo');
    await point(page, 'pointermove', 195, 436);
    await page.waitForTimeout(500);
    const shown = await page.$eval('#ring', (r) => r.classList.contains('show'));
    // Across two apps: each new one ticks (4 ms) unless the owner turned the ticks off.
    if (shown) for (const [x, y] of [[195, 350], [265, 420], [195, 490]]) await point(page, 'pointermove', x, y);
    const ticks = await page.evaluate(() => window.buzzes.filter((b) => b === 4).length);
    await point(page, 'pointercancel', 195, 420);
    await close();
    return { shown, ticks };
  };
  assert.equal((await ring({})).shown, false, 'dropped at the default');
  const steady = await ring({ 'gestures.hold_slop': 28 });
  assert.equal(steady.shown, true, 'kept with more room');
  assert.ok(steady.ticks >= 2, `ticks between apps: ${steady.ticks}`);
  assert.equal((await ring({ 'gestures.hold_slop': 28, 'gestures.ring_ticks': false })).ticks, 0, 'no ticks');
});

test('pull to find shows its hint only while the owner keeps it on', async () => {
  const pulled = async (prefs) => {
    const { page, close } = await home(prefs, { touch: true });
    const k = await page.evaluate(() => {
      const convo = document.querySelector('#convo');
      const touch = (y) => new Touch({ identifier: 1, target: convo, clientX: 195, clientY: y });
      convo.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [touch(200)] }));
      convo.dispatchEvent(new TouchEvent('touchmove', { bubbles: true, touches: [touch(240)] }));
      return Number(document.querySelector('.pullfind').style.opacity || 0);
    });
    await close();
    return k;
  };
  assert.ok((await pulled({})) > 0.5, 'the hint follows the pull');
  assert.equal(await pulled({ 'gestures.pull_find': false }), 0);
});

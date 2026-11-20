// Ink and Lamp on the island and the ring (frontend/look/island.*, ring.*), in Chromium at 390×844
// against a mock Worker: Music shrinks into the capsule, which wears two reels and a five-dot meter;
// expanded, the card has the lamp and the app's name, the deck, the times in Doto and the kit's keys
// (the main one orange), each at least 44 px; the ring's keys wear their woodcut emblems, the chosen
// one the orange key, its name in EB Garamond, and the hand (Ink) or the light (Lamp) turns to it and
// goes when it is let go; legible in both themes. With the look off none of it is asked for or drawn,
// and turned off at once it all goes. Local only; no network.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (mocked API)', timeout: 120_000 };
const TOKEN = `th1_${'C'.repeat(43)}abcdef`;
let site, mock, browser, base;

before(async () => {
  if (live) return;
  mock = createServer((req, res) => {
    const cors = { 'Access-Control-Allow-Origin': req.headers.origin ?? '*', Vary: 'Origin' };
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...cors, 'Access-Control-Allow-Methods': 'GET, POST, PUT', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-None-Match, TH-Client' });
      return res.end();
    }
    const answers = {
      '/v1/music/catalog': { version: 1, kind: 'r2-library', complete: true, count: 0, generatedAt: '2026-11-01T00:00:00.000Z', tracks: [] },
      '/v1/auth/me': { session_id: 's1', notices: [], recovery_confirmed: true },
      '/v1/threads/today': { thread: null, messages: [], seq: 1, day: new Date().toISOString().slice(0, 10) },
      '/v1/settings': { 'owner.tz': 'UTC', 'mind.status': { state: 'asleep', note: null, since: null } },
      '/v1/surfaces': { items: [], seq: 1 }, '/v1/verbs/pending': { items: [] }, '/v1/proposals': { items: [] },
      '/v1/changes': { items: [], next_after: 1, more: false }, '/v1/podcasts/progress': { items: [] },
    };
    const path = new URL(req.url, 'http://x').pathname;
    res.writeHead(path in answers ? 200 : 404, { ...cors, 'Content-Type': 'application/json' });
    res.end(JSON.stringify(answers[path] ?? { error: { code: 'not_found', message: 'no', request_id: 't' } }));
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  site = await serve(0, { api: `http://127.0.0.1:${mock.address().port}` });
  base = `http://127.0.0.1:${site.address().port}`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => { await browser?.close(); site?.close(); mock?.close(); });

/** Home signed in, in `theme`, with the look or not; every path asked for is kept. */
async function phone(theme, look) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'allow' });
  await context.addInitScript(([t, l]) => {
    Object.defineProperty(navigator, 'connection', { value: { saveData: true }, configurable: true });
    try { if (!localStorage.getItem('th.p.sent')) { localStorage.setItem('th.p.sent', '1'); localStorage.setItem('th-theme', t); if (l) localStorage.setItem('th.s.appearance.look', l); } } catch {}
  }, [theme, look]);
  const page = await context.newPage();
  const errors = [], asked = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => asked.push(new URL(r.url()).pathname));
  await page.goto(`${base}/no-such-page`);
  await page.evaluate((token) => new Promise((resolve) => { const req = indexedDB.open('th-auth', 1); req.onupgradeneeded = () => req.result.createObjectStore('kv'); req.onsuccess = () => { const tx = req.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put({ session_id: 's1', token, signed_in_at: Date.now(), username: 'example-owner' }, 'session'); tx.oncomplete = () => { req.result.close(); resolve(); }; }; }), TOKEN);
  await page.goto(`${base}/`, { waitUntil: 'load' });
  await page.waitForSelector('html[data-signed-in]');
  if (look) await page.waitForSelector('html[data-look-ready]');
  return { context, page, errors, asked };
}

const settle = (page) => page.evaluate(() => import('/th/island/island.js').then((m) => m.whenResting()));
/** Music opened and shrunk into the island, an invented song playing at 0:07 of 0:59. */
async function island(page) {
  await page.evaluate(() => new Promise((resolve) => { document.addEventListener('th:app-ready', resolve, { once: true }); import('/th/island/island.js').then((m) => m.openApp('music')); }));
  await settle(page);
  await page.evaluate(() => import('/th/island/island.js').then((m) => m.collapse('test')));
  await settle(page);
  await page.evaluate(() => {
    const p = document.querySelector('iframe[data-app=music]').contentWindow.__cp.player, a = p.audio;
    p.queue = [{ id: 'one', title: 'An invented tone', artist: 'An invented band' }]; p.index = 0;
    Object.defineProperty(a, 'paused', { get: () => false, configurable: true });
    Object.defineProperty(a, 'duration', { value: 59, configurable: true });
    Object.defineProperty(a, 'currentTime', { value: 7, configurable: true, writable: true });
  });
  await page.waitForSelector('.th-island.playing');
  await page.waitForFunction(() => document.querySelector('.th-island .title').textContent === 'An invented tone');
  await settle(page);
}
/** The ring held open at the screen's middle, Music (straight up) chosen. */
async function ring(page) {
  await page.mouse.move(195, 520); await page.mouse.down();
  await page.waitForFunction(() => document.querySelector('#ring').classList.contains('show'));
  await page.waitForFunction(() => !document.querySelector('#ring').classList.contains('moving'));
  await page.mouse.move(195, 450, { steps: 6 });
  await page.waitForFunction(() => document.querySelector('#ring').classList.contains('glassy') && !document.querySelector('#ring').classList.contains('moving'));
  await page.evaluate(async () => (await import('/th/motion.js')).whenResting());
}
/** WCAG contrast of two CSS colours (opaque, or the second the ground). */
const contrast = (a, b) => {
  const lum = (c) => { const [r, g, bl] = c.match(/[\d.]+/g).slice(0, 3).map(Number).map((v) => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * r + .7152 * g + .0722 * bl; };
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + .05) / (y + .05);
};

for (const [theme, ground, panel] of [['light', 'rgb(214, 214, 210)', 'rgb(45, 45, 44)'], ['dark', 'rgb(0, 0, 0)', 'rgb(14, 13, 12)']])
  test(`the island and the ring wear Ink and Lamp (${theme === 'light' ? 'Ink' : 'Lamp'})`, opts, async () => {
    const { context, page, errors } = await phone(theme, 'ink-lamp');
    try {
      await island(page);
      // The capsule: reels in place of the artwork's dot, a five-dot meter in place of the bars.
      const capsule = await page.evaluate(() => {
        const is = document.querySelector('.th-island'), css = (s, p, pe) => getComputedStyle(is.querySelector(s), pe)[p];
        return { reels: is.querySelectorAll('.compact .lk-i-reels i').length, dots: is.querySelectorAll('.compact .lk-i-meter i').length,
          bars: css('.bars', 'display'), art: css('.art', 'opacity'), title: css('.title', 'fontFamily'), turning: is.querySelector('.lk-i-reels i').getAnimations().length > 0 };
      });
      assert.deepEqual(capsule, { reels: 2, dots: 5, bars: 'none', art: '0', title: capsule.title, turning: true });
      assert.match(capsule.title, /^"?Switzer/);
      // Expanded: the card.
      await page.evaluate(() => import('/th/island/island.js').then((m) => m.wide(true)));
      await settle(page);
      const card = await page.evaluate(() => {
        const is = document.querySelector('.th-island'), q = (s) => is.querySelector(s), cs = (s, pe) => getComputedStyle(q(s), pe);
        const keys = [...is.querySelectorAll('.controls button')].map((b) => { const r = b.getBoundingClientRect(); return { w: r.width, h: r.height, pic: getComputedStyle(b, '::before').borderImageSource }; });
        const zz = q('.zz').getBoundingClientRect();
        return { app: q('.lk-i-app').textContent, deck: cs('.lk-i-deck').backgroundImage, time: cs('.elapsed').fontFamily, keys, zz: zz.height,
          tt: cs('.tt').color, by: cs('.by').color, legend: cs('.lk-i-head').fontFamily };
      });
      assert.equal(card.app, 'music');
      assert.match(card.deck, /art\/deck\.svg/);
      assert.match(card.time, /^"?Doto/);
      assert.match(card.legend, /^"?Geist Mono/);
      assert.deepEqual(card.keys.map((k) => /key-(orange|nearblack)-up\.webp/.exec(k.pic)?.[1]), ['nearblack', 'orange', 'nearblack'], 'the kit\'s keys, the main one orange');
      for (const k of [...card.keys, { w: 44, h: card.zz }]) assert.ok(k.w >= 44 && k.h >= 44, `a tap area of 44 px: ${JSON.stringify(k)}`);
      for (const c of [card.tt, card.by]) assert.ok(contrast(c, panel) >= 4.5, `${c} on the card reads (${contrast(c, panel).toFixed(2)}:1)`);
      await page.evaluate(() => import('/th/island/island.js').then((m) => m.wide(false)));
      await settle(page);

      // The ring: emblems on the kit's keys, the chosen one orange, the name, the hand or the light.
      await ring(page);
      const held = await page.evaluate(() => {
        const ring = document.querySelector('#ring'), on = ring.querySelector('.pet.on'), aim = ring.querySelector('.lk-r-aim');
        const shown = (s) => getComputedStyle(ring.querySelector(s)).display !== 'none';
        const lbl = ring.querySelector('#lbl'), r = on.getBoundingClientRect();
        return { emblems: [...ring.querySelectorAll('.pet .face .lk-r-em use')].map((u) => u.getAttribute('href').split('#')[1]),
          key: getComputedStyle(ring.querySelector('.pet .face'), '::before').backgroundImage, chosen: getComputedStyle(on.querySelector('.fill')).backgroundImage,
          name: lbl.textContent, font: getComputedStyle(lbl).fontFamily, color: getComputedStyle(lbl).color, after: getComputedStyle(lbl, '::after').content,
          aim: aim.classList.contains('on'), turn: aim.style.transform, hand: shown('.lk-r-hand'), beam: shown('.lk-r-beam'), size: [r.width, r.height] };
      });
      assert.deepEqual(held.emblems.slice().sort(), ['em-book', 'em-chest', 'em-harp', 'em-lute', 'em-picture', 'em-star', 'em-trumpet']);
      assert.match(held.key, theme === 'light' ? /round-light-up\.webp/ : /round-nearblack-up\.webp/);
      assert.match(held.chosen, /round-orange-up\.webp/);
      assert.equal(held.name, 'Music');
      assert.match(held.font, /^"?EB Garamond/);
      assert.equal(held.after, '"release to open"');
      assert.ok(contrast(held.color, ground) >= 4.5, 'the name reads');
      assert.ok(held.size[0] >= 44 && held.size[1] >= 44, 'the chosen key is at least 44 px');
      assert.deepEqual([held.aim, held.turn], [true, 'rotate(0deg)'], 'it points straight up, at Music');
      assert.deepEqual([held.hand, held.beam], theme === 'light' ? [true, false] : [false, true], 'the hand by day, the light by night');
      await page.mouse.move(195 + 60, 520 + 35, { steps: 6 });
      await page.evaluate(async () => (await import('/th/motion.js')).whenResting());
      const turned = await page.evaluate(() => { const pets = [...document.querySelectorAll('#ring .pet')]; return { i: pets.findIndex((p) => p.classList.contains('on')), n: pets.length, turn: document.querySelector('.lk-r-aim').style.transform }; });
      assert.ok(turned.i > 0 && Math.abs(Number(/rotate\(([-\d.e]+)deg\)/.exec(turned.turn)[1]) - turned.i * 360 / turned.n) < .01, `it turns to the new choice: ${JSON.stringify(turned)}`);
      // Let go (Podcasts opens inside home): the hand or the light goes with the ring.
      await page.mouse.up();
      await page.waitForFunction(() => !document.querySelector('.lk-r-aim').classList.contains('on'));
      // Turned off, all of it goes at once.
      await page.evaluate(() => document.documentElement.removeAttribute('data-look'));
      await page.waitForFunction(() => !document.querySelector('[class^="lk-i-"],[class^="lk-r-"]'));
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });

test('with the look off the island and the ring ask for and draw nothing of it', opts, async () => {
  const { context, page, errors, asked } = await phone('light', '');
  try {
    await island(page);
    await page.evaluate(() => import('/th/island/island.js').then((m) => m.wide(true)));
    await settle(page);
    await ring(page);
    await page.mouse.up();
    assert.deepEqual(asked.filter((p) => p.startsWith('/look/')), []);
    assert.equal(await page.evaluate(() => document.querySelectorAll('[class^="lk-"]').length), 0);
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.th-island .art')).opacity), '1');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

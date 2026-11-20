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
import { API, mockApi, TOKEN as KEY } from './fixtures/mock-api.mjs';

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
async function phone(theme, look, reducedMotion = 'no-preference') {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'allow', reducedMotion });
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
    await island(page); await page.evaluate(() => import('/th/island/island.js').then((m) => m.wide(true)));
    await settle(page);
    await ring(page);
    assert.deepEqual(asked.filter((p) => p.startsWith('/look/')), []);
    assert.equal(await page.evaluate(() => document.querySelectorAll('[class^="lk-"]').length), 0);
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.th-island .art')).opacity), '1');
    await page.mouse.up(); // (last: letting go opens the chosen app, and the island's own morph fades its artwork)
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('the hand turns the short way round, and under Reduced it and the reels are still', opts, async () => {
  const { context, page, errors } = await phone('light', 'ink-lamp');
  try {
    await island(page);
    const reels = () => page.evaluate(() => [...document.querySelectorAll('.th-island .lk-i-reels i')].reduce((n, i) => n + i.getAnimations().length, 0));
    assert.equal(await reels(), 2, 'the reels turn while it plays');
    await page.mouse.move(195, 520); await page.mouse.down();
    await page.waitForFunction(() => document.querySelector('#ring').classList.contains('show') && !document.querySelector('#ring').classList.contains('moving'));
    // To the key at a pet's place: the last (just left of up), then the second (just right of up).
    const toward = async (i) => {
      const [x, y] = await page.evaluate((k) => { const r = [...document.querySelectorAll('#ring .pet')].at(k).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }, i);
      await page.mouse.move(x, y, { steps: 6 });
      await page.waitForFunction((k) => [...document.querySelectorAll('#ring .pet')].at(k).classList.contains('on'), i);
    };
    const angle = () => page.$eval('.lk-r-aim', (a) => Number(/rotate\(([-\d.e]+)deg\)/.exec(a.style.transform)?.[1]));
    const watch = () => page.evaluate(() => { const a = document.querySelector('.lk-r-aim'); window.__turns = []; new MutationObserver(() => window.__turns.push(Number(/rotate\(([-\d.e]+)deg\)/.exec(a.style.transform)?.[1]))).observe(a, { attributes: true, attributeFilter: ['style'] }); });
    await toward(-1);
    await page.evaluate(async () => (await import('/th/motion.js')).whenResting());
    const from = await angle(), n = await page.$$eval('#ring .pet', (p) => p.length);
    await watch();
    await toward(1);
    await page.evaluate(async () => (await import('/th/motion.js')).whenResting());
    const to = await angle(), seen = await page.evaluate(() => window.__turns);
    assert.ok(Math.abs(to - from - 2 * 360 / n) < .01, `by ${(to - from).toFixed(1)}°, the short way (${(2 * 360 / n).toFixed(1)}°)`);
    assert.ok(seen.length > 3 && seen.every((v) => v > from - 30 && v < to + 30), 'never the long way round');
    // Reduced: the hand is placed at once, and the reels stop.
    await page.evaluate(() => { document.documentElement.dataset.reducedMotion = 'always'; document.dispatchEvent(new CustomEvent('th:setting', { detail: { key: 'appearance.motion', value: 'always' } })); });
    await watch();
    await toward(2);
    const steps = await page.evaluate(() => window.__turns), stop = 360 / n;
    assert.ok(steps.length && steps.every((v) => Math.abs(v / stop - Math.round(v / stop)) < 1e-3), `placed at once, never between keys: ${steps}`);
    assert.equal(await reels(), 0, 'the reels are still');
    await page.mouse.move(195, 520); await page.mouse.up();
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('the phone\'s own reduced motion, Motion on System: the reels are still and the hand is placed at once', opts, async () => {
  const { context, page, errors } = await phone('dark', 'ink-lamp', 'reduce');
  try {
    await island(page);
    assert.equal(await page.evaluate(() => document.querySelectorAll('.th-island .lk-i-reels i, .th-island .lk-i-meter i').length), 7);
    assert.deepEqual(await page.evaluate(() => document.getAnimations().filter((a) => a.effect?.target?.closest?.('.th-island')).length), 0, 'nothing of the look turns');
    await ring(page);
    assert.equal(await page.$eval('.lk-r-aim', (a) => a.style.transform), 'rotate(0deg)');
    await page.mouse.up();
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

// Off again, no trace: the same steps on two phones, the look turned on, used and off on one (no reload), never on the other.
test('turned on, used and off again: home, the menu, Settings and the Briefing as they were, to the pixel', { ...opts, timeout: 300_000 }, async () => {
  const web = await serve(0, { api: API }), at = `http://127.0.0.1:${web.address().port}`;
  const run = async (look) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
    await context.addInitScript(() => { try { localStorage.setItem('th-still', '1'); localStorage.setItem('th.s.appearance.grain', 'false'); localStorage.setItem('th.s.appearance.glass', 'flat'); } catch {} }); // still, no grain, flat glass: pictures to compare
    const page = await context.newPage(), errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.clock.setFixedTime(new Date('2026-11-19T17:58:00Z'));
    const api = await mockApi(page, { chat: { reply: { after: 200, text: 'Done. Both reminders are set, and the walk is at eight.' } } });
    await page.route(`${API}/v1/music/catalog`, (r) => r.fulfill({ headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: JSON.stringify({ version: 1, kind: 'r2-library', complete: true, count: 0, generatedAt: '2026-11-01T00:00:00.000Z', tracks: [] }) }));
    await page.goto(`${at}/no-such-page`);
    await page.evaluate((token) => new Promise((resolve) => { const req = indexedDB.open('th-auth', 1); req.onupgradeneeded = () => req.result.createObjectStore('kv'); req.onsuccess = () => { const tx = req.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put({ session_id: 's1', token, signed_in_at: Date.now(), username: 'example-owner' }, 'session'); tx.oncomplete = () => { req.result.close(); resolve(); }; }; }), KEY);
    await page.goto(`${at}/`, { waitUntil: 'load' }); await page.waitForSelector('html[data-signed-in]');
    const rest = () => page.evaluate(async () => { await (await import('/th/motion.js')).whenResting(); await Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {}))); });
    const go = async (w) => { await page.evaluate((v) => document.dispatchEvent(new CustomEvent('th:go', { detail: v })), w); await page.waitForTimeout(400); await rest(); };
    const set = async (v) => {
      await page.evaluate(() => document.dispatchEvent(new CustomEvent('th:open', { detail: { name: 'appearance' } })));
      await page.waitForSelector('.spage.in .scatalog[data-group="appearance"]:not([aria-busy])');
      await page.click(`[data-key="appearance.look"] [data-v="${v}"]`); if (v !== 'classic') await page.waitForSelector('html[data-look-ready]');
      for (const dx of look && v !== 'classic' ? [90, -45] : []) { // a control dragged: Haptics to full and back to light
        const b = await page.locator('[data-key="appearance.haptics"] .lk-thumb').boundingBox(); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down();
        for (let i = 1; i <= 8; i++) await page.mouse.move(b.x + b.width / 2 + dx * i / 8, b.y + b.height / 2); await page.mouse.up(); await rest();
      }
      while (await page.$('.spage.in .sback')) { await page.keyboard.press('Escape'); await page.waitForTimeout(350); }
      await go('home');
    };
    await set(look ? 'ink-lamp' : 'classic');
    // Used: the island's card, the ring, the + sheet, a message sent and answered.
    await island(page); await page.evaluate(() => import('/th/island/island.js').then(async (m) => { await m.wide(true); await m.wide(false); await m.close(); }));
    await page.mouse.move(195, 640); await page.mouse.down(); await page.waitForTimeout(700);
    await page.mouse.move(195, 600, { steps: 4 }); await page.mouse.move(195, 640, { steps: 4 }); await page.mouse.up(); await rest();
    await page.click('#plus'); await page.waitForTimeout(400); await page.click('#plus'); await rest();
    const now = Date.now; Date.now = () => Date.parse('2026-11-19T17:58:00Z'); // the mock's times, the same on both phones
    try { await page.fill('#q', 'Remind me about the library books.'); await page.press('#q', 'Enter'); await page.waitForSelector('#talk .reply'); } finally { Date.now = now; }
    await page.waitForTimeout(400); await set('classic');
    // The look's listeners, poked: a key pressed, a new reply, a scroll.
    await page.dispatchEvent('#plus', 'pointerdown', { isPrimary: true, button: 0, pointerId: 1 });
    Date.now = () => Date.parse('2026-11-19T17:58:30Z'); api.chat.reply('Here is a second answer, longer, on two lines or more for the drop initial to take.'); Date.now = now;
    await page.waitForFunction(() => document.querySelectorAll('#talk .reply').length === 2); await page.dispatchEvent('#plus', 'pointerup', { isPrimary: true, pointerId: 1 });
    await page.$eval('#convo', (c) => { c.scrollTop = 400; c.scrollTop = 0; });
    await page.$eval('#q', (q) => q.blur()); await page.mouse.move(195, 300); await page.waitForTimeout(300); await rest();
    const shots = {};
    for (const w of ['home', 'side', 'settings', 'brief']) {
      if (w === 'settings') { await page.evaluate(() => document.dispatchEvent(new CustomEvent('th:open', { detail: { name: 'settings' } }))); await page.waitForSelector('.spage.in #set-text'); await page.waitForTimeout(500); await rest(); }
      else { await go(w); await page.waitForTimeout(1200); await rest(); }
      // (masked: the island's bars, which move, and the reply that came while on: same DOM, style and layout, rasterised a hair apart)
      shots[w] = await page.screenshot({ animations: 'disabled', caret: 'hide', mask: [page.locator('body > .th-island .bars'), page.locator('#talk .reply').first()] });
      if (w === 'settings') { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
    }
    // (the parked Music frame keeps the shape it shrank to, measured under the look, until it next opens)
    const dom = await page.evaluate(() => { const b = /** @type {HTMLElement} */ (document.body.cloneNode(true)); for (const n of b.querySelectorAll('.th-app-shell.parked, .th-app-shell.parked > iframe')) n.removeAttribute('style'); return b.outerHTML; }).then((h) => h.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, 'id'));
    const left = await page.evaluate(() => [...document.querySelectorAll('*')].flatMap((n) => [...n.attributes].filter((a) => /(^|\s)lk-|data-lk|data-look|--lk-|--turn|\/look\//.test(`${a.name}=${a.value}`)).map((a) => `${n.tagName}[${a.name}=${a.value}]`)));
    await context.close(); return { shots, dom, left, errors };
  };
  try {
    const [never, used] = [await run(false), await run(true)];
    assert.deepEqual(used.left, [], 'nothing of the look is left in the DOM');
    assert.deepEqual([never.errors, used.errors], [[], []]);
    // The same to the pixel, but for the raster noise two classic phones show under load (≤ 120 channels, ≤ 16 levels).
    const page = await browser.newPage(); // (the pictures decoded and compared by the browser's own canvas)
    for (const w of Object.keys(never.shots)) {
      const d = await page.evaluate(async (pngs) => { const px = await Promise.all(pngs.map(async (b) => { const i = await createImageBitmap(await (await fetch(`data:image/png;base64,${b}`)).blob()); const c = new OffscreenCanvas(i.width, i.height).getContext('2d'); c.drawImage(i, 0, 0); return c.getImageData(0, 0, i.width, i.height).data; })); return px[0].length === px[1].length ? [...px[0].map((v, i) => Math.abs(v - px[1][i])).filter(Boolean)] : [999]; }, [never.shots[w], used.shots[w]].map((b) => b.toString('base64')));
      assert.ok(d.length <= 120 && Math.max(0, ...d) <= 16, `${w}: ${d.length} channels differ, by up to ${Math.max(0, ...d)}`);
    }
    await page.close();
    assert.equal(used.dom, never.dom, 'the same DOM');
  } finally { web.close(); }
});

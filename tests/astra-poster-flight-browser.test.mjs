// A poster's flight into Details and home again, sampled every frame in a real Chromium at phone size, the CPU
// four times slower, with an invented add-on and a slow picture host served locally (the owner's "posters
// blink out and change on click"). At every frame the picture is on screen (the card's, the flying copy's or
// Details', whole and opaque) and it is the same picture: never an empty copy, never other artwork. The full
// details naming another poster file for the same title never replace the one that flew in; Back leaves the
// card's art opaque from its first frame, even with its row redrawn under Details; the hero flies the slide
// that was tapped even as it turns; a second title opened as the first flies flies its own picture.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { timing } from './fixtures/waits.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (invented add-on and pictures)', timeout: 120_000 };
let site, browser, base, host;
// With `noStore`, the host forbids keeping its pictures: a picture element made anew asks the slow host again
// (as a phone short of memory may), so a flying copy that is not the original picture is caught empty.
let noStore = false;
// A slower phone or host for a stress run: ASTRA_FLIGHT_CPU (default 4) and ASTRA_FLIGHT_DELAY (ms, default 400).
const CPU = Number(process.env.ASTRA_FLIGHT_CPU) || 4, DELAY = Number(process.env.ASTRA_FLIGHT_DELAY) || 400;
const metas = (h) => Array.from({ length: 8 }, (_, i) => ({ id: `tt00007${i}0`, type: 'movie', name: `Invented Film ${i}`, releaseInfo: '2003', poster: `${h}/img/p${i}.svg`, background: `${h}/img/b${i}.svg`, description: 'Invented for the test.' }));
const svg = (w, h, i) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="hsl(${i * 40} 60% 45%)"/><circle cx="${w / 2}" cy="${h / 2}" r="${w / 3}" fill="#fff"/></svg>`;

before(async () => {
  if (live) return;
  site = await serve(0, {});
  base = `http://127.0.0.1:${site.address().port}`;
  // The add-on and a slow picture host (every picture 400 ms, then cached as a real host's are). The full
  // details name another poster file for the same title ("alt"): other artwork, as a second add-on would.
  host = createServer(async (req, res) => {
    const h = `http://127.0.0.1:${host.address().port}`, u = new URL(req.url, h);
    const json = (v) => { res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(v)); };
    if (u.pathname === '/addon/manifest.json') return json({ id: 'example', name: 'Example', version: '1.0.0', resources: ['catalog', 'meta'], types: ['movie'], idPrefixes: ['tt'], catalogs: [{ type: 'movie', id: 'top', name: 'Top' }] });
    if (u.pathname.startsWith('/addon/catalog/')) return json({ metas: metas(h) });
    if (u.pathname.startsWith('/addon/meta/')) {
      const id = decodeURIComponent(u.pathname.split('/').pop().replace('.json', ''));
      const m = metas(h).find((x) => x.id === id) || metas(h)[1];
      return json({ meta: { ...m, poster: m.poster.replace('/p', '/alt'), videos: [] } });
    }
    const i = Number(/(\d+)\.svg$/.exec(u.pathname)?.[1] ?? -1);
    if (i < 0) { res.writeHead(404); return res.end(); }
    await new Promise((r) => setTimeout(r, DELAY));
    res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': noStore ? 'no-store' : 'max-age=3600', 'access-control-allow-origin': '*' });
    res.end(u.pathname.includes('/b') ? svg(1280, 720, i) : svg(300, 450, u.pathname.includes('/alt') ? i + 4 : i));
  }).listen(0, '127.0.0.1');
  await new Promise((r) => host.once('listening', r));
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => { await browser?.close(); site?.close(); host?.close(); });

async function open({ hero = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(([url, hero]) => {
    localStorage.setItem('astra.v2.addons', JSON.stringify([{ url: `${url}/addon/manifest.json`, enabled: true, name: 'Example' }]));
    localStorage.setItem('astra.v2.settings', JSON.stringify({ hero, motion: 'full' }));
  }, [`http://127.0.0.1:${host.address().port}`, hero]);
  await page.goto(`${base}/astra/`);
  // The first row's pictures have arrived and their arrival fades are over: this test is about what follows.
  const settled = () => {
    const imgs = [...document.querySelectorAll('.tab-view[data-tab=home] .rows .row:not(.skeleton-row) .poster-card img')].slice(0, 3);
    return imgs.length === 3 && imgs.every((i) => i.complete && i.naturalWidth) && !document.querySelector('.tab-view[data-tab=home] .rows').getAnimations({ subtree: true }).some((a) => a.playState === 'running');
  };
  // Twice, 500 ms apart: a picture is complete a moment before its load event starts its arrival fade.
  for (let n = 0; n < 2; n++) { await page.waitForFunction(settled, null, { timeout: 30_000 }); await page.waitForTimeout(500); }
  await page.waitForFunction(settled);
  // Each picture also read once with CORS, as ui/art.js reads a real host's small copy for its colour (on
  // Stremio's host the small copy is the very file a card shows): the page's picture cache then holds it in
  // another mode, and a picture element made anew for the same address waits for the host.
  await page.evaluate(() => Promise.all([...document.querySelectorAll('.rows .poster-card img')].map((i) => new Promise((r) => { const c = new Image(); c.crossOrigin = 'anonymous'; c.onload = c.onerror = r; c.src = i.src; }))));
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  // Every frame: what the card, the flying copy and Details' picture show, and whether each is painted whole.
  await page.evaluate(() => {
    const state = (box, under = false) => {
      if (!box || !box.isConnected) return null;
      const img = box.tagName === 'IMG' ? box : box.querySelector('img');
      let op = 1;
      for (let el = img || box; el && el !== document.documentElement; el = el.parentElement) op *= Number(getComputedStyle(el).opacity);
      const r = box.getBoundingClientRect();
      // Covered: under a screen that is opaque at the box's centre (Details over the card it opened from).
      const hit = document.elementFromPoint(Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2)), Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2)));
      const layer = hit?.closest('.screen-layer');
      let cover = 0;
      if (under && layer && !layer.contains(box)) { cover = 1; for (let el = layer; el && el !== document.documentElement; el = el.parentElement) cover *= Number(getComputedStyle(el).opacity); }
      const shown = cover < 0.98 && getComputedStyle(box).visibility === 'visible' && (!img || getComputedStyle(img).visibility === 'visible') && r.width > 0 && r.bottom > 0 && r.top < innerHeight;
      return { shown, op, src: img ? img.currentSrc || img.src : '', whole: !!img && img.complete && img.naturalWidth > 0, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2),
        fading: !!img && img.getAnimations().some((a) => a.animationName === 'img-in' && a.playState === 'running') };
    };
    // At rest, on the page's own frames: no flying copy, no finite animation running on the clock (scroll-linked
    // parallax is not on it), and the move's end reached
    // (Details built from its full details; home with no screen; the Library tab shown).
    const still = () => !document.querySelector('body > [aria-hidden="true"][style*="fixed"]')
      && document.getAnimations().every((a) => a.playState !== 'running' || a.timeline !== document.timeline || a.effect?.getComputedTiming().endTime === Infinity);
    const rests = {
      open: () => { const top = window.astra.stack.at(-1)?.screen; return still() && top?.el.matches('.screen.details') && top.meta && !top.loading && !!document.querySelector(window.__flight.dest); },
      back: () => still() && !document.querySelector('.screen-layer'),
      tab: () => still() && !!document.querySelector('.tab-view[data-tab=library]:not(.off)'),
    };
    window.__flight = { card: null, key: '', dest: '.screen.details .details-poster', samples: [], on: false, armed: false, rest: 'open', calm: 0 };
    const loop = () => {
      const f = window.__flight;
      if (f.on) {
        const copy = [...document.querySelectorAll('body > [aria-hidden="true"][style*="fixed"]')].at(-1) || null;
        const card = f.card?.isConnected ? f.card : f.key ? document.querySelector(`.tab-view:not(.off) [data-item="${f.key}"] .poster-art`) : null;
        f.samples.push({ t: Math.round(performance.now()), card: state(card, true), copy: state(copy), details: state([...document.querySelectorAll(f.dest)].at(-1)) });
        // Sampling ends ten frames after the move is at rest (frames, not milliseconds: a slow runner samples as far).
        if (f.armed && rests[f.rest]()) { if (++f.calm >= 10) f.on = false; } else f.calm = 0;
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
  return { context, page, cdp, errors };
}

/** Samples every frame while `act` runs and on until the move is at rest (`rest`: open, back or tab), then ten frames more. */
async function sampled(page, act, rest = 'back') {
  await page.evaluate((rest) => Object.assign(window.__flight, { samples: [], on: true, armed: false, rest, calm: 0 }), rest);
  await act();
  await page.evaluate(() => { window.__flight.armed = true; });
  await page.waitForFunction(() => !window.__flight.on, null, { timeout: 60_000 });
  return page.evaluate(() => window.__flight.samples);
}
/** The first flying copy appended to the page, seen in the page as it is added; `then` runs there at once. */
const onFirstCopy = async (page, then) => {
  await page.evaluate(`window.__onCopy = ${then}`);
  await page.evaluate(() => {
    const ob = new MutationObserver((list) => {
      if (!list.some((m) => [...m.addedNodes].some((n) => n.matches?.('[aria-hidden="true"][style*="fixed"]')))) return;
      ob.disconnect();
      window.__onCopy();
    });
    ob.observe(document.body, { childList: true });
  });
};
const watch = (page, sel, dest) => page.evaluate(([sel, dest]) => {
  const el = document.querySelector(sel);
  Object.assign(window.__flight, { card: el, key: el.closest('[data-item]')?.dataset.item || '', ...(dest ? { dest } : {}) });
  return el.querySelector('img').currentSrc;
}, [sel, dest]);

// At every frame one of the pictures is painted whole and opaque, and every painted one shows `src`.
function assertAlwaysPictured(samples, src, label) {
  // Sampled from the act until ten frames after rest; how many frames that is depends on the runner.
  assert.ok(samples.length >= 10, `${label}: ${samples.length} frames sampled`);
  timing(samples.length > 20, `${label}: ${samples.length} frames sampled`);
  for (const s of samples) {
    const painted = ['card', 'copy', 'details'].filter((k) => s[k]?.shown && s[k].whole && s[k].op > 0.98);
    assert.ok(painted.length, `${label} at ${s.t}: no picture on screen ${JSON.stringify(s)}`);
    for (const k of painted) assert.equal(s[k].src, src, `${label} at ${s.t}: the ${k} shows other artwork`);
    if (s.copy?.shown && s.copy.op > 0.02) assert.ok(s.copy.whole, `${label} at ${s.t}: the flying copy is an empty tile ${JSON.stringify(s)}`);
    if (s.card?.shown && s.card.op > 0.5) assert.ok(s.card.whole && !s.card.fading, `${label} at ${s.t}: the card shows its placeholder or fades again ${JSON.stringify(s)}`);
  }
}

const tap = async (page, cdp, sel) => {
  const b = await page.locator(sel).boundingBox();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x + b.width / 2, y: b.y + b.height / 2 }] });
  await page.waitForTimeout(90);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
};
const feel = (page) => page.evaluate(async () => (await import('/astra/src/ui/feel-log.js')).feelEntries().map((e) => e.name));

test('a poster flies into Details and home again with its own picture on screen at every frame', opts, async () => {
  noStore = true;
  const { context, page, cdp, errors } = await open();
  const card = '.tab-view[data-tab=home] .rows .row .poster-card:nth-child(2) .poster-art';
  const src = await watch(page, card);
  for (const round of ['first', 'again']) {
    const opened = await sampled(page, () => tap(page, cdp, card), 'open');
    assertAlwaysPictured(opened, src, `open (${round})`);
    assert.ok(opened.some((s) => s.copy?.shown && s.copy.op > 0.98), 'the poster flies');
    // The full details name another poster file: it is never shown, then or after.
    assert.ok(opened.at(-1).details?.shown && !opened.at(-1).copy, 'it lands on Details and the copy goes');
    assert.equal(await page.evaluate(() => window.astra.stack.at(-1).screen.meta?.poster), src, "Details keeps the card's poster for the visit");
    const back = await sampled(page, () => page.evaluate(() => window.astra.back()));
    assertAlwaysPictured(back, src, `back (${round})`);
    assert.ok(back.at(-1).card?.shown && !back.at(-1).copy && !back.at(-1).details, 'home on its card');
  }
  // Home's row redrawn while nothing flies, with the host's pictures not kept by the browser: every card shows
  // its art at every frame (the redrawn cards take the pictures the old ones showed).
  const redrawRow = () => page.evaluate(() => { const home = window.astra.screens.home, slot = home.rows.querySelector('.row'); slot.signature = null; const it = slot.entry.items; [it[0], it[1]] = [it[1], it[0]]; home.renderRow(slot, slot.entry); });
  const rowPictures = () => page.evaluate(() => [...document.querySelectorAll('.tab-view[data-tab=home] .rows .row:first-child .poster-card img')].slice(0, 3).map((i) => i.complete && i.naturalWidth > 0));
  for (let n = 0; n < 2; n++) {
    await redrawRow();
    assert.deepEqual(await rowPictures(), [true, true, true], 'a redrawn row shows its art at once');
  }
  // Home's row redrawn under the flight, another title now where the card was: the flight keeps its own
  // picture (the copy, then Details'), and Back finds the card by its title. (The redrawn card is a new element
  // under the flight; what is checked here is the picture that flies.)
  await page.evaluate(() => { window.__flight.card = null; window.__flight.key = ''; });
  // The row is redrawn under the flight: in the page, as the flying copy is added.
  await onFirstCopy(page, () => { const home = window.astra.screens.home, slot = home.rows.querySelector('.row'); slot.signature = null; const it = slot.entry.items; [it[0], it[1]] = [it[1], it[0]]; home.renderRow(slot, slot.entry); window.__redrawnUnder = true; });
  const redrawn = await sampled(page, () => tap(page, cdp, card), 'open');
  assert.equal(await page.evaluate(() => window.__redrawnUnder), true, 'the row was redrawn under the flight');
  const flown = redrawn.filter((s) => s.copy?.op > 0.98 || (s.details?.shown && s.details.op > 0.98));
  assert.ok(flown.length && flown.some((s) => s.copy?.op > 0.98) && flown.at(-1).details?.shown, 'it flies and lands');
  timing(flown.length > 20, `${flown.length} frames of the flight sampled`);
  assertAlwaysPictured(flown, src, 'open with the row redrawn');
  await page.evaluate(() => { window.__flight.key = 'movie:tt0000710'; });
  const home = await sampled(page, () => page.evaluate(() => window.astra.back()));
  assertAlwaysPictured(home, src, 'back to the redrawn row');
  assert.ok(home.some((s) => s.copy?.shown) && !(await feel(page)).includes('drop:details'), 'it flies home to the card in its new place');
  // A picture first painted elsewhere (Details of a title whose card is off screen to the right, lazy and never
  // asked for): the card is asked for it at once, so it is whole before it is scrolled to.
  const offscreen = '.tab-view[data-tab=home] .rows .row:first-child .poster-card[data-item="movie:tt0000770"] img';
  assert.equal(await page.locator(offscreen).evaluate((i) => i.complete), false, 'the last card has not been asked for its picture');
  await page.evaluate(() => window.astra.openTitle(window.astra.screens.home.previewItems().find((m) => m.id === 'tt0000770')));
  await page.waitForFunction((s) => document.querySelector('.screen.details .details-poster img')?.complete && document.querySelector(s).complete, offscreen, { timeout: 10_000 });
  await page.evaluate(() => window.astra.back());
  await page.waitForFunction(() => !document.querySelector('.screen-layer'));
  await page.waitForFunction((s) => { const i = document.querySelector(s); return i.complete && i.naturalWidth > 0; }, offscreen, { timeout: 10_000 })
    .catch(() => assert.fail('seen once, the card off screen has its picture'));
  // Library redrawn under Details (a library change): Back flies home to the redrawn card, its art opaque at once.
  noStore = false;
  await page.evaluate(() => { for (const m of window.astra.screens.home.previewItems().slice(0, 3)) window.astra.library.toggle(m); window.astra.selectTab('library', true); });
  const lib = '.tab-view[data-tab=library] .poster-card[data-item="movie:tt0000710"] .poster-art';
  await page.waitForSelector(lib);
  // The tab shown and at rest: its card's picture arrived from the slow host and its arrival fade over.
  await page.waitForFunction((lib) => { const i = document.querySelector(lib + ' img'); return i?.complete && i.naturalWidth > 0; }, lib, { timeout: 10_000 });
  await page.waitForFunction(() => !document.querySelector('.screen-layer') && document.getAnimations().every((a) => a.playState !== 'running' || a.timeline !== document.timeline || a.effect?.getComputedTiming().endTime === Infinity));
  const libSrc = await watch(page, lib);
  assertAlwaysPictured(await sampled(page, () => tap(page, cdp, lib), 'open'), libSrc, 'open from Library');
  await page.evaluate(() => window.astra.library.toggle(window.astra.screens.home.previewItems()[5]));
  await page.waitForTimeout(300);
  // (wherever the redraw put the card, it is brought on screen: Back to a card off screen is a drop by design)
  await page.evaluate((s) => document.querySelector(s).scrollIntoView({ block: 'nearest', inline: 'nearest' }), lib);
  const libBack = await sampled(page, () => page.evaluate(() => window.astra.back()));
  assertAlwaysPictured(libBack, libSrc, 'back to a redrawn Library');
  assert.ok(libBack.some((s) => s.copy?.shown) && !(await feel(page)).includes('drop:details'), 'it flies home, not a drop');
  // A tab left and returned to: its art is shown at once, never faded in again.
  await page.evaluate(() => window.astra.selectTab('home', true));
  await page.waitForTimeout(400);
  const tab = await sampled(page, () => page.evaluate(() => window.astra.selectTab('library', true)), 'tab');
  assert.ok(tab.every((s) => !s.card?.shown || (s.card.whole && !s.card.fading)), 'Library shows its art at once');
  assert.deepEqual(errors, []);
  await context.close();
});

test('a second title opened as the first flies, and a hero turning at the tap, fly their own pictures', opts, async () => {
  const { context, page, cdp, errors } = await open({ hero: true });
  await page.evaluate(() => window.astra.screens.home.carousel.pause());
  const a = '.tab-view[data-tab=home] .rows .row .poster-card:nth-child(2) .poster-art', b = '.tab-view[data-tab=home] .rows .row .poster-card:nth-child(1) .poster-art';
  await page.evaluate((s) => document.querySelector(s).scrollIntoView({ block: 'center' }), a);
  await page.waitForTimeout(300);
  const srcA = await watch(page, a), srcB = await page.locator(b + ' img').evaluate((i) => i.currentSrc);
  const at = await page.locator(b).evaluate((el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  // The second title is opened in the page on the first frame of the first one's flight.
  await onFirstCopy(page, () => requestAnimationFrame(() => {
    const art = document.querySelector('.tab-view[data-tab=home] .rows .row .poster-card:nth-child(1) .poster-art'), m = window.astra.screens.home.previewItems()[0];
    window.astra.push(new window.astra.screenTypes.details(window.astra, m, { from: art }));
  }));
  const both = await sampled(page, () => tap(page, cdp, a), 'open');
  const firstB = both.find((s) => s.copy?.shown && s.copy.op > 0.98 && s.copy.src === srcB);
  assert.ok(firstB, 'the second title flies');
  assert.ok(Math.hypot(firstB.copy.x - at.x, firstB.copy.y - at.y) < 24, `it starts on its own card, not from the first one's copy (${JSON.stringify(firstB.copy)}, card at ${JSON.stringify(at)})`);
  assert.ok(both.every((s) => !s.copy?.shown || [srcA, srcB].includes(s.copy.src)), 'no other picture flies');
  assert.equal(both.at(-1).details?.src, srcB, "the second Details shows the second title's poster");
  await page.evaluate(() => { window.astra.back(); window.astra.back(); });
  await page.waitForTimeout(1200);
  // The hero turning by itself as the finger lands: the button tapped is the first slide's, and its picture flies.
  await page.evaluate(() => window.astra.screens.home.view.scrollTo(0, 0));
  await page.waitForTimeout(300);
  const heroSrc = await page.evaluate(() => document.querySelector('.hero-slide .hero-bg img').currentSrc);
  await page.evaluate(() => { window.__flight.card = null; window.__flight.key = ''; window.__flight.dest = '.screen.details .details-bg'; });
  const turned = await sampled(page, () => page.evaluate(() => {
    const c = window.astra.screens.home.carousel;
    c.go(1);
    c.slides[0].querySelector('.hero-cta').click();
  }), 'open');
  assert.ok(turned.some((s) => s.copy?.shown), 'the backdrop flies');
  for (const s of turned) if (s.copy?.shown && s.copy.op > 0.5) assert.equal(s.copy.src, heroSrc, "the tapped slide's picture flies, not the next one's");
  assert.equal(turned.at(-1).details?.src, heroSrc);
  assert.deepEqual(errors, []);
  await context.close();
});

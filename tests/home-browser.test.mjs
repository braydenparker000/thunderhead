// Drives the home page in Chromium at phone size: no errors, and the hold, swipe and + gestures work.
// Set SITE_URL to check a deployed site instead of the local copy; against a live site the
// checks are read-only (nothing is sent).
// CSP violations show up as console errors, so every test also proves the page fits the CSP.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { afterFirstPaint, timing, until } from './fixtures/waits.mjs';

let server, browser, base;
before(async () => {
  if (process.env.SITE_URL) base = process.env.SITE_URL.replace(/\/$/, '');
  else { server = await serve(0); base = `http://127.0.0.1:${server.address().port}`; }
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => { await browser?.close(); server?.close(); });

async function open(theme = 'light', path = '/') {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(t => { try { localStorage.setItem('th-theme', t); } catch {} }, theme);
  // The gestures are checked signed out of the API: with an API address the shell would go to
  // /signin/ (tests/signin-browser.test.mjs covers that against a mocked Worker).
  await page.route('**/config.js', route => route.fulfill({ contentType: 'text/javascript', body: "export const CONFIG = { api: '', build: 0, commit: 'dev', repo_url: '' };" }));
  await page.goto(base + path, { waitUntil: 'load' });
  // Home reads its motion tokens after the first paint; the gestures need them.
  await afterFirstPaint(page);
  await page.evaluate(() => document.fonts.ready);
  return { page, errors };
}
const whenResting = page => page.evaluate(async () => (await import('/th/motion.js')).whenResting());
// The flight out is a compositor animation (home.js), then the engine's: wait for both.
const ringRest = async page => { await page.waitForFunction(() => document.querySelector('#ring').classList.contains('show')); await page.waitForFunction(() => !document.querySelector('#ring').classList.contains('moving')); await whenResting(page); };
const drag = async (page, x0, x1, y = 300) => {
  await page.mouse.move(x0, y); await page.mouse.down();
  await page.mouse.move(x0 + (x1 - x0) * 0.3, y, { steps: 4 }); await page.mouse.move(x1, y, { steps: 8 });
  await page.mouse.up();
  // The engine restores the page's stylesheet transition once both progress axes rest.
  // Wait for that completion as well as any remaining decorative CSS transitions.
  await whenResting(page);
  await page.waitForFunction(() => ['home', 'brief', 'side', 'dim'].every(id => document.getElementById(id).style.transition !== 'none') && !document.getAnimations().some(a => a instanceof CSSTransition && a.playState === 'running'), null, { timeout: 3000 });
};
// `+ 0` turns -0 into 0.
const left = (page, sel) => page.$eval(sel, el => Math.round(el.getBoundingClientRect().left) + 0);

test('loads clean in day and night', async () => {
  for (const theme of ['light', 'dark']) {
    const { page, errors } = await open(theme);
    assert.equal(await page.getAttribute('html', 'data-theme'), theme);
    assert.deepEqual(errors, []);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert.ok(overflow <= 0, 'no sideways scroll');
    await page.close();
  }
});

test('the page refuses to show inside a frame', async () => {
  // a fresh page: our own pages forbid frames, so the parent must be a neutral document
  const page = await browser.newPage({ serviceWorkers: 'block' });
  await page.setContent(`<iframe src="${base}/" width="390" height="844"></iframe>`);
  const frame = await until(() => page.frames().find(f => f !== page.mainFrame() && f.url().startsWith(base)), { message: 'the framed page loaded' });
  await frame.waitForLoadState('load');
  assert.equal(await frame.evaluate(() => getComputedStyle(document.body).visibility), 'hidden');
  const top = await open();
  assert.equal(await top.page.evaluate(() => getComputedStyle(document.body).visibility), 'visible');
  await top.page.close(); await page.close();
});

test('holding still opens the Compass ring; sliding picks an app', async () => {
  const { page, errors } = await open();
  await page.mouse.move(200, 300); await page.mouse.down(); await ringRest(page);
  assert.ok(await page.$eval('#ring', el => el.classList.contains('show')), 'ring opens');
  await page.mouse.move(200, 230, { steps: 5 }); await whenResting(page);
  assert.equal(await page.textContent('#lbl'), 'Music');
  // The app itself is checked in tests/ported-browser.test.mjs; here only the hand-off counts. Music
  // opens as a layer inside home (th/island, HOME.md §12.1): home stays, the app is in its frame.
  await page.route('**/music/**', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Music</title>' }));
  await page.mouse.up();
  await page.waitForFunction(() => /^\/music\/(\?th-frame=[0-9a-f]{32})?$/.test(document.querySelector('iframe.th-app')?.getAttribute('src') ?? ''), null, { timeout: 8000 });
  assert.equal(new URL(page.url()).pathname, '/');
  assert.deepEqual(errors, []);
  await page.close();
});

test('the ring flies out together in 120 ms, past the ring and back, its glass fading in as the discs slow; the chosen disc lifts at rest', async () => {
  const { page, errors } = await open();
  // The browser's page clock isolates the trajectory from runner scheduling. Rendering/frame cost
  // is measured separately in the opt-in Frames readout on the device.
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await page.evaluate(() => {
    window.ringPoint = (type, x = 200, y = 420) => document.querySelector('#app').dispatchEvent(new PointerEvent(type, { bubbles: true, isPrimary: true, pointerId: 19, clientX: x, clientY: y }));
    window.ringPoint('pointerdown');
  });
  await page.clock.runFor(220);
  // The flight runs on the document's timeline, which the page clock does not hold, so its first
  // frame is read by seeking to it rather than by racing it.
  const start = await page.evaluate(() => {
    const pets = [...document.querySelectorAll('#ring .pet')];
    pets.forEach(p => { const a = p.getAnimations()[0]; if (a) { a.pause(); a.currentTime = 0; } });
    return { time: performance.now(), moving: document.querySelector('#ring').classList.contains('moving'), pets: pets.map(p => {
      const css = getComputedStyle(p), m = new DOMMatrix(css.transform);
      return { radius: Math.hypot(m.m41, m.m42), scale: m.a, blur: css.backdropFilter, shadow: css.boxShadow, layer: getComputedStyle(p, '::before').visibility };
    }) };
  });
  assert.equal(start.moving, true);
  assert.equal(start.pets.length, 7);
  for (const p of start.pets) {
    assert.equal(p.radius, 0); assert.equal(p.scale, .2);
    assert.equal(p.blur, 'none'); assert.equal(p.shadow, 'none'); assert.equal(p.layer, 'hidden');
  }
  // The flight out is the springs' curve played by the compositor: seek it to read its trajectory. The
  // discs fly ~13% past the ring and magnet back, growing from .2 through ~1.06 to 1 (GESTURES.md §3).
  const trajectory = await page.evaluate(() => {
    const pets = [...document.querySelectorAll('#ring .pet')], flights = pets.map(p => p.getAnimations()[0]);
    flights.forEach(a => a.pause());
    const frames = [];
    for (let ms = 0; ms <= flights[0].effect.getComputedTiming().duration; ms += 4) {
      flights.forEach(a => { a.currentTime = ms; });
      frames.push({ ms, pets: pets.map(p => { const m = new DOMMatrix(getComputedStyle(p).transform); return { radius: Math.hypot(m.m41, m.m42), scale: m.a }; }) });
    }
    // Held at its start: on a loaded runner the document's timeline would finish the flight (and so end
    // .moving) before the page clock reaches 85%, which is what the glass reads below are about.
    flights.forEach(a => { a.currentTime = 0; });
    return frames;
  });
  for (const f of trajectory) { const radii = f.pets.map(p => p.radius); assert.ok(Math.max(...radii) - Math.min(...radii) < .01, `no stagger at ${f.ms} ms`); }
  const reached = trajectory.find(f => f.pets.every(p => p.radius >= 62 * .9))?.ms;
  assert.ok(reached > 0 && reached <= 120, `all seven reach 90% radius in ${reached} ms`);
  const most = Math.max(...trajectory.map(f => f.pets[0].radius)), biggest = Math.max(...trajectory.map(f => f.pets[0].scale));
  assert.ok(most >= 62 * 1.1 && most <= 62 * 1.14, `radial overshoot ${(most / 62 - 1) * 100}%`);
  assert.ok(biggest >= 1.04 && biggest <= 1.08, `the discs grow to ${biggest} on the way out`);
  const end = trajectory.at(-1).pets[0];
  assert.ok(Math.abs(end.radius - 62) < .7 && Math.abs(end.scale - 1) < .01, 'and land on the ring');
  // The glass starts to fade in as they pass 85% of the way out, while they still move.
  const at85 = trajectory.find(f => f.pets[0].radius >= 62 * .85).ms;
  await page.clock.runFor(at85 - 4);
  assert.equal(await page.$eval('#ring', r => r.classList.contains('glassy')), false, 'no glass before 85%');
  await page.clock.runFor(8);
  assert.deepEqual(await page.$eval('#ring', r => [r.classList.contains('glassy'), r.classList.contains('moving')]), [true, true], 'the glass starts before rest');
  await page.evaluate(() => document.querySelectorAll('#ring .pet').forEach(p => p.getAnimations()[0]?.play()));
  await page.waitForFunction(() => !document.querySelector('#ring').classList.contains('moving'));
  await whenResting(page);
  await page.$eval('#ring .pet', p => Promise.all(p.getAnimations({ subtree: true }).map(a => a.finished)));
  assert.equal(await page.$eval('#ring .pet', p => getComputedStyle(p, '::before').opacity), '1');
  await page.evaluate(() => window.ringPoint('pointermove', 200, 350));
  assert.equal(await page.$eval('#ring', r => r.classList.contains('moving')), true);
  assert.equal(await page.$eval('#ring .pet', p => p.classList.contains('lifted')), false, 'no lift while it moves');
  assert.equal(await page.$eval('#ring .pet', p => getComputedStyle(p, '::before').opacity), '1', 'the glass stays while the discs move to choose');
  let peak = 1;
  for (let i = 0; i < 30; i++) {
    await page.clock.runFor(16);
    peak = Math.max(peak, await page.$eval('#ring .pet', p => new DOMMatrix(getComputedStyle(p).transform).a));
  }
  await whenResting(page);
  // Overshoot is relative to the .12 scale step, just as the engine measures relative travel.
  const overshoot = (peak - 1.12) / .12;
  assert.equal(await page.textContent('#lbl'), 'Music');
  assert.deepEqual(await page.$$eval('#ring .pet', pets => pets.map(p => p.classList.contains('lifted'))), [true, false, false, false, false, false, false], 'the chosen disc lifts once it rests');
  assert.ok(overshoot >= .08 && overshoot <= .16, `chosen scale overshoot ${overshoot * 100}%`);
  const scales = await page.$$eval('#ring .pet', pets => pets.map(p => new DOMMatrix(getComputedStyle(p).transform).a));
  assert.ok(Math.abs(scales[0] - 1.12) < .001);
  assert.ok(scales.slice(1).every(s => Math.abs(s - .94) < .001));
  assert.equal(await page.$eval('#ring', r => r.classList.contains('moving')), false);
  await page.evaluate(() => window.ringPoint('pointercancel'));
  await page.clock.runFor(600); await whenResting(page);
  assert.equal(await page.$eval('#ring', r => r.classList.contains('show')), false);
  assert.deepEqual(errors, []);
  await page.close();
});

test('the ring keeps its pick until the finger is clearly past the boundary (~7 degrees)', async () => {
  const { page, errors } = await open();
  const cx = 200, cy = 420;
  await page.mouse.move(cx, cy); await page.mouse.down(); await ringRest(page);
  // angles are measured from where the thumb went down (here the ring's centre too: nothing is clamped)
  const [rx, ry] = [cx, cy];
  const from = deg => [rx + 60 * Math.sin(deg * Math.PI / 180), ry - 60 * Math.cos(deg * Math.PI / 180)];
  // Seven apps: sectors of 360/7 ≈ 51.4°, Music's edge at 25.7°, held until ~7° past it (32.7°) and back (18.7°).
  for (const [deg, want] of [[0, 'Music'], [24, 'Music'], [31, 'Music'], [36, 'Guitar'], [22, 'Guitar'], [15, 'Music'], [-31, 'Music'], [-36, 'Photos']]) {
    await page.mouse.move(...from(deg), { steps: 4 }); await whenResting(page);
    assert.equal(await page.textContent('#lbl'), want, `at ${deg} degrees`);
  }
  await page.mouse.move(rx, ry); await page.mouse.up();
  assert.deepEqual(errors, []);
  await page.close();
});

test('near an edge the ring moves in, but a straight swipe up still picks Music', async () => {
  // Owner, 2026-10-31: quick swipes missed. The ring is pulled in from the edge to fit; direction is
  // measured from where the thumb went down, so the thumb's own line counts, not the ring's centre.
  const { page, errors } = await open();
  await page.mouse.move(355, 520); await page.mouse.down(); await ringRest(page);
  const rx = await page.$eval('#ring', el => el.getBoundingClientRect().left);
  assert.ok(rx < 330, `the ring is pulled in from the edge (centre at ${rx})`);
  await page.mouse.move(355, 480, { steps: 4 }); await whenResting(page);
  assert.equal(await page.textContent('#lbl'), 'Music');
  await page.mouse.move(355, 520, { steps: 2 }); await page.mouse.up();
  assert.deepEqual(errors, []);
  await page.close();
});

test('swipe right opens the briefing, swipe left opens the menu', async () => {
  const { page, errors } = await open();
  await drag(page, 60, 330);
  assert.equal(await left(page, '#brief'), 0, 'briefing in view');
  await drag(page, 330, 40);
  assert.equal(await left(page, '#home'), 0, 'back home');
  await drag(page, 330, 60);
  assert.ok(await left(page, '#side') < 390, 'menu in view');
  await page.click('#dim', { position: { x: 20, y: 300 } });
  await page.waitForFunction(() => !document.querySelector('#side').classList.contains('moving'));
  assert.ok(await left(page, '#side') >= 390, 'menu closed');
  assert.deepEqual(errors, []);
  await page.close();
});

test('springs preserve drag reversals, cross-axis navigation, regrabs and a reopened ring', async () => {
  const { page, errors } = await open();
  const rest = () => page.waitForFunction(() => ['home', 'brief', 'side'].every(id => document.getElementById(id).style.transition !== 'none'));
  await page.evaluate(() => {
    window.dragPoint = (type, x) => document.querySelector('#app').dispatchEvent(new PointerEvent(type, { bubbles: true, isPrimary: true, pointerId: 7, clientX: x, clientY: 350 }));
    window.dragPoint('pointerdown', 200);
    window.dragPoint('pointermove', 190);
    window.dragPoint('pointermove', 340);
    window.dragPoint('pointerup', 340);
  });
  await rest();
  assert.equal(await left(page, '#brief'), 0, 'a home drag can reverse across its starting point');
  const jump = await page.evaluate(() => new Promise(resolve => {
    const home = document.querySelector('#home');
    let last = home.getBoundingClientRect().left, biggest = 0;
    document.dispatchEvent(new CustomEvent('th:go', { detail: 'side' }));
    const sample = () => {
      const x = home.getBoundingClientRect().left;
      biggest = Math.max(biggest, Math.abs(x - last)); last = x;
      if (home.style.transition === 'none') requestAnimationFrame(sample); else resolve(biggest);
    };
    requestAnimationFrame(sample);
  }));
  // The largest step between two frames depends on how many frames a loaded runner draws.
  timing(jump < 120, `both progress axes compose without a full-page jump (${jump}px)`);
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('th:go', { detail: 'brief' })));
  await page.waitForFunction(() => { const x = document.querySelector('#brief').getBoundingClientRect().left; return x > -250 && x < -100; });
  const regrab = await page.evaluate(() => {
    const brief = document.querySelector('#brief');
    const before = brief.getBoundingClientRect().left;
    window.dragPoint('pointerdown', 200);
    const held = brief.getBoundingClientRect().left;
    window.dragPoint('pointermove', 210);
    const moved = brief.getBoundingClientRect().left;
    window.dragPoint('pointerup', 210);
    return { before, held, moved };
  });
  assert.ok(Math.abs(regrab.held - regrab.before) < .01, 'taking over keeps the current position');
  assert.ok(Math.abs(regrab.moved - regrab.held - 10) < .1, 'the next drag is anchored to that position');
  await rest();
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('th:go', { detail: 'home' })));
  await rest();
  await page.evaluate(() => document.querySelector('[data-skip="apps"]').click());
  await page.waitForTimeout(100);
  await page.keyboard.press('Escape');
  await page.evaluate(() => document.querySelector('[data-skip="apps"]').click());
  await ringRest(page);
  assert.ok(await page.$eval('#ring', r => r.classList.contains('show')), 'an old close cannot hide a reopened ring');
  assert.ok(await page.$eval('#ring .pet', p => Math.abs(new DOMMatrix(getComputedStyle(p).transform).m42 + 62) < .1));
  assert.deepEqual(errors, []);
  await page.close();
});

test('+ opens the options sheet; typing swaps the mic for send', async () => {
  const { page, errors } = await open();
  await page.click('#plus');
  await page.waitForFunction(() => document.querySelector('#opts').classList.contains('show'));
  assert.ok(await page.$eval('#opts', el => el.classList.contains('show')));
  await page.click('#plus');
  await page.fill('#q', 'hello');
  assert.ok(await page.$eval('#ask', el => el.classList.contains('typing')));
  // The mic and send share one spot, centred in the bar (a hit-area rule once stacked them, so the
  // mic rode high and send fell under the bar).
  const boxes = await page.evaluate(() => ['#mic', '#ask .send', '#ask'].map(s => { const r = document.querySelector(s).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }));
  assert.ok(Math.abs(boxes[0][0] - boxes[1][0]) <= 1, 'mic and send at the same x');
  assert.ok(Math.abs(boxes[1][1] - boxes[2][1]) <= 2, 'send centred in the bar');
  if (!process.env.SITE_URL) {
    await page.press('#q', 'Enter');
    // The signed-out reply types itself out (home.js): wait for it to be under way.
    await page.waitForFunction(() => (document.querySelector('.reply')?.textContent.length ?? 0) > 10);
    assert.equal(await page.textContent('.you'), 'hello');
    assert.ok((await page.textContent('.reply')).length > 10, 'a reply appears');
  }
  assert.deepEqual(errors, []);
  await page.close();
});

// The player's added capabilities (frontend/astra/src/player/extras.js and its modules) in a real
// browser at phone landscape size with touch: the real PlayerScreen on the lab page, the engine's load
// stubbed and the video's clock faked where no film is needed (as astra-player-browser.test.mjs), and a
// real film from tests/fixtures/astra-host.mjs for saving a still. One check per feature that shows:
// the Playback menu (speed, sleep timer, A–B repeat, sound only), remembered volume, "Start over",
// seek-bar marks and chapters, subtitle delay steps, finding a line, the second subtitle, frame step
// and stills, pinch to zoom, data used, the source line, and the lab's address handling.
// Their pure rules are in astra-player.test.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { astraHost } from './fixtures/astra-host.mjs';
import { outlast } from './fixtures/waits.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only' };
const LANDSCAPE = { width: 844, height: 390 };
let site, browser, base, host;

before(async () => {
  if (live) return;
  site = await serve(0, {});
  base = `http://127.0.0.1:${site.address().port}`;
  host = await astraHost();
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => { await browser?.close(); site?.close(); await host?.close(); });

/**
 * One open player on the lab page: `window.p`, `window.fake` to move its clock. `prefs` are saved
 * before it is built; `second` true puts recording stand-ins for the engine's second-subtitle methods, 'none' takes them away.
 */
async function player(t, { open = {}, prefs = null, second = false, clock = false } = {}) {
  const context = await browser.newContext({ viewport: LANDSCAPE, hasTouch: true, isMobile: true, acceptDownloads: true });
  t.after(() => context.close());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (clock) await page.clock.install();
  await page.goto(`${base}/astra/lab/`);
  await page.evaluate(async ({ open, prefs, second }) => {
    if (prefs) localStorage.setItem('astra.v2.player', JSON.stringify(prefs));
    window.wake = { held: 0 };
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: async () => {
      window.wake.held++; const s = new EventTarget(); s.release = async () => { window.wake.held--; }; return s;
    } } });
    const { AstraPlayer } = await import('/astra/src/engine/player.js');
    if (second === true) {
      window.secondCalls = [];
      AstraPlayer.prototype.setSecondLayer = function (el) { window.secondLayer = el; };
      AstraPlayer.prototype.selectSecondSubtitle = function (id) { window.secondCalls.push(id); this.secondSubtitle = id; };
    } else if (second === 'none') { delete AstraPlayer.prototype.setSecondLayer; delete AstraPlayer.prototype.selectSecondSubtitle; }
    const { PlayerScreen } = await import('/astra/src/player/player-screen.js');
    const p = (window.p = new PlayerScreen());
    window.loads = [];
    p.engine.load = async ({ url, startTime }) => { window.loads.push({ url, startTime }); };
    const v = p.video;
    let paused = true, duration = 3000, time = 0;
    Object.defineProperties(v, {
      paused: { get: () => paused, configurable: true },
      duration: { get: () => duration, configurable: true },
      currentTime: { get: () => time, set: (x) => { time = x; }, configurable: true },
    });
    v.play = async () => { if (paused) { paused = false; v.dispatchEvent(new Event('play')); v.dispatchEvent(new Event('playing')); } };
    v.pause = () => { if (!paused) { paused = true; v.dispatchEvent(new Event('pause')); } };
    window.fake = {
      at(t) { time = t; v.dispatchEvent(new Event('timeupdate')); },
      length(d) { duration = d; v.dispatchEvent(new Event('durationchange')); },
      plays(t = time) { time = t; paused = false; v.dispatchEvent(new Event('play')); v.dispatchEvent(new Event('playing')); },
      paused() { v.pause(); },
    };
    window.progress = [];
    p.addEventListener('progress', (e) => window.progress.push(e.detail.time));
    const url = 'https://cdn.example/one.mkv';
    p.open({ stream: { url, name: 'Example Example 1080p' }, meta: { title: 'Invented film' }, sourceId: 'a',
      sources: [{ id: 'a', label: 'Example · Example 1080p', stream: { url, name: 'Example Example 1080p' } }, { id: 'b', label: 'Other 720p', stream: { url: 'https://cdn.example/two.mkv', name: 'Other 720p' } }], ...open });
  }, { open, prefs, second });
  const cdp = await context.newCDPSession(page);
  const touch = (type, points = []) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y, id = 0]) => ({ x, y, id })) });
  return { page, errors, touch };
}

const press = (page, label) => page.evaluate((label) => {
  const b = [...p.root.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === label || b.textContent.trim() === label);
  if (!b) throw new Error('No button ' + label);
  b.click();
}, label);
// Measured once the controls have come in (they arrive as groups, moving: player/controls.js), the endless ones aside.
const box = (page, selector) => page.evaluate(async (s) => {
  await Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {})));
  const r = p.root.querySelector(s).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height };
}, selector);

test('Speed opens the Playback menu; the chosen speed is shown, saved, put back on the next film, and hold returns to it', opts, async (t) => {
  const { page, touch, errors } = await player(t);
  await page.evaluate(() => fake.plays(30));
  const speed = await box(page, '.ap-text-btn');
  assert.ok(speed.h >= 44, 'a finger-sized target');
  await page.touchscreen.tap(speed.x + speed.w / 2, speed.y + speed.h / 2);
  assert.equal(await page.evaluate(() => p.modal.getAttribute('aria-label')), 'Playback');
  assert.deepEqual(await page.evaluate(() => [...p.modal.querySelectorAll('[aria-label^="Speed "]')].map((b) => b.textContent)), ['0.5x', '0.75x', '1x', '1.25x', '1.5x', '1.75x', '2x']);
  await press(page, 'Speed 1.25');
  assert.deepEqual(await page.evaluate(() => ({ rate: p.video.playbackRate, pitch: p.video.preservesPitch, button: p.speedBtn.textContent, saved: JSON.parse(localStorage.getItem('astra.v2.player')).speed, marked: p.modal.querySelector('[aria-label="Speed 1.25"]').getAttribute('aria-pressed') })),
    { rate: 1.25, pitch: true, button: 'Speed 1.25x', saved: 1.25, marked: 'true' });
  await page.keyboard.press('Escape');
  // The next film: the browser resets the rate with the new source; the player puts it back.
  await page.evaluate(() => { p.open({ stream: { url: 'https://cdn.example/next.mkv' }, meta: { title: 'Next' } }); p.video.playbackRate = 1; p.video.dispatchEvent(new Event('loadedmetadata')); fake.plays(5); });
  assert.equal(await page.evaluate(() => p.video.playbackRate), 1.25);
  await touch('touchStart', [[422, 120, 1]]);
  await outlast(page, 500);
  assert.equal(await page.evaluate(() => p.video.playbackRate), 2, 'hold plays at 2x');
  await touch('touchEnd');
  assert.equal(await page.evaluate(() => p.video.playbackRate), 1.25, 'and gives the chosen speed back');
  assert.deepEqual(errors, []);
});

test('a volume swipe to nothing is remembered, and the next film opens with "Sound off" showing; brightness is kept too', opts, async (t) => {
  const { page, touch } = await player(t, { prefs: { brightness: 0.6 } });
  assert.equal(await page.evaluate(() => p.dim.style.opacity), '0.4', 'the saved brightness on open');
  await page.evaluate(() => { fake.plays(5); p.video.volume = 0.3; });
  await touch('touchStart', [[720, 120, 1]]);
  for (let y = 130; y <= 330; y += 20) await touch('touchMove', [[720, y, 1]]);
  await touch('touchEnd');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('astra.v2.player')).volume), 0);
  await page.evaluate(() => { p.video.volume = 1; p.open({ stream: { url: 'https://cdn.example/x.mkv' }, meta: { title: 'Another' } }); });
  assert.deepEqual(await page.evaluate(() => ({ volume: p.video.volume, chip: p.mutedChip.hidden })), { volume: 0, chip: false });
});

test('the sleep timer counts down quietly, pauses the film with a notice, survives the next episode and ends with the player', opts, async (t) => {
  const { page } = await player(t, { clock: true, open: { next: { label: 'S1 E2', title: 'Two' } } });
  await page.evaluate(() => fake.plays(30));
  await press(page, 'Speed 1x');
  await press(page, 'Sleep timer 15 min');
  assert.equal(await page.evaluate(() => p.modal.querySelector('.ap-sleep-status').textContent), 'Pauses in 15:00');
  await page.keyboard.press('Escape');
  await page.evaluate(() => p.showControls());
  assert.deepEqual(await page.evaluate(() => [p.sleepEl.hidden, p.sleepEl.textContent]), [false, 'Sleep 15:00']);
  // The next episode in the same session keeps it.
  await page.evaluate(() => { p.open({ stream: { url: 'https://cdn.example/e2.mkv' }, meta: { title: 'Invented film', episodeLine: 'S1 E2' } }); fake.plays(1); });
  await page.clock.runFor(14 * 60 * 1000);
  assert.equal(await page.evaluate(() => p.video.paused), false);
  await page.clock.runFor(61 * 1000);
  assert.deepEqual(await page.evaluate(() => ({ paused: p.video.paused, notice: p.noticeEl.textContent, saved: window.progress.length > 0, left: p.sleepEl.hidden })), { paused: true, notice: 'Sleep timer: paused', saved: true, left: true });
  // End of episode: no next-episode card near the end; closing clears it.
  await page.evaluate(() => { p.open({ stream: { url: 'https://cdn.example/e3.mkv' }, meta: { title: 'Invented film' }, next: { label: 'S1 E4', title: 'Four' } }); fake.plays(2990); });
  assert.equal(await page.evaluate(() => p.nextCard.hidden), false, 'without the timer the card shows near the end');
  await page.evaluate(() => { p.extras.sleep.set('episode'); fake.at(2991); });
  assert.equal(await page.evaluate(() => p.nextCard.hidden), true, 'with it, not offered');
  await page.evaluate(() => p.close());
  assert.equal(await page.evaluate(() => p.extras.sleep.timer), null, 'closed: nothing left counting');
});

test('a resume past a minute offers "Start over" in the notice; a source switch does not', opts, async (t) => {
  const { page } = await player(t, { open: { startTime: 4200 } });
  await page.evaluate(() => fake.plays(4200));
  assert.equal(await page.evaluate(() => p.noticeEl.hidden ? null : p.noticeEl.querySelector('span').textContent), 'Resumed at 1:10:00');
  const notice = await box(page, '.ap-notice');
  assert.ok(notice.y + notice.h < 390 / 2, 'across the top, not the picture’s middle');
  await press(page, 'Start over');
  assert.deepEqual(await page.evaluate(() => [p.video.currentTime, p.noticeEl.hidden]), [0, true]);
  // Opened at a saved place, then another source before the first frame: no offer.
  await page.evaluate(() => { p.open({ stream: { url: 'https://cdn.example/a.mkv', name: 'A' }, meta: { title: 'Invented film' }, startTime: 4200, sourceId: 'a', sources: [{ id: 'a', label: 'A', stream: { url: 'https://cdn.example/a.mkv' } }, { id: 'b', label: 'B', stream: { url: 'https://cdn.example/b.mkv' } }] }); p.menus.pickSource(p.sources[1]); fake.plays(4200); });
  assert.equal(await page.evaluate(() => p.noticeEl.hidden), true);
});

test('segments and chapters mark the seek bar; skip times arriving late update Skip; the bubble and stream info name chapters', opts, async (t) => {
  const { page, errors } = await player(t, { open: { segments: [{ type: 'recap', start: 0, end: 60 }] } });
  await page.evaluate(() => { fake.plays(100); p.showControls(false); });
  assert.equal(await page.evaluate(() => p.marks.querySelectorAll('.ap-segment.recap').length), 1);
  // Found later, with the playhead already inside the intro: Skip is offered at once.
  await page.evaluate(() => p.setSegments([{ type: 'recap', start: 0, end: 60 }, { type: 'intro', start: 90, end: 150 }]));
  assert.deepEqual(await page.evaluate(() => [p.marks.querySelectorAll('.ap-segment').length, p.skipBtn.hidden, p.skipBtn.textContent]), [2, false, 'Skip Intro']);
  await page.evaluate(() => { p.engine.chapters = [{ start: 0, end: 1000, title: 'Opening' }, { start: 1000, end: 1001, title: 'Too close' }, { start: 1001, end: 3000, title: 'The long middle' }]; p.engine.dispatchEvent(new Event('tracks')); });
  assert.equal(await page.evaluate(() => p.marks.querySelectorAll('.ap-tick').length), 1, 'ticks closer than 6 px are dropped');
  const bar = await box(page, '.ap-timeline');
  await page.mouse.move(bar.x + bar.w * 0.8, bar.y + bar.h / 2);
  await page.mouse.down();
  assert.equal(await page.evaluate(() => p.bubble.querySelector('small')?.textContent), 'The long middle');
  const bubble = await box(page, '.ap-bubble');
  assert.ok(bubble.x >= 0 && bubble.x + bubble.w <= 844, 'the bubble stays on screen');
  await page.mouse.up();
  await press(page, 'Stream info');
  assert.deepEqual(await page.evaluate(() => [...p.modal.querySelectorAll('.ap-chapters .ap-row b')].map((b) => b.textContent)), ['Opening', 'Too close', 'The long middle']);
  await page.evaluate(() => [...p.modal.querySelectorAll('.ap-chapters .ap-row')].at(-1).click());
  assert.deepEqual(await page.evaluate(() => [p.video.currentTime, p.menus.open]), [1001, null]);
  assert.deepEqual(errors, []);
});

test('fine seeking on a two-hour film: a hint, slid up the drag slows from where it is, the bubble rises, released it seeks', opts, async (t) => {
  const { page, errors } = await player(t);
  await page.evaluate(() => { fake.length(7200); fake.plays(100); p.showControls(false); });
  const bar = await box(page, '.ap-timeline'), y = bar.y + bar.h / 2, x = bar.x + bar.w / 2;
  const now = () => page.evaluate(() => [p.scrub.time, [...p.bubble.querySelectorAll('small')].map((s) => s.textContent).join('|')]);
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + 10, y);
  const [onBar, hint] = await now();
  assert.ok(Math.abs(onBar - 3600 - (10 / bar.w) * 7200) < 1, `on the bar 10 px is ${Math.round(onBar - 3600)} s`);
  assert.equal(hint, 'Slide up for fine seeking');
  await page.mouse.move(x + 10, y - 100); // straight up: no jump
  assert.equal((await now())[0], onBar);
  await page.mouse.move(x + 20, y - 100);
  const [fine, label] = await now();
  assert.ok(Math.abs(fine - onBar - (10 / bar.w) * 7200 / 8) < 0.5 && label === 'Fine seeking', `${fine - onBar} s, ${label}`);
  const bubble = await box(page, '.ap-bubble');
  assert.ok(bubble.y + bubble.h < y - 100, 'the bubble sits above the finger');
  await page.waitForFunction(() => getComputedStyle(p.root.querySelector('.ap-center')).opacity === '0', null, { timeout: 2000 }); // the middle buttons make way
  await page.mouse.move(x + 20, y); // back on the bar: the place found is kept
  assert.equal((await now())[0], fine);
  await page.mouse.up();
  assert.deepEqual(await page.evaluate(() => [p.video.currentTime, p.prefs.fineSeeks, p.bubble.hidden]), [fine, 1, true]);
  // A short film's bar is left as it was: no hint, and up is still under the finger.
  await page.evaluate(() => { fake.length(300); });
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 10, y - 100);
  assert.deepEqual(await now(), [((x + 10 - bar.x) / bar.w) * 300, '']);
  await page.mouse.up();
  assert.deepEqual(errors, []);
});

test('subtitle delay moves by 0.1 s or 1 s, reads "+1.1 s", resets, and z/x nudge it', opts, async (t) => {
  const { page } = await player(t);
  await page.evaluate(() => fake.plays(5));
  await press(page, 'Subtitles');
  await press(page, 'Style');
  await press(page, 'Delay up 1 second');
  await press(page, 'Delay up');
  assert.equal(await page.evaluate(() => p.modal.querySelector('.ap-step.wrap b').textContent), '+1.1 s');
  await press(page, 'Delay down 1 second');
  await press(page, 'Delay down 1 second');
  assert.equal(await page.evaluate(() => p.modal.querySelector('.ap-step.wrap b').textContent), '−0.9 s');
  await press(page, 'Reset');
  assert.equal(await page.evaluate(() => p.engine.subtitles.delay), 0);
  await page.keyboard.press('Escape');
  await page.keyboard.press('x'); await page.keyboard.press('x'); await page.keyboard.press('z'); await page.keyboard.press('x');
  assert.equal(await page.evaluate(() => p.engine.subtitles.delay), 0.2);
});

test('"Find a line" filters a 1,500-line track without accents or case, draws 200 rows as text, and goes a second before the line', opts, async (t) => {
  const { page } = await player(t);
  await page.evaluate(() => {
    fake.plays(5);
    const ts = (s) => `00:${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')},000`;
    const lines = Array.from({ length: 1500 }, (_, i) => `${i + 1}\n${ts(i + 10)} --> ${ts(i + 11)}\n${i === 700 ? 'Où est la <b>GARE</b> ?' : i === 900 ? '<img src=x onerror="window.hit=1">gare' : 'Line ' + i}\n`);
    const id = p.engine.addSubtitleTrack({ text: lines.join('\n'), label: 'Invented', format: 'x.srt', language: 'fr' });
    p.engine.selectSubtitle(id);
  });
  await press(page, 'Subtitles');
  await press(page, 'Find a line');
  assert.equal(await page.evaluate(() => p.modal.getAttribute('aria-label')), 'Find a line');
  await page.waitForFunction(() => p.modal.querySelectorAll('.ap-line').length === 200, null, { timeout: 2000 }); // the first 30 at once, the rest a frame later
  assert.deepEqual(await page.evaluate(() => [p.modal.querySelectorAll('.ap-line').length, p.modal.querySelector('.ap-find-count').textContent]), [200, '1,500 lines: showing the first 200, refine to see more']);
  await page.locator('.ap-find-input').fill('ou est la gare');
  await outlast(page, 200);
  assert.deepEqual(await page.evaluate(() => [...p.modal.querySelectorAll('.ap-line')].map((b) => b.textContent)), ['11:50Où est la GARE ?']);
  await page.locator('.ap-find-input').fill('GARE');
  await outlast(page, 200);
  assert.equal(await page.evaluate(() => p.modal.querySelectorAll('.ap-line img').length + (window.hit || 0)), 0, 'subtitle text stays text');
  await page.evaluate(() => p.modal.querySelector('.ap-line').click());
  assert.deepEqual(await page.evaluate(() => [p.video.currentTime, p.menus.open]), [709, null]);
});

test('the second subtitle: a row in Tracks when the engine can show one, its own layer above the first, absent otherwise', opts, async (t) => {
  const { page } = await player(t, { second: true });
  assert.equal(await page.evaluate(() => window.secondLayer === p.subs2El && p.subs2El.nextElementSibling === p.subsEl), true, 'handed to the engine, just under the first track’s layer');
  await page.evaluate(() => {
    for (const [label, language] of [['English', 'en'], ['Français', 'fr']]) p.engine.addSubtitleTrack({ text: '1\n00:00:01,000 --> 00:00:02,000\nHi\n', label, language, format: 'x.srt' });
    p.engine.selectSubtitle(p.engine.subtitleOptions()[0].id);
  });
  await press(page, 'Subtitles');
  await page.evaluate(() => [...p.modal.querySelectorAll('.ap-row')].find((b) => b.textContent.startsWith('Second subtitle')).click());
  assert.equal(await page.evaluate(() => p.modal.querySelector('h3').textContent), 'Second subtitle');
  await page.evaluate(() => [...p.modal.querySelectorAll('.ap-rail.languages .ap-row')].find((b) => b.textContent.startsWith('French')).click());
  await page.evaluate(() => p.modal.querySelector('.ap-rail.tracks .ap-row').click());
  assert.deepEqual(await page.evaluate(() => window.secondCalls), ['ext:2']);
  await press(page, 'Back to the first');
  assert.equal(await page.evaluate(() => [...p.modal.querySelectorAll('.ap-row')].find((b) => b.textContent.startsWith('Second subtitle')).querySelector('small').textContent), 'Français', 'the row names the second track');
  const plain = await player(t, { second: 'none' }); // an engine without a second track
  await plain.page.evaluate(() => p.engine.addSubtitleTrack({ text: '1\n00:00:01,000 --> 00:00:02,000\nHi\n', label: 'English', language: 'en', format: 'x.srt' }));
  await press(plain.page, 'Subtitles');
  assert.equal(await plain.page.evaluate(() => [...p.modal.querySelectorAll('button')].some((b) => b.textContent.includes('Second subtitle'))), false);
});

test('A–B repeat loops the part, shows two pins, and ends when the owner seeks away', opts, async (t) => {
  const { page } = await player(t);
  await page.evaluate(() => fake.plays(100));
  await press(page, 'Speed 1x');
  await press(page, 'Set start (A)');
  await page.evaluate(() => fake.at(100.5));
  await press(page, 'Set end (B)');
  assert.match(await page.evaluate(() => p.feedback.textContent), /at least a second/);
  await page.evaluate(() => fake.at(130));
  await press(page, 'Set end (B)');
  assert.deepEqual(await page.evaluate(() => [p.video.currentTime, [...p.timeline.querySelectorAll('.ap-pin')].map((i) => i.hidden)]), [100, [false, false]], 'at B it went back to A');
  await page.evaluate(() => { p.video.dispatchEvent(new Event('seeking')); fake.at(125); fake.at(130.2); p.video.dispatchEvent(new Event('seeking')); });
  assert.equal(await page.evaluate(() => p.video.currentTime), 100, 'and again');
  await page.evaluate(() => { p.video.currentTime = 900; p.video.dispatchEvent(new Event('seeking')); });
  assert.deepEqual(await page.evaluate(() => [p.extras.repeat.range, p.timeline.querySelector('.ap-pin').hidden]), [null, true]);
});

test('paused, frame step buttons sit beside play and move one frame; a still downloads as "<title> <time>.png", or says the host forbids it', opts, async (t) => {
  const { page } = await player(t);
  await page.evaluate(() => { fake.plays(60); p.showControls(false); });
  assert.equal(await page.evaluate(() => getComputedStyle(p.root.querySelector('[aria-label="Next frame"]')).display), 'none', 'playing: no frame steps');
  await page.evaluate(() => fake.paused());
  const next = await box(page, '[aria-label="Next frame"]'), play = await box(page, '.ap-play');
  assert.ok(next.w >= 44 && next.h >= 44 && Math.abs(next.y + next.h / 2 - (play.y + play.h / 2)) < 2 && next.x > play.x + play.w, 'beside play, finger-sized');
  await page.touchscreen.tap(next.x + next.w / 2, next.y + next.h / 2);
  assert.ok(Math.abs(await page.evaluate(() => p.video.currentTime) - (60 + 1 / 24)) < 1e-9);
  // A real film: from another host played directly, unreadable; with CORS, saved.
  const url = host.url('open.webm'); // VP9: every browser the tests run in decodes it
  const still = (crossOrigin) => page.evaluate(async ({ url, crossOrigin }) => {
    for (const k of ['paused', 'duration', 'currentTime']) delete p.video[k];
    if (crossOrigin) p.video.crossOrigin = 'anonymous'; else p.video.removeAttribute('crossorigin');
    p.video.src = url; p.video.muted = true;
    await new Promise((r) => { p.video.onloadeddata = () => { p.video.currentTime = 1; }; p.video.onseeked = r; });
    await p.extras.frames.save();
    return p.noticeEl.textContent;
  }, { url, crossOrigin });
  assert.equal(await still(false), "This film's host does not allow saving a frame");
  const [download] = await Promise.all([page.waitForEvent('download'), still(true)]);
  assert.equal(download.suggestedFilename(), 'Invented film 0.01.png');
});

test('two fingers zoom the picture (and the filter’s layer), one finger then pans within bounds, double tap still seeks, aspect resets', opts, async (t) => {
  const { page, touch } = await player(t);
  await page.evaluate(() => { fake.plays(100); p.hideControls(); }); // the picture itself, not the buttons over it
  await touch('touchStart', [[380, 195, 1]]);
  await touch('touchStart', [[380, 195, 1], [460, 195, 2]]);
  for (let d = 40; d <= 160; d += 20) await touch('touchMove', [[420 - d, 195, 1], [420 + d, 195, 2]]);
  await touch('touchEnd', [[580, 195, 2]]);
  await touch('touchEnd');
  const zoom = await page.evaluate(() => ({ scale: p.touch.zoom.scale, transform: p.stage.style.transform, layers: p.pictureLayer.parentElement === p.stage && p.subsEl.parentElement !== p.stage, rate: p.video.playbackRate }));
  assert.equal(zoom.scale, 4, 'from 80 px apart to 320: 4x, the most');
  assert.match(zoom.transform, /scale\(4\)/);
  assert.equal(zoom.layers, true, 'the picture filter’s layer zooms with the video; subtitles stay readable');
  assert.equal(zoom.rate, 1, 'no hold');
  const from = await page.evaluate(() => { p.hideControls(); return p.touch.zoom.x; });
  await touch('touchStart', [[300, 200, 1]]);
  for (let x = 320; x <= 820; x += 100) await touch('touchMove', [[x, 200, 1]]);
  await touch('touchEnd');
  assert.deepEqual(await page.evaluate((from) => [Math.round(p.touch.zoom.x - from), p.video.currentTime], from), [520, 100], 'panned by the drag, and no seek');
  await page.touchscreen.tap(780, 200); await page.touchscreen.tap(780, 200);
  await outlast(page, 350);
  assert.equal(await page.evaluate(() => p.video.currentTime), 110, 'double tap on the right: +10 s');
  await press(page, 'Picture size');
  assert.deepEqual(await page.evaluate(() => [p.touch.zoom.scale, p.stage.style.transform]), [1, '']);
  await press(page, 'Lock controls');
  await touch('touchStart', [[380, 195, 1]]); await touch('touchStart', [[380, 195, 1], [460, 195, 2]]);
  await touch('touchMove', [[300, 195, 1], [540, 195, 2]]); await touch('touchEnd');
  assert.equal(await page.evaluate(() => p.touch.zoom.scale), 1, 'no zoom while locked');
});

test('Sound only covers the picture, lets the screen sleep and turns off leaving-the-app picture-in-picture; Show picture undoes it', opts, async (t) => {
  const { page } = await player(t);
  await page.evaluate(() => fake.plays(100));
  await outlast(page, 50);
  assert.equal(await page.evaluate(() => window.wake.held), 1);
  await press(page, 'Speed 1x');
  await press(page, 'Sound only');
  assert.deepEqual(await page.evaluate(() => ({ cover: p.soundCover.hidden, menu: p.menus.open, title: p.soundCover.querySelector('.ap-so-title').textContent, wake: window.wake.held, pip: p.video.autoPictureInPicture })),
    { cover: false, menu: null, title: 'Invented film', wake: 0, pip: false });
  await page.evaluate(() => { fake.paused(); p.video.play(); });
  await outlast(page, 50);
  assert.equal(await page.evaluate(() => window.wake.held), 0, 'playing again does not take the lock back');
  await press(page, 'Show picture');
  await outlast(page, 50);
  assert.deepEqual(await page.evaluate(() => [p.soundCover.hidden, window.wake.held]), [true, 1]);
});

test('stream info shows data used when the engine counts it, refreshed while open; the source line names the add-on once', opts, async (t) => {
  const { page } = await player(t, { clock: true });
  assert.equal(await page.evaluate(() => p.viaEl.textContent), 'Via Example 1080p');
  await press(page, 'Stream info');
  assert.equal(await page.evaluate(() => p.modal.querySelector('.ap-data-used')), null, 'not shown without engine.dataUsed');
  await page.keyboard.press('Escape');
  await page.evaluate(() => { window.used = 412e6; p.engine.dataUsed = () => window.used; });
  await press(page, 'Stream info');
  assert.equal(await page.evaluate(() => p.modal.querySelector('.ap-data-used').textContent), '412 MB so far');
  await page.evaluate(() => { window.used = 1.5e9; });
  await page.clock.runFor(2100);
  assert.equal(await page.evaluate(() => p.modal.querySelector('.ap-data-used').textContent), '1.50 GB so far');
});

test('the lab reads its stream from #src= or ?src= and takes it out of the address at once', opts, async (t) => {
  const context = await browser.newContext({ viewport: LANDSCAPE });
  t.after(() => context.close());
  const page = await context.newPage();
  for (const where of ['#src=', '?src=']) {
    await page.goto(`${base}/astra/lab/${where}${encodeURIComponent('https://cdn.example/a.mkv?token=invented')}${where[0] === '#' ? '&t=5' : '#keep'}`);
    await page.waitForFunction(() => window.astraLab);
    const address = await page.evaluate(() => location.href);
    assert.ok(!address.includes('cdn.example') && !address.includes('token'), address);
    assert.equal(await page.evaluate(() => document.getElementById('placeholder').hidden), true, 'and it was opened');
  }
});

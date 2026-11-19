// What connects Astra's finished pieces to the player, in a real browser: the audio menu's Sound tab
// (player/sound-menu.js over enhance/sound.js), the Picture section of Stream info (player/picture-menu.js
// over enhance/picture.js), skip times found by sound or looked up (app/skip.js) reaching the Skip button
// (player/markers.js), and the new Settings › Playback rows. Real PlayerScreen and real engine playing the
// films in tests/fixtures/astra/ from another origin (tests/fixtures/astra-host.mjs): multi.mkv plays in
// remux mode, surround.mkv's Dolby Digital is converted by the engine (delivery 'rebuilt'), plain.mp4
// plays natively and the page may not read it. Engine methods that do not exist yet are stubbed and
// their calls recorded: setAudioAdvance, setDialogue, setDataSaver, setSoundTap. The finder is faked;
// AniSkip's two hosts are intercepted, so nothing here reaches the internet.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { astraHost } from './fixtures/astra-host.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (synthetic films)' };
let site, host, browser, base, h264 = false;

before(async () => {
  if (live) return;
  site = await serve(0, {});
  base = `http://127.0.0.1:${site.address().port}`;
  host = await astraHost();
  browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'], ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  const page = await browser.newPage();
  h264 = await page.evaluate(() => MediaSource.isTypeSupported('video/mp4; codecs="avc1.4d400d"'));
  await page.close();
});
after(async () => { await browser?.close(); site?.close(); await host?.close(); });

/** The lab page with a real PlayerScreen as `window.p`; `film(url, title)` opens and plays one, `calls` records the stubbed engine methods. */
async function player(t, { prefs = null } = {}) {
  host.reset();
  const context = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
  t.after(() => context.close());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/astra/lab/`);
  await page.evaluate(async (prefs) => {
    if (prefs) localStorage.setItem('astra.v2.player', JSON.stringify(prefs));
    window.wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const { AstraPlayer } = await import('/astra/src/engine/player.js');
    window.calls = { advance: [], dialogue: [], saver: [], tap: [] };
    AstraPlayer.prototype.setAudioAdvance = (s) => window.calls.advance.push(s);
    AstraPlayer.prototype.setDialogue = (s) => window.calls.dialogue.push(s);
    AstraPlayer.prototype.setDataSaver = (s) => window.calls.saver.push(s);
    AstraPlayer.prototype.setSoundTap = (tap) => window.calls.tap.push(tap);
    const { PlayerScreen } = await import('/astra/src/player/player-screen.js');
    const p = (window.p = new PlayerScreen());
    window.film = async (url, title) => {
      const ready = new Promise((r) => p.engine.addEventListener('ready', r, { once: true }));
      p.open({ stream: { url, name: 'Example 1080p' }, meta: { id: title, title } });
      await ready;
      await new Promise((r) => { const on = () => (p.video.currentTime > 0.3 ? r() : setTimeout(on, 50)); on(); });
      return p.engine.mode;
    };
  }, prefs);
  const click = (selector) => page.locator(selector).first().click();
  return { page, errors, click };
}

test('the Sound tab changes the real Sound, the boost chip shows, and saved choices come back on the next film', opts, async (t) => {
  if (!h264) return t.skip('this browser has no H.264 decoder');
  const { page, errors, click } = await player(t);
  assert.equal(await page.evaluate((u) => film(u, 'Film one'), host.url('multi.mkv')), 'remux');
  assert.deepEqual(await page.evaluate(() => calls.saver), ['auto'], 'the data saver is set before the load');
  await page.evaluate(() => p.menus.openModal('audio'));
  await click('.ap-modal .ap-tab:has-text("Sound")');
  assert.equal(await page.locator('.ap-sound-why').count(), 0, 'no reason: this film can be changed');
  await click('[aria-label="Volume boost 200 %"]');
  await click('[aria-label="Night mode"]');
  await click('[aria-label="Dialogue +1"]');
  await click('[aria-label="Sound earlier"]');
  const early = await page.evaluate(() => ({ s: p.extras.sound.sound.state(), advance: calls.advance.at(-1), shown: document.querySelector('.ap-sound-delay').textContent }));
  assert.deepEqual(early.s.settings, { boost: 2, night: true, dialogue: 1, delay: 0 }, 'earlier sound is not the page\'s own delay');
  assert.equal(early.advance, 0.05, 'the engine is asked for sound 0.05 s earlier');
  assert.equal(early.shown, '−0.05 s');
  await click('[aria-label="Sound later"]');
  await click('[aria-label="Sound later"]');
  const late = await page.evaluate(async () => { await wait(300); return { s: p.extras.sound.sound.state(), advance: calls.advance.at(-1) }; });
  assert.equal(late.s.settings.delay, 0.05, 'later sound is the page\'s own delay');
  assert.equal(late.advance, 0);
  assert.equal(late.s.captured, true, 'the sound runs through the chain');
  await page.evaluate(() => p.menus.dismiss());
  await page.evaluate(() => p.showControls(false));
  assert.equal(await page.locator('.ap-boost').textContent(), 'Boost 200 %');
  assert.ok(await page.locator('.ap-boost').isVisible(), 'the boost chip shows with the controls');
  await click('.ap-boost');
  assert.equal(await page.evaluate(() => p.menus.modalName + '/' + p.menus.audioTab), 'audio/sound', 'a tap on the chip opens the Sound tab');
  await page.evaluate(() => p.menus.dismiss());
  // Picture: the stream-info menu's section.
  await page.evaluate(() => p.menus.openModal('info'));
  await click('[aria-label="Sharpen Medium"]');
  await click('[aria-label="Smooth banding"]');
  const pic = await page.evaluate(async () => { for (let i = 0; i < 40 && !p.extras.picture.picture.state().shown; i++) await wait(50); return p.extras.picture.picture.state(); });
  assert.deepEqual(pic.settings, { sharpen: 0.65, deband: true });
  assert.equal(pic.shown, true, 'the filtered picture is drawn over the video');
  assert.equal(await page.evaluate(() => document.querySelector('.ap-picture-layer canvas.astra-picture') !== null), true, 'in the player\'s picture layer');
  // Pinch-zoomed, the canvas keeps the video's untransformed box: the stage's transform scales both once.
  const z = await page.evaluate(() => {
    const zoom = p.touch.zoom, pic = p.extras.picture.picture;
    Object.assign(zoom, { scale: 2, x: 0, y: 0 }); zoom.apply(); pic.place();
    const out = { w: parseFloat(pic.canvas.style.width), vw: p.video.offsetWidth, shown: pic.canvas.getBoundingClientRect().width, video: p.video.getBoundingClientRect().width };
    zoom.reset(); return out;
  });
  assert.equal(z.w, z.vw, 'sized to the video before the zoom');
  assert.ok(Math.abs(z.shown - z.video) < 1, `and on screen as wide as the zoomed video (${z.shown} vs ${z.video})`);
  // A phone that falls behind: the filter steps itself down, and says so once.
  const stepped = await page.evaluate(() => { const pic = p.extras.picture.picture; pic.stepDown(); const first = p.noticeEl.textContent; p.noticeEl.textContent = ''; pic.stepDown(); return { first, again: p.noticeEl.textContent, level: pic.state().level }; });
  assert.equal(stepped.first, 'Sharpening turned itself down to keep the film smooth.');
  assert.equal(stepped.again, '', 'once per film');
  assert.ok(stepped.level >= 2);
  await page.evaluate(() => p.menus.dismiss());
  // The next film: boost, night, dialogue and the picture come back; the timing starts at 0.
  await page.evaluate((u) => film(u, 'Film two'), host.url('multi.mkv'));
  const next = await page.evaluate(() => ({ s: p.extras.sound.sound.state().settings, pic: p.extras.picture.picture.state().settings, saved: JSON.parse(localStorage.getItem('astra.v2.player')) }));
  assert.deepEqual(next.s, { boost: 2, night: true, dialogue: 1, delay: 0 });
  assert.deepEqual(next.pic, { sharpen: 0.65, deband: true });
  assert.equal(next.saved.boost, 2); assert.equal(next.saved.sharpen, 0.65); assert.equal(next.saved.delay, undefined, 'the timing is not saved');
  assert.deepEqual(errors, []);
});

test('a converted 5.1 track lifts dialogue in the engine; a film the page cannot read says why and plays as it is', opts, async (t) => {
  if (!h264) return t.skip('this browser has no H.264 decoder');
  const { page, errors } = await player(t, { prefs: { boost: 2, dialogue: 2 } });
  await page.evaluate((u) => film(u, 'Surround film'), host.url('surround.mkv'));
  const r = await page.evaluate(() => ({ delivery: p.engine.audioOptions().find((a) => a.selected)?.delivery, dialogue: calls.dialogue.at(-1), s: p.extras.sound.sound?.state().settings }));
  if (r.delivery === 'rebuilt') {
    assert.equal(r.dialogue, 2, 'the engine lifts the centre of the sound it converts');
    assert.equal(r.s.dialogue, 0, 'and the page does not lift it again');
    assert.equal(r.s.boost, 2);
  } else t.diagnostic(`surround.mkv played as ${r.delivery}: the rebuilt path was not exercised`);
  // plain.mp4 plays natively from the other origin: nothing captures it; the tab says why, its chips are disabled.
  const p2 = await player(t, { prefs: { boost: 2 } });
  assert.equal(await p2.page.evaluate((u) => film(u, 'Plain film'), host.url('plain.mp4') + '?nocors'), 'native');
  await p2.page.evaluate(() => { p.menus.audioTab = 'sound'; p.menus.openModal('audio'); });
  const n = await p2.page.evaluate(async () => {
    const t0 = p.video.currentTime; await wait(600);
    return { why: document.querySelector('.ap-sound-why')?.textContent, disabled: document.querySelector('[aria-label="Volume boost 200 %"]').disabled, sound: p.extras.sound.sound,
      muted: p.video.muted, volume: p.video.volume, moved: p.video.currentTime - t0, chip: !document.querySelector('.ap-boost').hidden };
  });
  assert.match(n.why, /straight from its host/);
  assert.equal(n.disabled, true, 'disabled rather than hidden');
  assert.equal(n.sound, null, 'the element\'s sound was never taken, so it plays with sound');
  assert.equal(n.muted, false); assert.equal(n.volume, 1);
  assert.ok(n.moved > 0.3, 'and it plays');
  assert.equal(n.chip, false, 'no boost chip when the boost is not on the sound');
  assert.deepEqual([...errors, ...p2.errors], []);
});

/** A player on a faked clock (no film) with app/skip.js and a faked finder; `fake.at(t)` moves the playhead. */
async function skipPlayer(t, { settings, next = null }) {
  const context = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
  t.after(() => context.close());
  await context.addCookies([{ name: 'invented', value: '1', domain: 'api.aniskip.com', path: '/' }, { name: 'invented', value: '1', domain: 'api.ani.zip', path: '/' }]);
  const requests = [];
  await context.route(/https:\/\/api\.(aniskip\.com|ani\.zip)\//, (route) => {
    const r = route.request(), url = r.url();
    requests.push({ url, headers: r.headers() });
    const body = url.includes('ani.zip') ? { mappings: { mal_id: 5150 } }
      : { found: true, results: [{ skipType: 'recap', interval: { startTime: 0, endTime: 50 }, episodeLength: 1440 }, { skipType: 'op', interval: { startTime: 95, endTime: 185 }, episodeLength: 1440 }] };
    route.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/astra/lab/`);
  await page.evaluate(async ({ settings, next }) => {
    window.wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const { AstraPlayer } = await import('/astra/src/engine/player.js');
    window.taps = [];
    AstraPlayer.prototype.setSoundTap = (tap) => window.taps.push(tap);
    const { PlayerScreen } = await import('/astra/src/player/player-screen.js');
    const { SkipTimes } = await import('/astra/src/app/skip.js');
    const p = (window.p = new PlayerScreen());
    p.engine.load = async () => {};
    const v = p.video;
    let time = 0, paused = false;
    Object.defineProperties(v, { paused: { get: () => paused, configurable: true }, duration: { get: () => 1440, configurable: true }, currentTime: { get: () => time, set: (x) => { time = x; }, configurable: true } });
    v.play = async () => { paused = false; }; v.pause = () => { paused = true; };
    window.fake = { at(x) { time = x; v.dispatchEvent(new Event('timeupdate')); } };
    window.progress = [];
    p.addEventListener('progress', (e) => window.progress.push(e.detail.time));
    class Finder { constructor(o) { window.finder = this; this.o = o; this.fed = 0; } wants() { return true; } feed() { this.fed++; } close() { this.closed = true; } }
    const store = { known: async () => null };
    window.skip = new SkipTimes(p, { settings: () => settings, Finder, store });
    p.open({ stream: { url: 'https://cdn.example/ep3.mkv', name: 'Example 1080p' }, meta: { id: 'kitsu:5150', title: 'Invented show', episodeLine: 'S1E3' }, next });
    window.skip.episode({ series: { type: 'series', id: 'kitsu:5150' }, video: 'kitsu:5150:3', season: 1, episode: 3 });
    p.engine.mode = 'remux';
    p.engine.dispatchEvent(new CustomEvent('ready'));
    time = 1; v.dispatchEvent(new Event('playing')); v.dispatchEvent(new Event('timeupdate')); // the first frame: the loading screen goes
    for (let i = 0; i < 40 && !window.finder; i++) await wait(25);
  }, { settings, next });
  return { page, errors, requests };
}

test('segments found by sound reach the Skip button, even mid-segment; Skip waits for a tap and saves the new place; no lookup while it is off', opts, async (t) => {
  const { page, errors, requests } = await skipPlayer(t, { settings: { skipLookup: false } });
  const tap = await page.evaluate(() => { const tap = taps.at(-1); tap.feed([new Float32Array(480)], 48000, 1); return { wants: tap.wants(10, 1), fed: finder.fed, series: finder.o.series, video: finder.o.video, duration: finder.o.duration }; });
  assert.deepEqual(tap, { wants: true, fed: 1, series: { type: 'series', id: 'kitsu:5150' }, video: 'kitsu:5150:3', duration: 1440 }, 'the engine\'s sound reaches the finder');
  // The playhead is already inside the intro when the finder reports it.
  await page.evaluate(() => { fake.at(120); finder.o.onSegments([{ type: 'intro', start: 100, end: 190 }, { type: 'recap', start: 0, end: 60 }]); });
  assert.equal(await page.locator('.ap-skip').isVisible(), true, 'Skip is offered at once');
  assert.equal(await page.locator('.ap-skip span').textContent(), 'Skip Intro');
  assert.deepEqual(await page.evaluate(() => p.markers.segments.map((s) => s.type)), ['intro'], 'a recap never comes from the sound');
  await page.waitForTimeout(800);
  assert.equal(await page.evaluate(() => (fake.at(p.video.currentTime), p.video.currentTime)), 120, 'nothing skips by itself');
  await page.locator('.ap-skip').click();
  const after = await page.evaluate(() => ({ time: p.video.currentTime, saved: progress.at(-1), shown: !p.skipBtn.hidden }));
  assert.deepEqual(after, { time: 190, saved: 190, shown: false }, 'the skip lands at the intro\'s end and that is the saved place');
  // A later answer with other times for the same kind does not offer it again.
  await page.evaluate(() => { finder.o.onSegments([{ type: 'intro', start: 100, end: 200 }]); fake.at(192); });
  // (the button's copy fading out where it was, aria-hidden, is not the button)
  assert.equal(await page.locator('.ap-skip:not([aria-hidden])').isVisible(), false, 'an intro already skipped stays skipped');
  await page.evaluate(() => skip.stop());
  assert.deepEqual(await page.evaluate(() => ({ closed: finder.closed, tap: taps.at(-1) })), { closed: true, tap: null }, 'leaving the episode closes the finder and clears the tap');
  assert.equal(requests.length, 0, 'with the lookup off, nothing is asked of AniSkip');
  assert.deepEqual(errors, []);
});

test('with the lookup on: exactly two requests, no cookies, no referrer; looked-up segments win by kind; the outro gives way to the next-episode card', opts, async (t) => {
  const { page, errors, requests } = await skipPlayer(t, { settings: { skipLookup: true }, next: { label: 'S1E4', title: 'Next one' } });
  await page.evaluate(() => finder.o.onSegments([{ type: 'intro', start: 100, end: 190 }, { type: 'outro', start: 1350, end: 1430 }]));
  await page.waitForFunction(() => p.markers.segments.some((s) => s.type === 'recap'));
  assert.deepEqual(await page.evaluate(() => p.markers.segments), [{ type: 'recap', start: 0, end: 50 }, { type: 'intro', start: 95, end: 185 }, { type: 'outro', start: 1350, end: 1430 }]);
  assert.deepEqual(requests.map((r) => r.url), ['https://api.ani.zip/mappings?kitsu_id=5150', 'https://api.aniskip.com/v2/skip-times/5150/3?types=op&types=ed&types=mixed-op&types=mixed-ed&types=recap&episodeLength=1440']);
  for (const r of requests) { assert.equal(r.headers.cookie, undefined, 'no cookies'); assert.equal(r.headers.referer, undefined, 'no referrer'); }
  await page.evaluate(() => fake.at(10));
  assert.equal(await page.locator('.ap-skip span').textContent(), 'Skip Recap');
  // In the outro, which runs to the end: the next-episode card is the one action.
  await page.evaluate(() => fake.at(1360));
  assert.deepEqual(await page.evaluate(() => ({ card: !p.nextCard.hidden, skip: !p.skipBtn.hidden })), { card: true, skip: false });
  await page.locator('.ap-next-close').click();
  await page.evaluate(() => fake.at(1361));
  assert.deepEqual(await page.evaluate(() => ({ card: !p.nextCard.hidden, skip: !p.skipBtn.hidden })), { card: false, skip: true }, 'with the card dismissed, Skip Outro is back');
  assert.deepEqual(errors, []);
});

test('Settings › Playback: the skip switches and the data saver persist, and the lookup starts off', opts, async (t) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  t.after(() => context.close());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/astra/`);
  const playback = async () => {
    await page.waitForFunction(() => window.astra?.navButtons);
    await page.locator('.nav-item[data-tab="settings"]').click();
    await page.locator('.settings .set-row', { hasText: 'Getting ready, skip intro' }).click();
    await page.waitForSelector('.settings-page');
  };
  await playback();
  const sw = (name) => page.locator('.settings-page label.set-row', { hasText: name }).locator('input');
  assert.equal(await sw('Find intros by sound').isChecked(), true, 'finding by sound is on by default');
  assert.equal(await sw('Look up anime skip times').isChecked(), false, 'the lookup is off by default');
  await page.locator('.settings-page label.set-row', { hasText: 'Find intros by sound' }).click();
  await page.locator('.settings-page label.set-row', { hasText: 'Look up anime skip times' }).click();
  await page.locator('.settings-page .set-row', { hasText: 'Save mobile data' }).locator('button', { hasText: 'Never' }).click();
  await page.reload();
  await playback();
  assert.equal(await sw('Find intros by sound').isChecked(), false);
  assert.equal(await sw('Look up anime skip times').isChecked(), true);
  assert.equal(await page.locator('.settings-page .set-row', { hasText: 'Save mobile data' }).locator('button[aria-pressed="true"]').textContent(), 'Never');
  const saved = await page.evaluate(() => ({ settings: JSON.parse(localStorage.getItem('astra.v2.settings')), player: JSON.parse(localStorage.getItem('astra.v2.player')) }));
  assert.equal(saved.settings.findIntros, false); assert.equal(saved.settings.skipLookup, true, 'in Astra\'s settings, which a backup carries');
  assert.equal(saved.player.dataSaver, 'never');
  assert.deepEqual(errors, []);
});

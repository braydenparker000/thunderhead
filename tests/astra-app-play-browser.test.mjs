// The real Astra app playing real (small, synthetic) films end to end: an invented add-on (answered
// here by route interception) lists streams on the test's file host (tests/fixtures/astra-host.mjs);
// the owner opens a series episode and taps a stream, and in the real player: the film's chapters
// show on the seek bar, Skip intro's sound tap is fed, Stream info says what it has downloaded "so far", the Sound tab's controls
// are on and change what is really applied in remux mode, Find a line lists the embedded SRT
// track's lines, another source from the Sources panel with a styled (ASS) track is drawn by libass,
// and nothing raises a page error. Local only: nothing here reaches the internet.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { astraHost } from './fixtures/astra-host.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (invented add-on, synthetic films)', timeout: 60_000 };
const ADDON = 'https://addon.example';
const META = { id: 'tt0000201', type: 'series', name: 'An Invented Series', description: 'Invented for the test.', videos: [{ id: 'tt0000201:1:1', season: 1, episode: 1, title: 'The first' }, { id: 'tt0000201:1:2', season: 1, episode: 2, title: 'The second' }] };
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

test('the app plays an episode: chapters, data used, the Sound tab, Find a line, and a styled track drawn by libass', opts, async (t) => {
  if (!h264) return t.skip('this browser has no H.264 decoder');
  const context = await browser.newContext({ viewport: { width: 844, height: 390 } });
  t.after(() => context.close());
  await context.route(`${ADDON}/**`, (route) => {
    const u = new URL(route.request().url());
    const json = (v) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(v) });
    if (u.pathname === '/manifest.json') return json({ id: 'example', name: 'Example', version: '1.0.0', resources: ['meta', 'stream'], types: ['series'], idPrefixes: ['tt'], catalogs: [] });
    if (u.pathname.startsWith('/meta/series/')) return json({ meta: META });
    if (u.pathname.startsWith('/stream/')) return json({ streams: [
      { name: 'Multi', title: 'Ep 1 360p x264 💾 1 MB', url: host.url('multi.mkv') },
      { name: 'Signs', title: 'Ep 1 360p x264 subs 💾 1 MB', url: host.url('anime.mkv') },
    ] });
    return route.fulfill({ status: 404, body: '' });
  });
  await context.route('https://v3-cinemeta.strem.io/**', (route) => route.fulfill({ status: 404, body: '' }));
  await context.route('https://api.opensubtitles.com/**', (route) => route.fulfill({ status: 404, body: '' }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/astra/`);
  await page.evaluate((url) => localStorage.setItem('astra.v2.addons', JSON.stringify([{ url: `${url}/manifest.json`, enabled: true, name: 'Example' }])), ADDON);
  await page.goto(`${base}/astra/`);
  await page.waitForFunction(() => window.astra?.openStreams);
  await page.evaluate((meta) => window.astra.openStreams(meta, meta.videos[0]), META);
  // The owner's tap on a stream.
  await page.locator('.screen.streams .stream-card', { hasText: 'Multi' }).click();
  await page.waitForFunction(() => { const p = window.astra.player; return p?.isOpen && p.engine.mode === 'remux' && p.video.currentTime > 0.5; }, null, { timeout: 20_000 });
  const p = { click: (label) => page.evaluate((label) => document.querySelector(`.ap [aria-label="${label}"]`).click(), label) };
  // Chapters on the bar: multi.mkv has three (0, 8 and 50 s), so two boundaries.
  await page.waitForFunction(() => document.querySelectorAll('.ap .ap-tick').length >= 2, null, { timeout: 5_000 });
  // Skip intro listens: the app's skip.js gave the engine a sound tap for this episode, and it is fed.
  await page.waitForFunction(() => window.astra.player.engine.tapFeed?.stats.chunks > 0, null, { timeout: 10_000 });
  // Stream info: what this film has downloaded so far.
  await p.click('Stream info');
  await page.waitForFunction(() => /\d+ MB so far/.test(document.querySelector('.ap .ap-data-used')?.textContent || ''), null, { timeout: 5_000 });
  assert.match(await page.locator('.ap .ap-chapters').textContent(), /Opening.*The story.*Credits/);
  await page.evaluate(() => window.astra.player.menus.dismiss());
  // The Sound tab: enabled, and its changes reach the page's Sound and the engine.
  await p.click('Audio');
  await page.locator('.ap .ap-tab', { hasText: 'Sound' }).click();
  assert.equal(await page.locator('.ap .ap-sound-why').count(), 0, 'no reason the sound cannot be changed');
  assert.equal(await page.locator('.ap .ap-sound button:disabled').count(), 1, 'every control on (but Reset, with no delay set)');
  await page.locator('.ap [aria-label="Volume boost 200 %"]').click();
  await page.locator('.ap [aria-label="Dialogue +1"]').click();
  await page.locator('.ap [aria-label="Sound earlier"]').click();
  await page.locator('.ap [aria-label="Sound earlier"]').click();
  const sound = await page.evaluate(() => { const p = window.astra.player, s = p.extras.sound.sound?.state().settings; return { boost: s?.boost, dialogue: s?.dialogue, advance: p.engine.audioAdvance, session: p.engine.session.advance, delay: p.modal.querySelector('.ap-sound-delay').textContent }; });
  assert.deepEqual(sound, { boost: 2, dialogue: 1, advance: 0.1, session: 0.1, delay: '−0.10 s' }, 'boost and dialogue on the page\'s sound (AAC, passed through), the sound 0.1 s earlier in the engine');
  assert.ok(await page.evaluate(() => !document.querySelector('.ap .ap-boost').hidden), 'the boost chip shows');
  await page.locator('.ap .ap-sound button', { hasText: 'Reset' }).click();
  await page.waitForFunction(() => window.astra.player.engine.session.advance === 0);
  await page.evaluate(() => window.astra.player.menus.dismiss());
  // Find a line: the embedded SRT track chosen in the Subtitles menu, then searched.
  await p.click('Subtitles');
  await page.locator('.ap .ap-rail.tracks .ap-row', { hasText: 'Built-in' }).first().click();
  await page.waitForFunction(() => (window.astra.player.engine.cues.get(window.astra.player.engine.selectedSubtitle) || []).length >= 3);
  await page.evaluate(() => window.astra.player.menus.renderModal());
  await page.locator('.ap .ap-find').click();
  await page.locator('.ap .ap-find-input').fill('line');
  await page.waitForFunction(() => document.querySelectorAll('.ap .ap-line').length === 3);
  assert.deepEqual(await page.locator('.ap .ap-line span').allTextContents(), ['First line inside the film', 'A line at twenty seconds', 'A line at forty seconds']);
  await page.evaluate(() => window.astra.player.menus.dismiss());
  // Another source from the Sources panel: the film with a styled track, drawn by libass with its own font.
  await p.click('Sources');
  await page.locator('.ap .ap-source', { hasText: 'Signs' }).click();
  await page.waitForFunction(() => { const p = window.astra.player; return p.engine.url?.includes('anime.mkv') && p.engine.mode === 'remux' && p.ready; }, null, { timeout: 20_000 });
  await p.click('Subtitles');
  await page.locator('.ap .ap-rail.tracks .ap-row', { hasText: 'Signs' }).click();
  await page.waitForFunction(() => window.astra.player.engine.subtitles.libassDraws, null, { timeout: 30_000 });
  await page.evaluate(() => window.astra.player.menus.dismiss());
  const lit = await page.evaluate(async () => {
    const v = window.astra.player.video;
    v.pause(); v.currentTime = 3;
    await new Promise((r) => v.addEventListener('seeked', r, { once: true }));
    await new Promise((r) => setTimeout(r, 700));
    const canvas = document.querySelector('.ap canvas.astra-sub-libass'), W = canvas.clientWidth, H = canvas.clientHeight;
    const g = new OffscreenCanvas(W, H).getContext('2d');
    g.drawImage(canvas, 0, 0, W, H);
    const d = g.getImageData(0, 0, W, H).data;
    let n = 0; for (let i = 3; i < d.length; i += 4) n += d[i] > 0;
    return n;
  });
  assert.ok(lit > 500, `libass draws the signs in the real player (${lit} pixels)`);
  assert.ok(await page.evaluate(() => window.astra.player.engine.log.some((l) => l.kind === 'fonts' && /Inter-Bold/.test(String(l.detail)))), 'with the film\'s attached font');
  assert.deepEqual(errors, []);
});

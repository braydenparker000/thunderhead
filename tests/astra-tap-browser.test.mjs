// From a tap to the first picture in the real Astra app (frontend/astra/src/app/ready.js, next-ready.js):
// an invented add-on lists Torrentio-style TorBox links (answered here by route interception, as is
// TorBox with an invented token, and the film host behind it is the test's own, tests/fixtures/astra-host.mjs).
// With "Get ready ahead" on, the owner's list is read once when Streams shows, a press starts the resolve
// and the tap takes it, the plain MP4 plays through Astra's own unpacking with sound and a data count, and
// the next episode is made ready so Next needs no add-on or TorBox request; with the switch off or the data
// saver on, nothing is asked before a tap; nothing ever plays without one. The switch persists in Settings.
// Every DNS answer but the local host's is refused, so no request or connection can leave for a real host.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { astraHost } from './fixtures/astra-host.mjs';
import { outlast } from './fixtures/waits.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (invented add-on, TorBox stand-in, synthetic films)', timeout: 60_000 };
const ADDON = 'https://addon.example';
const TOKEN = 'invented-token';
const HASH = (n) => n.toString(16).padStart(40, '0');
const FILES = { 1: 'plain.mp4', 2: 'open.webm', 3: 'plain.mp4' }; // torrent -> the film the host serves for it
const META = { id: 'tt0000401', type: 'series', name: 'An Invented Series', description: 'Invented for the test.',
  videos: [{ id: 'tt0000401:1:1', season: 1, episode: 1, title: 'The first' }, { id: 'tt0000401:1:2', season: 1, episode: 2, title: 'The second' }] };
const link = (n) => `https://torrentio.strem.fun/resolve/torbox/${TOKEN}/${HASH(n)}/Film%20${n}.mp4/0/Film%20${n}.mp4`;
const STREAMS = {
  'tt0000401:1:1': [{ name: 'TB 360p', title: 'Ep 1 x264 AAC', url: link(1), behaviorHints: { bingeGroup: 'invented-group' } }, { name: 'TB 360p', title: 'Ep 1 VP9', url: link(2) }],
  'tt0000401:1:2': [{ name: 'TB 360p', title: 'Ep 2 VP9', url: link(2) }, { name: 'TB 360p', title: 'Ep 2 x264 AAC', url: link(3), behaviorHints: { bingeGroup: 'invented-group' } }],
};
let site, host, browser, base, h264 = false;

before(async () => {
  if (live) return;
  site = await serve(0, {});
  base = `http://127.0.0.1:${site.address().port}`;
  host = await astraHost();
  browser = await chromium.launch({ args: ['--no-proxy-server', '--autoplay-policy=no-user-gesture-required', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'], ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  const page = await browser.newPage();
  h264 = await page.evaluate(() => MediaSource.isTypeSupported('video/mp4; codecs="avc1.4d400d"'));
  await page.close();
});
after(async () => { await browser?.close(); site?.close(); await host?.close(); });

/** The app with the invented add-on, TorBox and the film host routed; `seen` counts what was asked of each. */
async function app(t, { settings = {}, player = { dataSaver: 'never' } } = {}) {
  host.reset();
  const seen = { list: 0, link: 0, streams: 0, films: 0, elsewhere: [] };
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  t.after(() => context.close());
  const json = (route, v) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(v) });
  await context.route((url) => !/^(http:\/\/127\.0\.0\.1|https:\/\/(addon\.example|api\.torbox\.app|cdn\.example)\/)/.test(url.href), (route) => { seen.elsewhere.push(new URL(route.request().url()).host); return route.abort(); });
  for (const known of ['https://v3-cinemeta.strem.io/**', 'https://opensubtitles-v3.strem.io/**', 'https://api.opensubtitles.com/**']) await context.route(known, (route) => route.fulfill({ status: 404, body: '' }));
  await context.route(`${ADDON}/**`, (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === '/manifest.json') return json(route, { id: 'example', name: 'Example', version: '1.0.0', resources: ['meta', 'stream'], types: ['series'], idPrefixes: ['tt'], catalogs: [] });
    if (u.pathname.startsWith('/meta/series/')) return json(route, { meta: META });
    if (u.pathname.startsWith('/stream/')) { seen.streams++; return json(route, { streams: STREAMS[decodeURIComponent(u.pathname.split('/').pop().replace(/\.json$/, ''))] || [] }); }
    return route.fulfill({ status: 404, body: '' });
  });
  await context.route('https://api.torbox.app/**', (route) => {
    const u = new URL(route.request().url());
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization' } });
    if (u.pathname.endsWith('/torrents/mylist')) { seen.list++; return json(route, { success: true, data: [1, 2, 3].map((n) => ({ id: n, hash: HASH(n), files: [{ id: 5, short_name: `Film ${n}.mp4` }] })) }); }
    if (u.pathname.endsWith('/torrents/requestdl')) { seen.link++; return json(route, { success: true, data: `https://cdn.example/${u.searchParams.get('torrent_id')}/${FILES[u.searchParams.get('torrent_id')]}` }); }
    return route.fulfill({ status: 404, body: '' });
  });
  // The file's host, behind an https address as TorBox's are: the test's own host answers.
  await context.route('https://cdn.example/**', async (route) => {
    seen.films++;
    const file = new URL(route.request().url()).pathname.split('/').pop();
    return route.fulfill({ response: await route.fetch({ url: host.url(file) }) });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/astra/`);
  await page.evaluate(([url, settings, player]) => {
    localStorage.setItem('astra.v2.addons', JSON.stringify([{ url: `${url}/manifest.json`, enabled: true, name: 'Example' }]));
    localStorage.setItem('astra.v2.settings', JSON.stringify(settings));
    localStorage.setItem('astra.v2.player', JSON.stringify(player));
  }, [ADDON, settings, player]);
  await page.goto(`${base}/astra/`);
  await page.waitForFunction(() => window.astra?.openStreams);
  const streams = async (n = 0) => {
    await page.evaluate(([meta, n]) => window.astra.openStreams(meta, meta.videos[n]), [META, n]);
    await page.waitForSelector('.screen.streams .stream-card');
  };
  const card = (text) => page.locator('.screen.streams .stream-card', { hasText: text });
  const nothingPlays = async () => {
    await outlast(page, 600);
    return page.evaluate(() => ({ player: !!window.astra.player?.isOpen, playing: [...document.querySelectorAll('video')].filter((v) => !v.paused).length }));
  };
  return { page, errors, seen, streams, card, nothingPlays };
}

test('switch on: the list is read once when Streams shows, a press starts the resolve and the tap takes it, and the plain MP4 plays unpacked, with sound and a data count', opts, async (t) => {
  if (!h264) return t.skip('this browser has no H.264 decoder');
  const a = await app(t);
  await a.streams();
  await a.page.waitForFunction(() => document.head.querySelector('link[rel="preconnect"][href="https://api.torbox.app"]'));
  assert.deepEqual(await a.nothingPlays(), { player: false, playing: 0 }, 'nothing plays without a tap');
  assert.deepEqual([a.seen.list, a.seen.link, a.seen.films], [1, 0, 0], 'the owner’s list read once; no stream resolved, no film touched');
  // A finger comes down, then the press turns into a scroll.
  await a.card('Ep 1 x264').dispatchEvent('pointerdown');
  await a.card('Ep 1 x264').dispatchEvent('pointercancel');
  await a.page.waitForFunction(() => document.head.querySelector('link[rel="preconnect"][href="https://cdn.example"]'));
  assert.deepEqual([a.seen.list, a.seen.link, a.seen.films], [1, 1, 0], 'the press resolved the address, and nothing else');
  assert.deepEqual(await a.nothingPlays(), { player: false, playing: 0 }, 'a press is not a tap');
  await a.card('Ep 1 x264').click();
  await a.page.waitForFunction(() => { const p = window.astra.player; return p?.isOpen && p.engine.mode === 'remux' && p.video.currentTime > 0.5; }, null, { timeout: 20_000 });
  assert.deepEqual([a.seen.list, a.seen.link], [1, 1], 'the tap took the answer under way: no TorBox request of its own');
  const film = await a.page.evaluate(() => { const e = window.astra.player.engine; return { audio: e.audioOptions().map((o) => o.delivery), buffered: e.session?.queues.audio?.buffer.buffered.length > 0, used: e.dataUsed() }; });
  assert.deepEqual(film.audio, ['direct']);
  assert.ok(film.buffered, 'its sound is buffered');
  assert.ok(film.used > 0, `what it cost is counted (${film.used} bytes)`);
  assert.deepEqual(a.seen.elsewhere, []);
  assert.deepEqual(a.errors, []);
});

test('the data saver on, or the switch off: nothing is asked before a tap; off, the tap resolves as it did', opts, async (t) => {
  for (const [settings, player] of [[{}, { dataSaver: 'always' }], [{ readyAhead: false }, { dataSaver: 'never' }]]) {
    const a = await app(t, { settings, player });
    await a.streams();
    await a.card('Ep 1 x264').dispatchEvent('pointerdown');
    await a.card('Ep 1 x264').dispatchEvent('pointercancel');
    assert.deepEqual(await a.nothingPlays(), { player: false, playing: 0 });
    assert.deepEqual([a.seen.list, a.seen.link, a.seen.films], [0, 0, 0], `nothing asked of TorBox or the host (${JSON.stringify({ settings, player })})`);
    assert.equal(await a.page.evaluate(() => document.head.querySelectorAll('link[rel="preconnect"]').length), 0, 'no connection opened');
    if (settings.readyAhead === false && h264) {
      await a.card('Ep 1 x264').click();
      await a.page.waitForFunction(() => window.astra.player?.engine.mode === 'remux' && window.astra.player.video.currentTime > 0.3, null, { timeout: 20_000 });
      assert.deepEqual([a.seen.list, a.seen.link], [1, 1], 'the tap resolved it');
      assert.equal(await a.page.evaluate(() => window.astra.nextReady.prepare()), null, 'and the next episode is not made ready');
      assert.equal(a.seen.streams, 1, 'not even its streams asked for');
    }
    assert.deepEqual(a.seen.elsewhere, []);
    assert.deepEqual(a.errors, []);
  }
});

test('the next episode is made ready from the same release; Next then shows its picture without an add-on or TorBox request', opts, async (t) => {
  if (!h264) return t.skip('this browser has no H.264 decoder');
  const a = await app(t);
  await a.streams();
  await a.card('Ep 1 x264').click();
  await a.page.waitForFunction(() => window.astra.player?.engine.mode === 'remux' && window.astra.player.video.currentTime > 0.3 && window.astra.nextReady, null, { timeout: 20_000 });
  const job = await a.page.evaluate(async () => { const j = await window.astra.nextReady.prepare(); return j && { described: j.described, bytes: j.bytes, all: j.all?.length }; });
  assert.deepEqual([job?.described, job?.all], [true, 2], 'collected, and the same release’s file described');
  t.diagnostic(`making the next episode ready cost ${job.bytes} bytes of the film`);
  assert.ok(job.bytes > 0 && job.bytes < 1_000_000, 'describing only');
  const asked = { streams: a.seen.streams, list: a.seen.list, link: a.seen.link };
  assert.deepEqual(asked, { streams: 2, list: 1, link: 2 });
  await a.page.evaluate(() => window.astra.player.markers.playNext());
  await a.page.waitForFunction(() => { const p = window.astra.player; return p.engine.url?.includes('/3/') && p.engine.mode === 'remux' && p.video.currentTime > 0.3; }, null, { timeout: 20_000 });
  assert.deepEqual({ streams: a.seen.streams, list: a.seen.list, link: a.seen.link }, asked, 'Next asked no add-on and no TorBox');
  assert.equal(await a.page.evaluate(() => window.astra.playing.video.id), 'tt0000401:1:2');
  assert.deepEqual(a.seen.elsewhere, []);
  assert.deepEqual(a.errors, []);
});

test('Settings › Playback: "Get ready ahead" is on by default and persists, in Astra’s settings', opts, async (t) => {
  const a = await app(t, { settings: {} });
  const playback = async () => {
    await a.page.locator('.nav-item[data-tab="settings"]').click();
    await a.page.locator('.settings .set-row', { hasText: 'Gestures, skip intro' }).click();
    await a.page.waitForSelector('.settings-page');
  };
  await playback();
  const row = a.page.locator('.settings-page label.set-row', { hasText: 'Get ready ahead' });
  assert.equal(await row.locator('input').isChecked(), true, 'on by default');
  await row.scrollIntoViewIfNeeded();
  if (process.env.ASTRA_SHOTS) await a.page.screenshot({ path: `${process.env.ASTRA_SHOTS}/ready-ahead-setting.png` });
  await row.click();
  await a.page.reload();
  await a.page.waitForFunction(() => window.astra?.navButtons);
  await playback();
  assert.equal(await a.page.locator('.settings-page label.set-row', { hasText: 'Get ready ahead' }).locator('input').isChecked(), false);
  assert.equal(await a.page.evaluate(() => JSON.parse(localStorage.getItem('astra.v2.settings')).readyAhead), false, 'in Astra’s settings, which a backup carries');
  assert.deepEqual(a.errors, []);
});

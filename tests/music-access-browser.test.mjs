// Music when it can't reach the owner's songs, and across a reload, in Chromium (MUSIC.md §6.3, §11):
// - the library can't load (signed out, or a failure): Music says so in its own toast, Play is the way
//   on (sign-in, or a try again that works), and it loads by itself when the session or the connection
//   is back;
// - the session expires after the library loaded: the song stops, Play shows, the toast says sign-in is
//   needed, and nothing more is asked for until the session is back;
// - a reload mid-song keeps the place (to within a second or two), and the clock shows it at once.
// The library and its songs are stubbed on the old Worker's URL (never reached); the songs are
// invented Opus tones. Local only.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';
import { longTone } from './fixtures/ogg-make.mjs';
import { until } from './fixtures/waits.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (stubbed library)', timeout: 120_000 };
const OLD = 'https://jarvis-hub-api.braydenparker999.workers.dev';
const SONG = Buffer.from(longTone(20));
const idOf = (i) => `r2_native_${(i + 10).toString(16).repeat(64).slice(0, 64)}`;
const INDEX = {
  version: 1, kind: 'r2-library', complete: true, count: 6, generatedAt: '2026-10-30T00:00:00.000Z',
  tracks: Array.from({ length: 6 }, (_, i) => ({ id: idOf(i), path: `Cloudflare R2/Album/${i}.opus`, size: SONG.length, mimeType: 'audio/ogg', metadata: { title: `Song ${i}`, artist: 'An Invented Band', album: 'Album', dur: 60, codec: 'opus', sr: 48000 } })),
};
const SIGN_IN = 'Sign in to play your songs.';
let site, browser, base;

before(async () => {
  if (live) return;
  site = await serve(0, {});
  base = `http://127.0.0.1:${site.address().port}`;
  browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--autoplay-policy=no-user-gesture-required'] });
});
after(async () => {
  await browser?.close();
  site?.close();
});

/** A phone whose old-Worker answers follow `stub.catalog` and `stub.audio` (200, or a refusal's status). */
async function phone() {
  const stub = { catalog: 200, audio: 200, calls: [] };
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route(`${OLD}/**`, (route) => {
    const req = route.request(), url = req.url();
    stub.calls.push(url);
    const refuse = (status) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ error: status === 401 ? SIGN_IN : 'failed' }) });
    if (url.endsWith('/music/library.json')) return stub.catalog === 200 ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(INDEX) }) : refuse(stub.catalog);
    if (url.includes('/music/library/audio/')) {
      if (stub.audio !== 200) return refuse(stub.audio);
      const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers().range ?? '');
      const head = { 'Content-Type': 'audio/ogg', 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges' };
      if (!range) return route.fulfill({ status: 200, headers: head, body: SONG });
      const a = Number(range[1]), b = range[2] ? Math.min(Number(range[2]), SONG.length - 1) : SONG.length - 1;
      return route.fulfill({ status: 206, headers: { ...head, 'Content-Range': `bytes ${a}-${b}/${SONG.length}` }, body: SONG.subarray(a, b + 1) });
    }
    return route.fulfill({ status: 404 });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return { stub, context, page, errors };
}
const shown = (page) => page.evaluate(() => document.body.innerText);
const signIn = (page, token) => page.evaluate((t) => new Promise((resolve) => {
  const req = indexedDB.open('th-auth', 1);
  req.onupgradeneeded = () => req.result.createObjectStore('kv');
  req.onsuccess = () => { const tx = req.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put({ session_id: 's', token: t, signed_in_at: Date.now() }, 'session'); tx.oncomplete = () => { req.result.close(); resolve(); }; };
}), token);
const press = (page) => page.evaluate(() => window.__cp.ctx.bus.post('bus_player_cmd', 'cmd_player_toggle_playing', null, {}));

test('signed out with no library: Music says sign-in is needed, Play goes to it, and the songs come once the session is back', opts, async () => {
  const { stub, context, page, errors } = await phone();
  stub.catalog = 401;
  await page.goto(`${base}/music/`);
  await until(async () => (await shown(page)).includes(SIGN_IN), { message: 'the sign-in words show' });
  // Signed in again (another tab): the library loads by itself.
  stub.catalog = 200;
  await signIn(page, `th1_${'E'.repeat(49)}`);
  await until(() => page.evaluate(() => window.__cp.player.queue.length === 6), { message: 'the library loaded once the session was back' });
  assert.equal(await page.evaluate(() => window.__cp.ctx.access.state), null, 'and the words went');
  assert.deepEqual(errors, []);
  await context.close();
  // Signed out, a fresh phone: Play goes to the sign-in door, and back to Music after it.
  const again = await phone();
  const other = again.page;
  again.stub.catalog = 401;
  await other.goto(`${base}/music/`);
  await until(async () => (await shown(other)).includes(SIGN_IN), { message: 'the sign-in words show again' });
  await press(other);
  await other.waitForURL((u) => u.pathname === '/signin/' && u.searchParams.get('next') === '/music/', { timeout: 15_000 });
  await again.context.close();
});

test('the library fails to load: Music says so, Play tries again, and a connection back loads it by itself', opts, async () => {
  const { stub, context, page, errors } = await phone();
  stub.catalog = 500;
  await page.goto(`${base}/music/`);
  await until(async () => (await shown(page)).includes("Couldn't load your songs."), { message: 'the failure shows' });
  stub.catalog = 503;
  await press(page);
  await until(async () => stub.calls.filter((u) => u.endsWith('library.json')).length >= 2 && !(await page.evaluate(() => window.__cp.ctx.access.retrying)), { message: 'Play tried again' });
  stub.catalog = 200;
  await press(page);
  await until(() => page.evaluate(() => window.__cp.player.queue.length === 6), { message: 'the second try loaded it' });
  assert.equal(await page.evaluate(() => window.__cp.ctx.access.state), null, 'and the words went');
  assert.deepEqual(errors, []);
  await context.close();
  // A fresh phone with the connection down: the songs come when it is back, with no tap.
  const again = await phone();
  const other = again.page;
  again.stub.catalog = 500;
  await other.goto(`${base}/music/`);
  await until(async () => (await shown(other)).includes("Couldn't load your songs."), { message: 'the failure shows again' });
  again.stub.catalog = 200;
  await other.evaluate(() => window.dispatchEvent(new Event('online')));
  await until(() => other.evaluate(() => window.__cp.player.queue.length === 6), { message: 'the connection back loaded it' });
  assert.deepEqual(again.errors, []);
  await again.context.close();
});

test('the session expires mid-library: the song stops, Play shows, sign-in is asked for, and nothing more goes out until the session is back', opts, async () => {
  const { stub, context, page, errors } = await phone();
  await page.goto(`${base}/music/`);
  await until(() => page.evaluate(() => window.__cp?.player?.queue?.length === 6), { message: 'the library loaded' });
  stub.audio = 401;
  await page.evaluate(() => window.__cp.player.load(3, true));
  // Stopped, with Play showing and no try again waiting.
  await until(() => page.evaluate(() => { const p = window.__cp.player; return p.state !== 1 && p.audio.paused && !p.guard.timer && !p.guard.stallTimer && !p.audio._stream; }), { message: 'the player stopped' });
  await until(async () => (await shown(page)).includes(SIGN_IN), { message: 'the sign-in words show' });
  const stopped = stub.calls.length;
  // The session back (read every 3 s): nothing went out meanwhile, and Play plays the song again.
  stub.audio = 200;
  await signIn(page, `th1_${'F'.repeat(49)}`);
  await until(() => page.evaluate(() => window.__cp.ctx.access.state === null), { message: 'the words went once the session was back' });
  assert.deepEqual(stub.calls.slice(stopped), [], 'no request while signed out');
  await press(page);
  await until(() => page.evaluate(() => window.__cp.player.audio.currentTime > 0.5), { message: 'the song plays again' });
  assert.deepEqual(errors, []);
  await context.close();
});

test('a reload mid-song keeps the place, and the clock shows it at once', opts, async () => {
  const { context, page, errors } = await phone();
  await page.goto(`${base}/music/`);
  await until(() => page.evaluate(() => window.__cp?.player?.queue?.length === 6), { message: 'the library loaded' });
  await page.evaluate(() => window.__cp.player.load(2, true));
  await until(() => page.evaluate(() => window.__cp.player.positionMs() >= 7000), { timeout: 30_000, message: 'the song played 7 s' });
  const was = await page.evaluate(() => window.__cp.player.positionMs());
  await page.reload();
  await until(() => page.evaluate(() => window.__cp?.player?.track?.title === 'Song 2'), { message: 'the song came back' });
  const now = await page.evaluate(() => ({ pos: window.__cp.player.positionMs(), clock: document.body.innerText.match(/\d+:\d\d/)?.[0] }));
  assert.ok(Math.abs(now.pos - was) <= 2000, `the place within 2 s (${was} then ${now.pos})`);
  const [m, s] = now.clock.split(':').map(Number);
  assert.ok(Math.abs(m * 60 + s - now.pos / 1000) <= 1, `the clock shows the place (${now.clock} at ${now.pos} ms)`);
  assert.deepEqual(errors, []);
  await context.close();
});

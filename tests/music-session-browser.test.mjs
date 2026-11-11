// The music player across a reload, in Chromium (frontend/music/src/player/session.js): an album
// playing shuffled, with a Queue waiting, comes back as that album with the same play order, the
// same song and the same Queue. The library is a stubbed index of invented songs (the old Worker's
// URL, never reached); nothing plays, so no audio is asked for.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (stubbed library)', timeout: 120_000 };
const OLD = 'https://jarvis-hub-api.braydenparker999.workers.dev';
const idOf = (i) => `r2_native_${(i + 10).toString(16).repeat(64).slice(0, 64)}`;
const INDEX = {
  version: 1, kind: 'r2-library', complete: true, count: 24, generatedAt: '2026-10-30T00:00:00.000Z',
  tracks: Array.from({ length: 24 }, (_, i) => ({ id: idOf(i), path: `Cloudflare R2/Album ${i >> 3}/${String(i).padStart(2, '0')}.opus`, size: 4_000_000, mimeType: 'audio/ogg', metadata: { title: `Song ${i}`, artist: 'An Invented Band', album: `Album ${i >> 3}`, dur: 240 } })),
};
let site, browser, base;

before(async () => {
  if (live) return;
  site = await serve(0, {});
  base = `http://127.0.0.1:${site.address().port}`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => {
  await browser?.close();
  site?.close();
});

test('an album playing shuffled, its Queue and its song come back after a reload', opts, async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route(`${OLD}/**`, (route) => (route.request().url().endsWith('/music/library.json') ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(INDEX) }) : route.fulfill({ status: 404 })));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const ready = () => page.waitForFunction(() => window.__cp?.player?.queue?.length >= 1 && window.__cp.library.tracks.length === 24, null, { timeout: 30_000 });
  const read = () => page.evaluate(() => { const p = window.__cp.player; p.ensureOrder(); return { list: p.queue.map((t) => t.title), order: [...p.order], song: p.track.title, shuffle: p.shuffle, queued: p.entries.map((e) => e.track.title), pending: p.pendingQueue, next: p.trackAt(2)?.title }; });

  await page.goto(`${base}/music/`);
  await ready();
  // The second album (8 songs), from its third song, shuffled, two steps on, and a song queued.
  await page.evaluate(() => {
    const { player, library } = window.__cp;
    player.setQueue(library.tracks.filter((t) => t.album === 'Album 1'), 2);
    player.command('cmd_player_set_shuffle', { arg1: 1 });
    player.step(1); player.step(1);
    player.enqueue([library.tracks.find((t) => t.title === 'Song 20')]);
  });
  const was = await read();
  assert.equal(was.list.length, 8);
  assert.equal(was.shuffle, 1);
  assert.deepEqual(was.queued, ['Song 20']);
  // What a hidden page saves is what a closed tab leaves behind.
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForFunction(async () => (await window.__cp.library.db.getState('queue-list'))?.ids?.length === 8);

  await page.reload();
  await ready();
  const now = await read();
  assert.deepEqual(now.list, was.list, 'the album, not the whole library');
  assert.deepEqual(now.order, was.order, 'the same play order');
  assert.equal(now.song, was.song);
  assert.deepEqual(now.queued, ['Song 20']);
  assert.equal(now.pending, true, 'the Queue still waits for the current song to end');
  assert.equal(now.next, was.next, 'and the song after it is the one it would have been');
  assert.deepEqual(errors, []);
  await context.close();
});

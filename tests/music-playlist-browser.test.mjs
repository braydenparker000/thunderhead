// A playlist the mind makes (MUSIC.md §10.2), in Chromium: the phone's `music.create_playlist`
// executor writes it into the player's own storage; "Open in Music" (`/music/#pl=<id>`) opens the
// player on that playlist with its tracks; its undo removes it, but not once the owner has changed
// it. And the DJ shuffle (MUSIC.md §9): a sixth mode in the real player whose plan follows the
// tags and which learns a skip. The player's library comes from a stubbed index (the old Worker's
// URL, never reached).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

const live = Boolean(process.env.SITE_URL);
const opts = { skip: live && 'local only (stubbed library)' };
const OLD = 'https://jarvis-hub-api.braydenparker999.workers.dev';
const ids = ['a', 'b', 'c'].map((c) => `r2_native_${c.repeat(64)}`);
const INDEX = {
  version: 1,
  kind: 'r2-library',
  complete: true,
  count: 3,
  generatedAt: '2026-10-30T00:00:00.000Z',
  tracks: ids.map((id, i) => ({
    id,
    path: `Cloudflare R2/Classical/${i}.opus`,
    size: 4_000_000,
    mimeType: 'audio/ogg',
    metadata: { title: ['Ride of the Valkyries', 'Mars', 'O Fortuna'][i], artist: 'An Orchestra', genre: 'Classical', dur: 300 },
  })),
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

test('made from home, opened in Music at that playlist, and undone only while unchanged', opts, async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 780 } });
  await context.route(`${OLD}/**`, (route) =>
    route.request().url().endsWith('/music/library.json')
      ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(INDEX) })
      : route.fulfill({ status: 404 }),
  );
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/`);
  const made = await page.evaluate(
    async (refs) => (await import('/th/registry/verbs.js')).run({ verb: 'music.create_playlist', schema: 1, args: { name: 'Dramatic classical', refs } }),
    [ids[0], ids[1]].map((id) => `music:${id}`),
  );
  assert.equal(made.ok, true);
  assert.equal(made.result.tracks, 2);
  assert.match(made.result.list_id, /^[a-z0-9]{6,24}$/);
  assert.deepEqual(made.undo, { verb: 'music.delete_playlist', schema: 1, args: { list_id: made.result.list_id } });

  // "Open in Music": the player starts on that playlist, its two tracks in order.
  await page.goto(`${base}/music/#pl=${made.result.list_id}`);
  await page.waitForFunction(() => location.hash === '' && window.__cp?.ctx?.playlists?.items?.length === 1);
  const shown = await page.evaluate(async (id) => {
    const pl = window.__cp.ctx.playlists.get(id);
    return { name: pl.name, ids: pl.ids, by: pl.made_by };
  }, made.result.list_id);
  assert.deepEqual(shown, { name: 'Dramatic classical', ids: [ids[0], ids[1]], by: 'thunderhead' });
  await page.waitForFunction(() => document.body.innerText.includes('Dramatic classical'), null, { timeout: 10_000 });
  await page.waitForFunction(() => document.body.innerText.includes('Ride of the Valkyries'), null, { timeout: 10_000 });

  // The undo removes it while unchanged; once the owner changes it, the undo refuses.
  await page.goto(`${base}/`);
  const second = await page.evaluate(
    async (refs) => (await import('/th/registry/verbs.js')).run({ verb: 'music.create_playlist', schema: 1, args: { name: 'Another', refs } }),
    [`music:${ids[2]}`],
  );
  const result = await page.evaluate(
    async ([a, b]) => {
      const { run } = await import('/th/registry/verbs.js');
      const removed = await run({ verb: 'music.delete_playlist', schema: 1, args: { list_id: a } });
      // The owner renames the second one in the player (its `modified` moves on).
      await new Promise((resolve) => {
        const r = indexedDB.open('claude-player', 1);
        r.onsuccess = () => {
          const tx = r.result.transaction('state', 'readwrite');
          const s = tx.objectStore('state');
          const g = s.get(`pl:${b}`);
          g.onsuccess = () => s.put({ ...g.result, name: 'Mine now', modified: g.result.modified + 1 }, `pl:${b}`);
          tx.oncomplete = () => {
            r.result.close();
            resolve();
          };
        };
      });
      const refused = await run({ verb: 'music.delete_playlist', schema: 1, args: { list_id: b } });
      const left = await new Promise((resolve) => {
        const r = indexedDB.open('claude-player', 1);
        r.onsuccess = () => {
          const k = r.result.transaction('state').objectStore('state').getAllKeys();
          k.onsuccess = () => {
            r.result.close();
            resolve(k.result.filter((x) => String(x).startsWith('pl:')));
          };
        };
      });
      return { removed, refused, left };
    },
    [made.result.list_id, second.result.list_id],
  );
  assert.deepEqual(result.removed, { ok: true, result: {} });
  assert.equal(result.refused.error.code, 'owner_edited');
  assert.deepEqual(result.left, [`pl:${second.result.list_id}`]);
  assert.deepEqual(errors, []);
  await context.close();
});

test('the DJ shuffle: a sixth mode, a plan that follows the tags, a skip learned', opts, async () => {
  const genres = ['Classical', 'Jazz', 'Rock'];
  const many = {
    ...INDEX,
    count: 60,
    tracks: Array.from({ length: 60 }, (_, i) => ({
      id: `r2_native_${String(i).padStart(2, '0').repeat(32)}`,
      path: `Cloudflare R2/Lib/${i}.opus`,
      size: 4_000_000,
      mimeType: 'audio/ogg',
      metadata: { title: `Song ${i}`, artist: `Artist ${i % 20}`, genre: genres[i % 3], dur: 240 },
    })),
  };
  const context = await browser.newContext({ viewport: { width: 390, height: 780 } });
  await context.route(`${OLD}/**`, (route) =>
    route.request().url().endsWith('/music/library.json')
      ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(many) })
      : route.fulfill({ status: 404 }),
  );
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/music/`);
  await page.waitForFunction(() => window.__cp?.player?.queue?.length === 60);
  const modes = await page.evaluate(() => window.__cp.res.stringArray?.('shuffle_modes') ?? null);
  if (modes) assert.equal(modes[5], 'DJ');
  const plan = await page.evaluate(() => {
    const { player, ctx } = window.__cp;
    ctx.bus.post('bus_player_cmd', 'cmd_player_set_shuffle', null, { arg1: 5 });
    player.ensureOrder();
    return { shuffle: player.shuffle, genres: player.order.slice(0, 20).map((i) => player.queue[i].genre), first: player.order[0] === player.index };
  });
  assert.equal(plan.shuffle, 5);
  assert.equal(plan.first, true);
  const follows = plan.genres.slice(1).filter((g, k) => g === plan.genres[k]).length;
  assert.ok(follows >= 15, `${follows} of 19 follow in their genre: ${plan.genres.join(',')}`);
  await page.waitForFunction(() => document.body.innerText.includes('DJ'), null, { timeout: 5000 });
  // A song left at once is a skip: it scores lower on this phone.
  const learned = await page.evaluate(async () => {
    const { player, ctx } = window.__cp;
    const first = player.track.id;
    ctx.bus.post('bus_player_cmd', 'cmd_player_play_next_track', null, {});
    await new Promise((r) => setTimeout(r, 300));
    return { first, now: player.track.id, stored: JSON.parse(localStorage.getItem('th.music.dj') ?? '{}') };
  });
  assert.notEqual(learned.now, learned.first);
  assert.equal(learned.stored.tracks?.[learned.first]?.[0], -1);
  assert.deepEqual(errors, []);
  await context.close();
});

// A playlist the mind makes (MUSIC.md §10.2), in Chromium: the phone's `music.create_playlist`
// executor writes it into the player's own storage; "Open in Music" (`/music/#pl=<id>`) opens the
// player on that playlist with its tracks; its undo removes it, but not once the owner has changed
// it. The player's library comes from a stubbed index (the old Worker's URL, never reached).
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

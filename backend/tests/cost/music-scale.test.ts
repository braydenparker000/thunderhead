// The Music object's read paths at the live catalog's size, 12,818 songs (OPERATIONS.md §8): which
// read the whole table and how each is bounded. The catalog's build reads every track once per change
// (it serves them all) and its revalidation one row; the word search reads the tags once per start.
// The night's untagged page looks at most 1,000 places on (51,275 rows with every song noted and its
// place lost, before). A phone's first pull of marks, every song rated and played, lists each song
// once, so it ends within the phone's pages (th/music/sync.js PAGES) and is never asked again from
// the start; each page reads rows in proportion to what it returns. The catalog in changes at its
// song limit reads the log's rows since and those songs. Invented songs only.
import { evictDurableObject, runInDurableObject } from 'cloudflare:test';
import { expect, it } from 'vitest';
import syncJs from '../../../frontend/th/music/sync.js?raw';
import { DELTA } from '../../src/areas/music/catalog-delta';
import type { Music } from '../../src/objects/music';
import { music, seedCatalog } from '../music-helpers';

const N = 12_818;
/** The phone's pages a pull (th/music/sync.js): at 60, a library of 12,818 songs never finished. */
const PHONE_PAGES = Number(/const PAGES = (\d+);/.exec(syncJs)?.[1]);

it(`bounds every read path at ${N} songs`, async () => {
  const ids: string[] = [];
  for (let f = 0; f < N; f += 2_000)
    ids.push(
      ...(await seedCatalog(
        Array.from({ length: Math.min(2_000, N - f) }, (_, i) => ({
          title: `Song ${f + i}`,
          artist: `Artist ${i % 40}`,
        })),
        1 + f,
      )),
    );
  const sql = (q: string, ...b: unknown[]) =>
    runInDurableObject(music(), (_o: Music, st) => st.storage.sql.exec(q, ...b).toArray());
  const rows = async (fn: (o: Music) => unknown, cold = true) => {
    if (cold) await evictDurableObject(music());
    return runInDurableObject(music(), async (o: Music) => {
      const before = o.meter.rowsRead;
      await fn(o);
      return o.meter.rowsRead - before;
    });
  };
  const got: Record<string, number> = {};
  got.catalogBuild = await rows((o) => o.catalog());
  got.catalogWarm = await rows((o) => o.catalog(), false);
  got.catalogTag = await rows((o) => o.catalogTag());
  got.wordSearchCold = await rows((o) => o.findTracks('artist 1', 50));
  got.wordSearchWarm = await rows((o) => o.findTracks('artist 2', 50), false);
  got.untaggedFresh = await rows((o) => o.untaggedPage(200));
  // Every song noted, the night's place lost: the sweep to the end, a window a page.
  await sql(
    `INSERT INTO track_notes (track_id, known, note_json, by, v, at, pack)
     SELECT id, 1, '{"moods":{},"occasions":{},"themes":[],"language":null,"era":null,"energy":null,"conf":{}}', 'mind:night', 1, 0, ord / 500 FROM tracks`,
  );
  // Notes written behind the packs' back (as a restore does): find's packs are built again once, which
  // also starts the night's place over.
  got.packsRebuilt = await rows((o) => o.find({ moods: ['calm'], limit: 30 } as never, {}, []));
  await sql("DELETE FROM music_state WHERE key = 'notes.cursor'");
  let sweep = 0;
  let calls = 0;
  for (let more = true; more && calls < 30; calls++) {
    sweep = Math.max(
      sweep,
      await rows(async (o) => {
        more = o.untaggedPage(200).more === true;
      }),
    );
  }
  got.untaggedNotedMax = sweep;
  got.untaggedNotedCalls = calls;
  got.untaggedAtEnd = await rows((o) => o.untaggedPage(200));
  got.findCold = await rows((o) => o.find({ moods: ['calm'], limit: 30 } as never, {}, []));
  got.notesPage = await rows((o) => o.notesPage('', 200));
  // A phone's first sync: every song rated and played, 200 a push.
  const at = Date.now() - 60_000;
  for (let f = 0; f < N; f += 200)
    await rows(
      (o) =>
        o.putMarks(
          ids
            .slice(f, f + 200)
            .map((id) => ({ id, rating: 3, rated_at: at, plays: 2, last_played: at, updated_at: at })),
          [],
        ),
      false,
    );
  let after: [number, string] = [0, ''];
  let pages = 0;
  let pageMax = 0;
  const seen = new Set<string>();
  for (let more = true; more && pages < 1_000; pages++)
    pageMax = Math.max(
      pageMax,
      await rows((o) => {
        const p = o.marks(after, 200);
        for (const m of p.rows) seen.add(m.id);
        more = p.more && p.last !== null;
        if (p.last) after = p.last;
      }, false),
    );
  got.marksPages = pages;
  got.marksPageMax = pageMax;
  // The catalog in changes at its limit (catalog-delta.ts DELTA.max_songs): that many songs changed
  // after the copy's time, logged once each (the log written here as the writer writes it, with the
  // version a writer leaves): the log's rows since and the songs, never the whole table.
  const t0 = Date.now() + 60_000;
  const changed = DELTA.max_songs;
  await sql(
    "INSERT INTO catalog_log (at, op, track_id) SELECT ? + ord, 'patch', id FROM tracks WHERE ord <= ? ORDER BY ord",
    t0,
    changed + 1,
  );
  await sql(
    `UPDATE music_state SET value_json = json_set(value_json, '$.version', json_extract(value_json, '$.version') + 1,
       '$.changed_at', ?, '$.count', ?) WHERE key = 'catalog'`,
    t0 + changed + 1,
    N,
  );
  let delta = { tracks: -1, bytes: -1 };
  got.deltaAtLimit = await rows(async (o) => {
    const text = await o.catalogSince(new Date(t0 + 1).toISOString())?.text();
    if (text) delta = { tracks: (JSON.parse(text) as { tracks: unknown[] }).tracks.length, bytes: text.length };
  });
  got.deltaTracks = delta.tracks;
  got.deltaChars = delta.bytes;
  console.log(JSON.stringify(got));
  expect(got.catalogBuild).toBeLessThanOrEqual(N + 2);
  expect(got.catalogWarm).toBeLessThanOrEqual(1);
  expect(got.catalogTag).toBeLessThanOrEqual(1);
  expect(got.wordSearchCold).toBeLessThanOrEqual(N + 2);
  expect(got.wordSearchWarm).toBe(0);
  expect(got.packsRebuilt).toBeLessThanOrEqual(3 * N);
  expect(got.untaggedFresh).toBeLessThanOrEqual(205);
  expect(got.untaggedNotedMax).toBeLessThanOrEqual(3_100);
  expect(got.untaggedNotedCalls).toBeLessThanOrEqual(Math.ceil(N / 1_000) + 1);
  expect(got.untaggedAtEnd).toBeLessThanOrEqual(5);
  expect(got.findCold).toBeLessThanOrEqual(200);
  expect(got.notesPage).toBeLessThanOrEqual(610);
  expect(seen.size).toBe(N);
  expect(got.marksPages).toBeLessThanOrEqual(Math.ceil(N / 200) + 1);
  expect(got.marksPages).toBeLessThanOrEqual(PHONE_PAGES);
  expect(got.marksPageMax).toBeLessThanOrEqual(1_300);
  expect(got.deltaTracks).toBe(changed);
  // About 2 rows a song (its log row and its own); 4 leaves room for how the meter counts the lookup.
  expect(got.deltaAtLimit).toBeLessThanOrEqual(4 * changed);
}, 300_000);

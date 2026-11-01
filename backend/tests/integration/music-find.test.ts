// Songs by feeling (GET /v1/music/find, MUSIC.md §10.5): ranked by the mind's notes before the
// listening pass exists, by its moods, energy and neighbours once it does (step 3's table, faked
// here); an early skip costs a song, three in 30 days leave it out, a late skip costs nothing; a
// song the owner said never to play again (a rule fact from their own words) is left out; `like`
// ranks by closeness to one song. A synthetic catalog, notes and senses only.
import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import type { MusicFindResponse } from '../../../shared/contract/music.ts';
import type { Music } from '../../src/objects/music';
import { sensesObject } from '../../src/objects/senses';
import { apiJson, coreSql } from '../helpers';
import { addOp, as, CHAT_SESSION, ownerSays, type Principals, principals, reason } from '../memory-helpers';
import { music, note, putNotes, seedCatalog, sendSenses, songId } from '../music-helpers';

let P = {} as Principals;
let S: string[] = [];
const find = async (q: string, token = P.C) => {
  const r = await apiJson<MusicFindResponse & { error?: { code: string } }>('GET', `/v1/music/find?${q}`, { token });
  return r;
};
const order = (r: { body: MusicFindResponse }) => r.body.items.map((i) => S.indexOf(i.id));

beforeAll(async () => {
  P = await principals();
  S = await seedCatalog([
    { title: 'Quiet Lake', artist: 'Artist A', genre: 'Ambient' },
    { title: 'Night Drive', artist: 'Artist B', genre: 'Synthwave' },
    { title: 'Morning Light', artist: 'Artist C', genre: 'Folk' },
    { title: 'Heavy Sample', artist: 'Artist D', genre: 'Metal' },
    { title: 'Still Water', artist: 'Artist A', genre: 'Ambient' },
    { title: 'Unknown Tune', artist: 'Artist E', genre: 'Ambient' },
    { title: 'Untagged Song', artist: 'Artist A', genre: 'Ambient' },
    { title: 'Skipped Calm', artist: 'Artist F', genre: 'Ambient' },
  ]);
  const r = await putNotes(P.N, [
    note(S[0], {
      moods: { calm: 0.9, peaceful: 0.8 },
      occasions: { 'wind-down': 0.9, sleep: 0.6 },
      energy: 0.1,
      conf: { energy: 0.8 },
    }),
    note(S[1], {
      moods: { dreamy: 0.7, energetic: 0.5 },
      occasions: { drive: 0.9 },
      energy: 0.7,
      conf: { energy: 0.7 },
    }),
    note(S[2], { moods: { hopeful: 0.8, calm: 0.5 }, occasions: { morning: 0.9 }, energy: 0.4, conf: { energy: 0.6 } }),
    note(S[3], {
      moods: { dark: 0.9, tense: 0.8, energetic: 0.9 },
      occasions: { workout: 0.9 },
      energy: 0.95,
      conf: { energy: 0.9 },
    }),
    note(S[4], {
      moods: { calm: 0.8, dreamy: 0.6 },
      occasions: { 'wind-down': 0.8, focus: 0.5 },
      energy: 0.15,
      conf: { energy: 0.8 },
    }),
    note(S[5], { known: false, moods: { calm: 0.4 }, energy: 0.2, conf: { energy: 0.3 } }),
    note(S[7], { moods: { calm: 0.95 }, occasions: { 'wind-down': 0.9 }, energy: 0.1, conf: { energy: 0.8 } }),
  ]);
  expect(r.status).toBe(200);
});

describe('find by the notes alone (no listening pass yet)', () => {
  it('ranks by a mood, known songs above guessed ones, and says the audio was not used', async () => {
    const r = await find('moods=calm');
    expect(r.status).toBe(200);
    expect(order(r)).toEqual([7, 0, 4, 2, 5]);
    expect(r.body).toMatchObject({ total: 5, analysis: false, left_out: { never: 0, rated: 0, skipped: 0 } });
    expect(r.body.items[0]).toMatchObject({
      title: 'Skipped Calm',
      score: 0.95,
      known: true,
      why: { moods: { calm: 0.95 } },
    });
    expect(r.body.items.at(-1)).toMatchObject({ title: 'Unknown Tune', known: false });
  });

  it('adds the occasion and the energy, and takes a limit', async () => {
    const r = await find('moods=calm&occasion=wind-down&energy=low&limit=3');
    expect(order(r)).toEqual([7, 0, 4]);
    expect(r.body.total).toBe(5);
    expect(r.body.items[0].why).toEqual({ moods: { calm: 0.95 }, occasion: 0.9, energy: 0.1 });
    expect(order(await find('occasion=drive'))).toEqual([1]);
    // Energy alone: the songs whose energy is known, nearest first.
    expect(order(await find('energy=high')).slice(0, 2)).toEqual([1, 3]);
    expect(order(await find('energy=0.15')).slice(0, 2)).toEqual([4, 0]);
  });

  it('like one song: close moods, occasions, tags and energy; never the song itself', async () => {
    const r = await find(`like=${S[4]}`);
    const o = order(r);
    expect(o.slice(0, 2)).toEqual([7, 0]);
    expect(o).not.toContain(4);
    // A song with neither a note nor a measurement isn't ranked (its tags alone say nothing of it).
    expect(o).not.toContain(6);
    expect(o.slice(2)).toEqual([5, 1, 2, 3]);
    expect(r.body.items[0].why.like).toBeGreaterThan(1);
    // Like, with a feeling: only songs that show it.
    expect(order(await find(`like=${S[4]}&moods=energetic`))).toEqual([1, 3]);
  });

  it('refuses a query it cannot answer', async () => {
    for (const q of [
      'moods=happy',
      'moods=calm,calm',
      'moods=calm,sad,dark,tense,dreamy',
      'occasion=gym',
      'energy=loud',
      'energy=1.5',
      'limit=0&moods=calm',
      'limit=101&moods=calm',
      'like=song-1',
      'limit=5',
      '',
    ])
      expect((await find(q)).status, q).toBe(422);
    expect((await find(`like=${songId(9_999)}`)).status).toBe(404);
  });
});

describe('how the owner listens', () => {
  it('an early skip costs a song, a late one nothing; three early skips in 30 days leave it out', async () => {
    await sendSenses(P.D, [
      { type: 'music.skip', id: S[7], at_ms: 4_000 },
      { type: 'music.skip', id: S[0], at_ms: 90_000 },
      { type: 'music.play', id: S[0] },
    ]);
    const once = await find('moods=calm');
    expect(order(once)).toEqual([0, 4, 7, 2, 5]);
    expect(once.body.items[2]).toMatchObject({ score: 0.7, why: { skips: 1 } });
    expect(once.body.items[0].why.skips).toBeUndefined();
    await sendSenses(P.D, [
      { type: 'music.skip', id: S[7], at_ms: 12_000 },
      { type: 'music.skip', id: S[7], at_ms: 29_000, ago_ms: 20 * 86_400_000 },
    ]);
    const out = await find('moods=calm');
    expect(order(out)).toEqual([0, 4, 2, 5]);
    expect(out.body.left_out).toEqual({ never: 0, rated: 0, skipped: 1 });
  });

  it('a song the owner said never to play again is left out of find and like', async () => {
    const said = await ownerSays(P.D, 'Never play Quiet Lake again.');
    const rule = addOp([`msg:${said}`], {
      kind: 'rule',
      subject: 'music.never',
      text: `Never play "Quiet Lake" again (music:${S[0]}).`,
    });
    expect(await reason(as(P.C, CHAT_SESSION), rule)).toBeNull();
    const r = await find('moods=calm');
    expect(order(r)).toEqual([4, 2, 5]);
    expect(r.body.left_out).toEqual({ never: 1, rated: 0, skipped: 1 });
    expect(order(await find(`like=${S[4]}`))).not.toContain(0);
  });

  it('a song rated 1 on the phone ("not for me", or "never play this again" said to it) is left out for good, until undone', async () => {
    const rate = (rating: number, from: number, ago_ms: number) =>
      sendSenses(P.D, [{ type: 'music.rate', id: S[4], ago_ms, data: { rating, from, by: 'command' } }]);
    await rate(1, 0, 120_000);
    // Kept in Music itself: gone from the senses (as on day 91), the rating still counts.
    expect(
      await runInDurableObject(music(), (_o, st) =>
        st.storage.sql.exec('SELECT track_id, rating FROM track_ratings').toArray(),
      ),
    ).toEqual([{ track_id: S[4], rating: 1 }]);
    await runInDurableObject(sensesObject(env), (_o, st) =>
      st.storage.sql.exec("DELETE FROM events WHERE type = 'music.rate'"),
    );
    const r = await find('moods=calm');
    expect(order(r)).toEqual([2, 5]);
    expect(r.body.left_out).toEqual({ never: 1, rated: 1, skipped: 1 });
    expect(order(await find(`like=${S[0]}`))).not.toContain(4);
    // The word search (a mix by artist or genre) leaves it out too.
    const tagged = await apiJson<{ items: { id: string }[] }>('GET', '/v1/music/tracks?q=ambient', { token: P.C });
    expect(tagged.body.items.map((t) => S.indexOf(t.id))).toEqual([0, 5, 6, 7]);
    // The undo sends the old rating: the newest one is what counts.
    await rate(0, 1, 30_000);
    expect(order(await find('moods=calm'))).toEqual([4, 2, 5]);
    // Another song's rating of 1 an older day still counts; a later rating of 4 takes it back.
    await sendSenses(P.D, [
      { type: 'music.rate', id: S[2], ago_ms: 10 * 86_400_000, data: { rating: 1, from: 0 } },
      { type: 'music.rate', id: S[5], ago_ms: 9 * 86_400_000, data: { rating: 1, from: 0 } },
      { type: 'music.rate', id: S[5], ago_ms: 8 * 86_400_000, data: { rating: 4, from: 1 } },
    ]);
    const later = await find('moods=calm');
    expect(order(later)).toEqual([4, 5]);
    expect(later.body.left_out.rated).toBe(1);
    await sendSenses(P.D, [{ type: 'music.rate', id: S[2], ago_ms: 5_000, data: { rating: 3, from: 1 } }]);
    expect(order(await find('moods=calm'))).toEqual([4, 2, 5]);
  });
});

describe('what find reads', () => {
  it('every read by an index or a key range, never a scan of the catalog or the notes', async () => {
    const skips = await runInDurableObject(sensesObject(env), (_o, st) =>
      st.storage.sql
        .exec(
          `EXPLAIN QUERY PLAN SELECT ref, count(*) AS n FROM events
           WHERE day IN ('2026-10-01', '2026-10-02') AND type = 'music.skip' AND at >= 0 AND ref IS NOT NULL
             AND sensitivity = 0 AND json_extract(data_json, '$.at_ms') < 30000 GROUP BY ref`,
        )
        .toArray()
        .map((r) => String(r.detail))
        .join(' '),
    );
    expect(skips).toMatch(/SEARCH events USING INDEX events_day_type \(day=\? AND type=\?\)/);
    const plan = (q: string, ...b: unknown[]) =>
      runInDurableObject(music(), (_o, st) =>
        st.storage.sql
          .exec(`EXPLAIN QUERY PLAN ${q}`, ...b)
          .toArray()
          .map((r) => String(r.detail))
          .join(' | '),
      );
    expect(await plan('SELECT track_id FROM track_ratings WHERE rating = 1')).toMatch(
      /USING COVERING INDEX track_ratings_out/,
    );
    expect(await plan('SELECT id, ord, record_json FROM tracks WHERE id IN (?, ?)', 'a', 'b')).toMatch(
      /SEARCH tracks USING INDEX sqlite_autoindex_tracks_1 \(id=\?\)/,
    );
    expect(
      await plan(
        'SELECT track_id, known, note_json, by, v, at, pack FROM track_notes WHERE track_id IN (?, ?)',
        'a',
        'b',
      ),
    ).toMatch(/SEARCH track_notes USING PRIMARY KEY \(track_id=\?\)/);
    expect(await plan('SELECT track_id FROM track_notes WHERE track_id > ? ORDER BY track_id LIMIT ?', 'a', 5)).toMatch(
      /SEARCH track_notes USING PRIMARY KEY \(track_id>\?\)/,
    );
    const untagged = await plan(
      `SELECT t.id, t.ord, t.record_json FROM tracks t
       WHERE t.ord > ? AND NOT EXISTS (
         SELECT 1 FROM track_notes n WHERE n.track_id = t.id AND (n.v >= ? OR n.by = 'mind:chat'))
       ORDER BY t.ord LIMIT ?`,
      0,
      1,
      10,
    );
    expect(untagged).toMatch(/SEARCH t USING INTEGER PRIMARY KEY \(rowid>\?\)/);
    expect(untagged).toMatch(/SEARCH n USING PRIMARY KEY \(track_id=\?\)/);
    expect(await plan("SELECT pack, entries_json FROM find_packs WHERE kind = 'notes' ORDER BY pack")).toMatch(
      /SEARCH find_packs USING PRIMARY KEY \(kind=\?\)/,
    );
    const rules = await coreSql<{ detail: string }>(
      `EXPLAIN QUERY PLAN SELECT text FROM facts WHERE superseded_at IS NULL AND kind = 'rule' AND subject = 'music.never'
         AND (valid_to IS NULL OR valid_to > 0)`,
    );
    expect(rules.map((r) => r.detail).join(' ')).toMatch(/SEARCH facts USING INDEX facts_current \(kind=\?\)/);
  });
});

describe('find with the listening pass (Music schema step 3)', () => {
  it('blends its moods, prefers its energy, and takes its neighbours for like', async () => {
    // The shape listeningRows reads (areas/music/store-notes.ts). Not IF NOT EXISTS on purpose: once step
    // 3's own table is here, this fails if the two disagree, and the seam is fixed in one place.
    await runInDurableObject(music(), (o: Music, s) => {
      s.storage.sql.exec(
        'CREATE TABLE track_analysis (track_id TEXT PRIMARY KEY, energy REAL, moods_json TEXT, neighbours_json TEXT)',
      );
      const put = (id: string, energy: number, moods: object, neighbours: object[] = []) =>
        s.storage.sql.exec(
          'INSERT INTO track_analysis VALUES (?, ?, ?, ?)',
          id,
          energy,
          JSON.stringify(moods),
          JSON.stringify(neighbours),
        );
      put(S[6], 0.1, { calm: 0.9 });
      put(S[2], 0.6, { calm: 0.1, hopeful: 0.7 });
      put(S[4], 0.2, { calm: 0.7 }, [
        { id: S[3], score: 0.9 },
        { id: S[1], score: 0.5 },
      ]);
      Object.assign(o as unknown as object, { listenTable: null, audio: null });
    });
    const r = await find('moods=calm');
    expect(r.body.analysis).toBe(true);
    // The untagged song shows by its audio alone; Still Water's and Morning Light's calm are the
    // note's and the audio's averaged (Quiet Lake is ruled out, Skipped Calm skipped out).
    expect(order(r)).toEqual([6, 4, 5, 2]);
    expect(r.body.items[0].why).toEqual({ moods: { calm: 0.9 } });
    expect(r.body.items[1].why.moods).toEqual({ calm: 0.75 });
    expect(r.body.items[3].why.moods).toEqual({ calm: 0.3 });
    // Energy: the audio's before the note's.
    expect((await find('moods=hopeful&energy=mid')).body.items[0].why).toEqual({
      moods: { hopeful: 0.75 },
      energy: 0.6,
    });
    // Like a measured song: its neighbours, in their order.
    const like = await find(`like=${S[4]}`);
    expect(order(like)).toEqual([3, 1]);
    expect(like.body.items.map((i) => i.why.like)).toEqual([0.9, 0.5]);
  });
});

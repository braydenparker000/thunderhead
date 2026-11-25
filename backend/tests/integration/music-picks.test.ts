// Picks to add, end to end (MUSIC.md §19.4): after the `music.mb` job has matched the invented
// catalog and fetched its facts (know-helpers.ts), the rebuild offers the loved album the library
// lacks and the new release, never a live album or one it has; a decline sticks and lowers its kind;
// an order prepares Muse's words and records the order; an ordered album reaching the catalog is
// added and raises its kind. And the rebuild's rows at the size of the library, measured.
import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PickOrderResponse, PicksResponse } from '../../../shared/contract/know.ts';
import { useKeys } from '../../src/areas/music/know-fetch';
import { type Music, musicObject } from '../../src/objects/music';
import { apiJson, rowsDuring } from '../helpers';
import { ARTIST, mbidOf } from '../history-helpers';
import { fakeWorld, gid, KNOW_SONGS, musicSql, runJob, seedKnow, tick, trackRow, world } from '../know-helpers';
import { as, CHAT_SESSION, type Principals, principals } from '../memory-helpers';
import { music } from '../music-helpers';

const fake = fakeWorld(world());
let p: Principals;
const chat = () => as(p.C, CHAT_SESSION);

beforeAll(async () => {
  p = await principals();
  // ListenBrainz's popularity (its token) says which album is loved most.
  useKeys({ key: null, token: null, lb: 'invented-listenbrainz-token' });
  await seedKnow();
  await tick();
  await runJob(fake);
});
afterAll(() => useKeys(null));

describe('picks', () => {
  it('builds a mixed list from the plays: the loved album the library lacks, the new release', async () => {
    const r = await apiJson<PicksResponse>('GET', '/v1/music/picks?limit=10', chat());
    expect(r.status).toBe(200);
    const by = Object.fromEntries(r.body.items.map((i) => [i.album, i]));
    expect(by['The Loved One']).toMatchObject({ kind: 'gap', state: 'new', id: gid(104) });
    expect(by['A New Dawn']).toMatchObject({ kind: 'new' });
    expect(by['Live at the Pier']).toBeUndefined();
    expect(by['Paper Lanterns']).toBeUndefined();
    expect(by['The Loved One'].line).toBe(
      `The Loved One (2006) by ${ARTIST(0)}: one of their best-loved albums, and not in your library.`,
    );
    expect((await apiJson('GET', '/v1/music/picks?kind=nope', chat())).status).toBe(422);
  });

  it('a decline sticks and lowers its kind; an order prepares the words, then records the order', async () => {
    const d = await apiJson('POST', `/v1/music/picks/${gid(105)}/decline`, { ...chat(), body: { why: 'not for me' } });
    expect(d.status).toBe(200);
    const w = (await apiJson<PicksResponse>('GET', '/v1/music/picks?state=declined', chat())).body;
    expect(w.items.map((i) => i.id)).toEqual([gid(105)]);
    expect(w.weights.new).toBe(0.95);
    const words = await apiJson<PickOrderResponse>('POST', `/v1/music/picks/${gid(104)}/order`, {
      ...chat(),
      body: {},
    });
    expect(words.body.state).toBe('new');
    expect(words.body.words).toContain(`album The Loved One by ${ARTIST(0)} (2006)`);
    expect(words.body.words).toContain(gid(104));
    expect(words.body.words.length).toBeLessThanOrEqual(500);
    const placed = await apiJson<PickOrderResponse>('POST', `/v1/music/picks/${gid(104)}/order`, {
      ...chat(),
      body: { order_id: 'ord_invented1' },
    });
    expect(placed.body.state).toBe('ordered');
    expect((await apiJson('POST', `/v1/music/picks/${gid(999)}/decline`, { ...chat(), body: {} })).status).toBe(404);
  });

  it('a rebuild never offers a declined pick again, and sees an ordered album arrive as added', async () => {
    const loved = trackRow(KNOW_SONGS.length + 7_001, {
      title: 'Loved Song',
      artist: ARTIST(0),
      album: 'The Loved One',
      mbReleaseGroup: gid(104),
    });
    await musicObject(env).importTracks([loved], Date.now());
    await musicSql(
      "UPDATE music_state SET value_json = json_set(value_json, '$.picks_at', 0, '$.built_v', '') WHERE key = 'know.state'",
    );
    await tick(Date.now() + 2 * 3_600_000);
    await runJob(fake, 60);
    const added = (await apiJson<PicksResponse>('GET', '/v1/music/picks?state=added', chat())).body;
    expect(added.items.map((i) => i.id)).toEqual([gid(104)]);
    expect(added.weights.gap).toBe(1.05);
    const fresh = (await apiJson<PicksResponse>('GET', '/v1/music/picks', chat())).body;
    expect(fresh.items.map((i) => i.id)).not.toContain(gid(105));
  });
});

describe('the rebuild at the size of the library', () => {
  it('reads the albums, plays and ratings once, and the facts by key (measured: 700 albums, 7,000 songs played)', async () => {
    await runInDurableObject(music(), (_o: Music, st) => {
      for (let a = 0; a < 700; a++) {
        const songs = Array.from({ length: 10 }, (_, k) => ({
          id: `r2_scale_${a}_${k}`,
          title: `S${k}`,
          track: k + 1,
          recording: null,
        }));
        st.storage.sql.exec(
          `INSERT INTO know_albums (album_key, artist_key, artist, album, songs, songs_json, year, plays, hint, artist_mbid, rg, state,
             reason, tries, matched_songs, seen, at) VALUES (?, ?, ?, ?, 10, ?, 2000, 1, NULL, ?, ?, 'matched', NULL, 0, 0, -1, 0)`,
          `scale ${a}\u0001album`,
          `scale ${a % 300}`,
          `Scale ${a % 300}`,
          'Album',
          JSON.stringify(songs),
          mbidOf(10_000 + (a % 300)),
          gid(10_000 + a),
        );
        for (const s of songs) st.storage.sql.exec('INSERT INTO track_plays VALUES (?, 3, ?, 1)', s.id, Date.now());
      }
    });
    const rows = await rowsDuring(music() as never, () => musicObject(env).picksBuild({}, Date.now()));
    expect(rows.read).toBeLessThanOrEqual(Math.ceil(7_797 * 1.1));
    expect(rows.written).toBeLessThanOrEqual(Math.ceil(1 * 1.1) + 1);
  });
});

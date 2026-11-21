// The owner's Music data on every phone (MUSIC.md §1.4, API.md §11.29): two phones' ratings, likes,
// plays and playlists through PUT/GET /v1/music/marks and /v1/music/playlists. The newer rating wins
// both ways (in the one `track_ratings` the senses also write, so a sense and a sync agree); plays
// keep the larger count and the later time; a playlist's newer record wins whole, a deleted one is a
// record marked deleted, kept 30 days and then pruned; a fresh phone asking from 0 gets everything;
// a time an hour ahead is refused by place; and the catalog's ETag never moves. Synthetic songs only.
import { runInDurableObject } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import type {
  MusicMark,
  MusicMarksPage,
  MusicPlaylist,
  MusicPlaylistsPage,
  MusicSyncResponse,
} from '../../../shared/contract/music-sync.ts';
import { uuidv7 } from '../../src/lib/ids';
import type { Music } from '../../src/objects/music';
import { api, apiJson } from '../helpers';
import { type Principals, principals } from '../memory-helpers';
import { music, seedCatalog } from '../music-helpers';

let P = {} as Principals;
let ids: string[] = [];
const T = Date.now() - 600_000;
const mark = (id: string, o: Partial<MusicMark>): MusicMark => ({
  id,
  rating: null,
  rated_at: null,
  plays: 0,
  last_played: 0,
  updated_at: Math.max(1, o.rated_at ?? 0, o.last_played ?? 0),
  ...o,
});
const list = (id: string, o: Partial<MusicPlaylist>): MusicPlaylist => ({
  id,
  name: 'An invented list',
  ids: [],
  created: T,
  path: null,
  deleted: false,
  updated_at: T,
  ...o,
});
const putMarks = (items: unknown[]) =>
  apiJson<MusicSyncResponse>('PUT', '/v1/music/marks', { token: P.D, body: { items } });
const putLists = (items: unknown[]) =>
  apiJson<MusicSyncResponse>('PUT', '/v1/music/playlists', { token: P.D, body: { items } });
const marks = async (since = 0) => {
  const out: MusicMark[] = [];
  let q = `?since=${since}`;
  for (;;) {
    const p = (await apiJson<MusicMarksPage>('GET', `/v1/music/marks${q}&limit=2`, { token: P.D })).body;
    out.push(...p.items);
    if (!p.next) return { items: out, since: p.next_since };
    q = `?cursor=${p.next}`;
  }
};
const lists = async (since = 0) =>
  (await apiJson<MusicPlaylistsPage>('GET', `/v1/music/playlists?since=${since}`, { token: P.D })).body;
const latest = (items: MusicMark[], id: string) => items.filter((m) => m.id === id).at(-1);
const etag = async () => (await api('GET', '/v1/music/catalog', { token: P.D })).headers.get('ETag');

beforeAll(async () => {
  P = await principals();
  ids = await seedCatalog([{ title: 'Synced A' }, { title: 'Synced B' }, { title: 'Synced C' }], 900);
});

describe('marks: the newer rating wins, plays the larger', () => {
  it('a rating and a like, newer on either phone, win on the Worker; older ones change nothing', async () => {
    const tag = await etag();
    // Phone A rates song 0 "not for me" (never play again); phone B likes it later: B wins.
    expect((await putMarks([mark(ids[0], { rating: 1, rated_at: T })])).body.applied).toBe(1);
    expect((await putMarks([mark(ids[0], { rating: 5, rated_at: T + 10 })])).body.applied).toBe(1);
    // A's older word comes late: nothing changes.
    expect((await putMarks([mark(ids[0], { rating: 1, rated_at: T + 5 })])).body).toMatchObject({
      applied: 0,
      stale: 1,
    });
    expect(latest((await marks()).items, ids[0])).toMatchObject({ rating: 5, rated_at: T + 10 });
    // Then A, newer again: back to 1, both ways.
    await putMarks([mark(ids[0], { rating: 1, rated_at: T + 20 })]);
    expect(latest((await marks()).items, ids[0])).toMatchObject({ rating: 1, rated_at: T + 20 });
    expect(await etag()).toBe(tag);
  });

  it("a sense's rating and a sync's are the one row in track_ratings", async () => {
    await apiJson('PUT', `/v1/senses/batches/${uuidv7()}`, {
      token: P.D,
      body: {
        events: [
          { id: uuidv7(), at: Date.now() - 1000, type: 'music.rate', ref: `music:${ids[1]}`, data: { rating: 4 } },
        ],
      },
    });
    const rows = await runInDurableObject(music(), (_o: Music, st) =>
      st.storage.sql.exec('SELECT track_id, rating FROM track_ratings WHERE track_id = ?', ids[1]).toArray(),
    );
    expect(rows).toEqual([{ track_id: ids[1], rating: 4 }]);
    expect(latest((await marks()).items, ids[1])).toMatchObject({ rating: 4 });
  });

  it('plays keep the larger count and the later time, whichever phone sends', async () => {
    await putMarks([mark(ids[2], { plays: 7, last_played: T + 100 })]);
    expect((await putMarks([mark(ids[2], { plays: 3, last_played: T + 200 })])).body.applied).toBe(1);
    expect((await putMarks([mark(ids[2], { plays: 2, last_played: T })])).body.applied).toBe(0);
    expect(latest((await marks()).items, ids[2])).toMatchObject({ plays: 7, last_played: T + 200 });
  });

  it('asks only for what changed since; a fresh phone gets every song', async () => {
    const all = await marks();
    expect(new Set(all.items.map((m) => m.id))).toEqual(new Set(ids));
    expect((await marks(all.since)).items).toEqual([]);
    await putMarks([mark(ids[2], { plays: 8, last_played: T + 300 })]);
    expect((await marks(all.since)).items.map((m) => m.id)).toEqual([ids[2]]);
  });

  it('refuses by place a malformed song or a time an hour ahead, and keeps the rest', async () => {
    const r = await putMarks([
      mark('not-a-song', { plays: 1 }),
      mark(ids[1], { rating: 3, rated_at: Date.now() + 2 * 3_600_000 }),
      mark(ids[1], { plays: 1, last_played: T }),
    ]);
    expect(r.body.refused.map((x) => x.index)).toEqual([0, 1]);
    expect(r.body.applied).toBe(1);
  });
});

const sense = (id: string, rating: number, at: number) =>
  apiJson('PUT', `/v1/senses/batches/${uuidv7()}`, {
    token: P.D,
    body: { events: [{ id: uuidv7(), at, type: 'music.rate', ref: `music:${id}`, data: { rating } }] },
  });
const ratingRow = async (id: string) =>
  (
    await runInDurableObject(music(), (_o: Music, st) =>
      st.storage.sql.exec('SELECT rating, at, synced_at FROM track_ratings WHERE track_id = ?', id).toArray(),
    )
  )[0] as { rating: number; at: number; synced_at: number };

describe("one clock: a sense's time is the phone's, so it never beats a synced rating", () => {
  it('a sense later on its own clock than a synced rating leaves the synced one', async () => {
    const id = ids[0];
    await putMarks([mark(id, { rating: 5, rated_at: Date.now() - 120_000 })]);
    await sense(id, 1, Date.now() - 1000);
    expect(await ratingRow(id)).toMatchObject({ rating: 5 });
  });

  it("a sense fills a song no sync has touched; the phone's synced stamp then replaces it", async () => {
    const [id] = await seedCatalog([{ title: 'Sensed only' }], 950);
    await sense(id, 1, Date.now() - 1000);
    expect(await ratingRow(id)).toMatchObject({ rating: 1, synced_at: 0 });
    // The sync of a rating from before the sync (stamp 1) does not; a real stamp does, even if older.
    expect((await putMarks([mark(id, { rating: 3, rated_at: 1 })])).body.applied).toBe(0);
    await putMarks([mark(id, { rating: 2, rated_at: Date.now() - 300_000 })]);
    const row = await ratingRow(id);
    expect([row.rating, row.synced_at > 0]).toEqual([2, true]);
  });
});

describe('Reset stats: a record with its own time that wins over older plays', () => {
  it('plays from before the reset read as none and never come back; later plays count again', async () => {
    const [id] = await seedCatalog([{ title: 'Reset me' }], 960);
    const before = Date.now() - 100_000;
    await putMarks([mark(id, { plays: 12, last_played: before })]);
    const r = await apiJson<MusicSyncResponse>('PUT', '/v1/music/marks', {
      token: P.D,
      body: { items: [], reset_at: Date.now() - 50_000 },
    });
    expect(r.status).toBe(200);
    const page = (await apiJson<MusicMarksPage>('GET', '/v1/music/marks?since=0', { token: P.D })).body;
    expect(page.reset_at).toBeGreaterThan(before);
    expect(latest((await marks()).items, id)).toMatchObject({ plays: 0, last_played: 0 });
    // A phone that had not reset sends its old count: nothing changes.
    expect((await putMarks([mark(id, { plays: 13, last_played: before + 1 })])).body.applied).toBe(0);
    // A play after the reset replaces the old row's count.
    await putMarks([mark(id, { plays: 1, last_played: Date.now() - 1000 })]);
    expect(latest((await marks()).items, id)).toMatchObject({ plays: 1 });
    // An older reset changes nothing; no items and no reset is refused.
    await apiJson('PUT', '/v1/music/marks', { token: P.D, body: { items: [], reset_at: before } });
    expect((await apiJson<MusicMarksPage>('GET', '/v1/music/marks?since=0', { token: P.D })).body.reset_at).toBe(
      page.reset_at,
    );
    expect((await apiJson('PUT', '/v1/music/marks', { token: P.D, body: { items: [] } })).status).toBe(422);
  });
});

describe('a waveform registered again', () => {
  it("moves its track's waveformAt in the catalog, so the phone fetches it again", async () => {
    type Cat = { tracks: { id: string; waveformAt?: number }[] };
    const [id] = await seedCatalog([{ title: 'Waved' }], 970);
    const at = Date.now() - 10_000;
    const wave = btoa(String.fromCharCode(...Array.from({ length: 20 }, (_, i) => i * 10)));
    const redo = (u: number) =>
      runInDurableObject(music(), (_o: Music, st) => {
        st.storage.sql.exec('UPDATE tracks SET waveform = ?, updated_at = ? WHERE id = ?', wave, u, id);
        st.storage.sql.exec(
          "UPDATE music_state SET value_json = json_set(value_json, '$.version', json_extract(value_json, '$.version') + 1) WHERE key = 'catalog'",
        );
      });
    const waveAt = async () =>
      ((await (await api('GET', '/v1/music/catalog', { token: P.D })).json()) as Cat).tracks.find((t) => t.id === id)
        ?.waveformAt;
    await redo(at);
    expect(await waveAt()).toBe(at);
    await redo(at + 5000);
    expect(await waveAt()).toBe(at + 5000);
  });
});

describe('playlists: the newer record wins whole; a deleted one stays deleted', () => {
  it('a rename newer on either phone wins; an older one changes nothing', async () => {
    await putLists([list('pla0001', { name: 'Morning', ids: [ids[0]] })]);
    await putLists([list('pla0001', { name: 'Evening', ids: [ids[0], ids[1]], updated_at: T + 10 })]);
    expect((await putLists([list('pla0001', { name: 'Old', updated_at: T + 5 })])).body.stale).toBe(1);
    expect((await lists()).items.find((p) => p.id === 'pla0001')).toMatchObject({
      name: 'Evening',
      ids: [ids[0], ids[1]],
    });
  });

  it('a delete is a record marked deleted: an older edit does not bring it back, then it is pruned', async () => {
    await putLists([list('pla0002', { name: 'Gone soon' })]);
    await putLists([list('pla0002', { deleted: true, updated_at: T + 20 })]);
    expect((await putLists([list('pla0002', { name: 'Gone soon', updated_at: T + 1 })])).body.stale).toBe(1);
    expect((await lists()).items.find((p) => p.id === 'pla0002')).toMatchObject({ deleted: true, ids: [] });
    // 30 days on, a later PUT prunes it.
    await runInDurableObject(music(), (_o: Music, st) => {
      st.storage.sql.exec(
        'UPDATE music_playlists SET updated_at = ? WHERE id = ?',
        Date.now() - 31 * 86_400_000,
        'pla0002',
      );
    });
    await putLists([list('pla0003', {})]);
    expect((await lists()).items.map((p) => p.id)).not.toContain('pla0002');
  });

  it('refuses a bad id by place; a long list is taken under its own body limit', async () => {
    const long = Array.from({ length: 4000 }, (_, i) => `r2_native_${i.toString(16).padStart(64, '0')}`);
    const r = await putLists([list('NOT OK', {}), list('pla0004', { ids: long, updated_at: T + 30 })]);
    expect([r.status, r.body.refused.map((x) => x.index), r.body.applied]).toEqual([200, [0], 1]);
    expect((await lists()).items.find((p) => p.id === 'pla0004')?.ids.length).toBe(4000);
  });
});

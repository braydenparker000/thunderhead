// Music's marks and playlists calls of the cost suite (cost.test.ts checks every budget; MUSIC.md
// §1.4), with the 12,000-song catalog of music-calls.ts: a phone's push after a change (a rating, a
// like newer, a stale one, a play: each changed record its rows), a first sync of 200 songs, the reads
// on open (nothing new, then 3 new: each reads the rows it returns), a playlist made, renamed and
// deleted, and the catalog's revalidation afterwards, still a 304 (this data never moves its ETag).
// Invented songs only.
import { api } from '../helpers';
import { songId } from '../music-helpers';

type Cost = (name: string, fn: () => Promise<Response>, status: number, stub?: never) => Promise<void>;

const mark = (i: number, o: Record<string, number | null>) => ({
  id: songId(i),
  rating: null,
  rated_at: null,
  plays: 0,
  last_played: 0,
  updated_at: Math.max(1, ...Object.values(o).map((v) => v ?? 0)),
  ...o,
});
const list = (id: string, o: Record<string, unknown>) => ({
  id,
  name: 'An invented list',
  ids: Array.from({ length: 50 }, (_, i) => songId(i + 1)),
  created: 1,
  path: null,
  deleted: false,
  updated_at: 1,
  ...o,
});

export async function musicSyncCalls(cost: Cost, token: string, m: never) {
  const at = Date.now() - 60_000;
  const tag = (await api('GET', '/v1/music/catalog', { token })).headers.get('ETag') ?? '';
  const marks = (items: unknown[]) => () => api('PUT', '/v1/music/marks', { token, body: { items } });
  const lists = (items: unknown[]) => () => api('PUT', '/v1/music/playlists', { token, body: { items } });
  await cost('PUT /v1/music/marks (1 rating, new) (Music)', marks([mark(5, { rating: 1, rated_at: at })]), 200, m);
  await cost('PUT /v1/music/marks (1 like, newer) (Music)', marks([mark(5, { rating: 5, rated_at: at + 1 })]), 200, m);
  await cost('PUT /v1/music/marks (1 stale) (Music)', marks([mark(5, { rating: 1, rated_at: at })]), 200, m);
  await cost('PUT /v1/music/marks (1 play) (Music)', marks([mark(5, { plays: 3, last_played: at })]), 200, m);
  await cost(
    'PUT /v1/music/marks (200 played and rated, a first sync) (Music)',
    marks(Array.from({ length: 200 }, (_, i) => mark(100 + i, { rating: 4, rated_at: at, plays: 2, last_played: at }))),
    200,
    m,
  );
  const since = Date.now() + 1;
  await new Promise((r) => setTimeout(r, 5));
  await cost(
    'GET /v1/music/marks (nothing new) (Music)',
    () => api('GET', `/v1/music/marks?since=${since}`, { token }),
    200,
    m,
  );
  await marks([1, 2, 3].map((i) => mark(400 + i, { plays: 1, last_played: at })))();
  await cost(
    'GET /v1/music/marks (3 new) (Music)',
    () => api('GET', `/v1/music/marks?since=${since}`, { token }),
    200,
    m,
  );
  await cost(
    'PUT /v1/music/playlists (1 new, 50 songs) (Music)',
    lists([list('costpl01', { updated_at: at })]),
    200,
    m,
  );
  await cost(
    'PUT /v1/music/playlists (1 renamed, newer) (Music)',
    lists([list('costpl01', { name: 'Renamed', updated_at: at + 1 })]),
    200,
    m,
  );
  await cost(
    'PUT /v1/music/playlists (1 deleted) (Music)',
    lists([list('costpl01', { ids: [], deleted: true, updated_at: at + 2 })]),
    200,
    m,
  );
  await cost(
    'GET /v1/music/playlists (1 changed) (Music)',
    () => api('GET', `/v1/music/playlists?since=${since}`, { token }),
    200,
    m,
  );
  await cost(
    'GET /v1/music/catalog, 304 after the marks and playlists synced (Music)',
    () => api('GET', '/v1/music/catalog', { token, headers: { 'If-None-Match': tag } }),
    304,
    m,
  );
}

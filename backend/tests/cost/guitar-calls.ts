// Guitar's progress calls of the cost suite (cost.test.ts checks every budget; GUITAR.md §1.1): the
// phone's push after a practice change (one song, new or newer: one write each), a stale one, a first
// sync of 50 songs, and the reads on open with 1,000 songs kept (nothing new, then 3 new: each reads
// the rows it returns). Invented songs only.
import type { SignedIn } from '../../../shared/contract/api';
import { api, core, coreSql, PASSWORD } from '../helpers';

type Cost = (
  name: string,
  fn: () => Promise<Response>,
  status: number,
  stub?: ReturnType<typeof core>,
) => Promise<void>;

const rec = (n: number, updated_at: number) => ({
  key: `s${n}`,
  song: { key: `s${n}`, source: 'songsterr', id: n, title: 'An invented song', artist: 'A band', seconds: 600 },
  ladder: { '4-8': { day: '2026-11-20', passes: 6, clean: 4, ceiling: 84, best: 84, last: null } },
  days: { '2026-11-19': 300, '2026-11-20': 300 },
  phone_at: updated_at,
  updated_at,
});

export async function guitarCalls(cost: Cost, grant: (ip: string, password?: string) => Promise<SignedIn>) {
  const d = await grant('192.0.2.248', `${PASSWORD} new`);
  await api('GET', '/v1/auth/me', d);
  const at = Date.now() - 60_000;
  const put = (items: unknown[]) => () => api('PUT', '/v1/guitar/progress', { ...d, body: { items } });
  await cost('PUT /v1/guitar/progress (1 new) (Core)', put([rec(1, at)]), 200, core());
  await cost('PUT /v1/guitar/progress (1 newer) (Core)', put([rec(1, at + 1)]), 200, core());
  await cost('PUT /v1/guitar/progress (1 stale) (Core)', put([rec(1, at)]), 200, core());
  await cost(
    'PUT /v1/guitar/progress (50 new, a first sync) (Core)',
    put(Array.from({ length: 50 }, (_, i) => rec(100 + i, at))),
    200,
    core(),
  );
  await coreSql(
    `INSERT INTO guitar_progress (key, body, updated_at, synced_at)
     SELECT 's7' || printf('%05d', value), '{"song":null,"ladder":{},"days":{},"phone_at":1}', ? - value, ? FROM json_each(?)`,
    at,
    at,
    JSON.stringify([...Array(949).keys()]),
  );
  const since = Date.now() + 1;
  await new Promise((r) => setTimeout(r, 5));
  await cost(
    'GET /v1/guitar/progress (nothing new of 1,000) (Core)',
    () => api('GET', `/v1/guitar/progress?since=${since}`, d),
    200,
    core(),
  );
  await put([rec(2, at), rec(3, at), rec(4, at)])();
  await cost(
    'GET /v1/guitar/progress (3 new of 1,003) (Core)',
    () => api('GET', `/v1/guitar/progress?since=${since}`, d),
    200,
    core(),
  );
  // Gone again, so the later calls' daily passes don't sort them (the prune is tested in guitar-sync.test.ts).
  await coreSql('DELETE FROM guitar_progress');
}

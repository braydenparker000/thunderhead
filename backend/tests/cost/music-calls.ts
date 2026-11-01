// The mind's music calls of the cost suite (cost.test.ts checks every budget; MUSIC.md §10.5), at
// full size: a catalog of 12,000 tracks, 11,600 of them with a note, each call measured cold (the
// Music object just started, as after a minute or two idle) unless named warm. Find reads the notes
// packed 500 to a row; the packs' one-off rebuild (after a restore, when they are missing) is
// measured too. Notes, tags and the untagged page are read by key, so their rows follow the call's
// size, not the catalog's. In the Senses object, find reads the early skips by the (day, type)
// index; in Core, the current rules. The phone's ratings go to Music as one row each (two for a 1,
// with its index), and its one-time catch-up of the songs rated 1 goes 100 a batch. Songs' tags
// served to a mind session taint it in Core and record a night reader in Music, once a session.
import { evictDurableObject, runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { NewAgentResponse, SignedIn } from '../../../shared/contract/api';
import { uuidv7 } from '../../src/lib/ids';
import type { Music } from '../../src/objects/music';
import { sensesObject } from '../../src/objects/senses';
import { api, apiJson, coreSql, core as coreStub, PASSWORD } from '../helpers';
import { music, note, seedCatalog, songId } from '../music-helpers';

type Cost = (name: string, fn: () => Promise<Response>, status: number, stub?: never) => Promise<void>;

const TRACKS = 12_000;
const NOTED = 11_600;
const sql = (q: string, ...b: unknown[]) =>
  runInDurableObject(music(), (_o: Music, st) => st.storage.sql.exec(q, ...b).toArray());

/** A synthetic night's note for song `i`, as the Worker keeps it. */
const noteJson = (i: number) =>
  JSON.stringify({
    moods: { calm: (i % 10) / 10 + 0.05, dreamy: 0.5 },
    occasions: { 'wind-down': 0.7 },
    themes: [],
    language: 'en',
    era: 1990,
    energy: (i % 10) / 10,
    conf: { language: 0.9, era: 0.6, energy: 0.6 },
  });

export async function musicCalls(cost: Cost, grant: (ip: string, password?: string) => Promise<SignedIn>) {
  const d = await grant('192.0.2.251', `${PASSWORD} new`);
  const night = (
    await apiJson<NewAgentResponse>('POST', '/v1/auth/agents', {
      token: d.token,
      body: { name: 'night-cost-music', role: 'mind:night', current_password: `${PASSWORD} new` },
    })
  ).body.token;
  const m = music() as unknown as never;
  const ids = await seedCatalog(
    Array.from({ length: TRACKS }, (_, i) => ({ title: `Cost song ${i}`, artist: `Artist ${i % 40}`, genre: 'Pop' })),
  );
  // The notes the nights wrote, put straight in (each in its pack, 500 to a pack), without the packs.
  for (let from = 0; from < NOTED; from += 2_000) {
    const part = ids
      .slice(from, Math.min(from + 2_000, NOTED))
      .map((id, k) => ({ id, j: noteJson(from + k), p: Math.floor((from + k) / 500) }));
    await sql(
      `INSERT INTO track_notes (track_id, known, note_json, by, v, at, pack)
       SELECT json_extract(value, '$.id'), 1, json_extract(value, '$.j'), 'mind:night', 1, 0, json_extract(value, '$.p')
       FROM json_each(?)`,
      JSON.stringify(part),
    );
  }
  const find =
    (q = 'moods=calm&occasion=wind-down&limit=30') =>
    () =>
      api('GET', `/v1/music/find?${q}`, { token: night });
  const cold = async (name: string, fn: () => Promise<Response>) => {
    await evictDurableObject(music());
    await cost(name, fn, 200, m);
  };
  await cold(`GET /v1/music/find, packs missing: built again once (Music, ${TRACKS} tracks, ${NOTED} notes)`, find());
  await cold(`GET /v1/music/find (Music, cold: ${TRACKS} tracks, ${NOTED} notes)`, find());
  await cost('GET /v1/music/find (Music, warm)', find(), 200, m);
  await cold(`GET /v1/music/find?like= (Music, cold: ${TRACKS} tracks)`, find(`like=${ids[10]}&limit=30`));

  const batch = ids
    .slice(0, 200)
    .map((id) =>
      note(id, { moods: { calm: 0.8, nostalgic: 0.4 }, occasions: { study: 0.6 }, energy: 0.3, conf: { energy: 0.6 } }),
    );
  const put = () => api('PUT', '/v1/music/notes', { token: night, body: { items: batch } });
  await cold(`PUT /v1/music/notes, 200 notes replacing 200 (Music, cold: ${TRACKS} tracks)`, put);
  await cost('PUT /v1/music/notes, 200 notes again, unchanged (Music)', put, 200, m);
  const fifty = ids.slice(0, 50).join(',');
  await cold('GET /v1/music/notes?ids= 50 (Music, cold)', () =>
    api('GET', `/v1/music/notes?ids=${fifty}`, { token: night }),
  );
  await cold('GET /v1/music/notes, a page of 200 (Music, cold)', () => api('GET', '/v1/music/notes', { token: night }));
  // The night's place: every song before the untagged ones has its note.
  await sql(
    "INSERT INTO music_state (key, value_json) VALUES ('notes.cursor', ?)",
    JSON.stringify({ v: 1, ord: NOTED }),
  );
  await cold('GET /v1/music/tracks?untagged=1, 200 (Music, cold, its place kept)', () =>
    api('GET', '/v1/music/tracks?untagged=1&limit=200', { token: night }),
  );

  // The phone's senses: 40 early skips among 200 events, then 5 ratings (one row each in Music).
  const at = Date.now() - 60_000;
  const sense = (type: string, id: string, data: object) => ({ id: uuidv7(), at, type, ref: `music:${id}`, data });
  await api('PUT', `/v1/senses/batches/${uuidv7()}`, {
    token: d.token,
    body: {
      events: Array.from({ length: 200 }, (_, i) =>
        i % 5
          ? sense('music.play', songId(1 + (i % 50)), { offline: false })
          : sense('music.skip', songId(1 + (i % 50)), { at_ms: 3_000 }),
      ),
    },
  });
  // The phone's one-time catch-up of the songs already rated 1 goes 100 a page load (ratings.js).
  const ratings = (from: number) =>
    Array.from({ length: 100 }, (_, i) => sense('music.rate', ids[from + i], { rating: 1 }));
  await cost(
    'PUT /v1/senses/batches/:id, the catch-up: 100 ratings of 1 (Music)',
    () => api('PUT', `/v1/senses/batches/${uuidv7()}`, { token: d.token, body: { events: ratings(1_000) } }),
    200,
    m,
  );
  await cost(
    'PUT /v1/senses/batches/:id, the catch-up: 100 ratings of 1 (Senses)',
    () => api('PUT', `/v1/senses/batches/${uuidv7()}`, { token: d.token, body: { events: ratings(2_000) } }),
    200,
    sensesObject(env) as unknown as never,
  );
  for (let i = 0; i < 3; i++)
    await coreSql(
      `INSERT INTO facts (id, kind, about, subject, text, source, confidence, evidence_json, recorded_at, last_confirmed,
         sensitivity, written_by, lineage_id)
       VALUES (?, 'rule', 'owner', 'music.never', ?, 'user', 1, '[]', ?, ?, 0, 'owner', ?)`,
      `cost-rule-${i}`,
      `Never play music:${ids[i]} again.`,
      Date.now(),
      Date.now(),
      `cost-rule-${i}`,
    );
  const senses = sensesObject(env) as unknown as never;
  const core = coreStub() as unknown as never;
  await evictDurableObject(sensesObject(env));
  await cost('GET /v1/music/find (Senses, cold: 40 early skips among 200 events)', find(), 200, senses);
  await cost('GET /v1/music/find (Senses, warm)', find(), 200, senses);
  await cost('GET /v1/music/find (Core, 3 never-play rules)', find(), 200, core);
  // Songs' tags served to a mind session: the Worker taints it (Core) and records a night session as
  // a reader (Music), once a session in each isolate.
  const tags = (s: string) => () =>
    api('GET', `/v1/music/notes?ids=${ids[0]}`, { token: night, headers: { 'TH-Session': s } });
  await cost(
    "GET /v1/music/notes, songs' tags to a night session, its first call (Core)",
    tags('cse_cost_1'),
    200,
    core,
  );
  await cost("GET /v1/music/notes, songs' tags to a night session, its first call (Music)", tags('cse_cost_2'), 200, m);
  await cost(
    "GET /v1/music/notes, songs' tags to a night session, its next call (Core)",
    tags('cse_cost_2'),
    200,
    core,
  );
}

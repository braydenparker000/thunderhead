// The mind's music calls of the cost suite (cost.test.ts checks every budget; MUSIC.md §10.5): a
// night's batch of 200 notes into a catalog of 300 tracks (cold: the tags are read once, then each
// note is one row checked and one written), the same batch again (nothing written), notes by id
// and a page (from memory), the next untagged page, and find in each object it reads: Music (cold:
// the tags and every note once; warm: nothing), Senses (the early skips by the (day, type) index,
// not the day's other events; warm: from memory) and Core (the current rules only).
import { evictDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { NewAgentResponse, SignedIn } from '../../../shared/contract/api';
import { sensesObject } from '../../src/objects/senses';
import { api, apiJson, coreSql, core as coreStub, PASSWORD } from '../helpers';
import { music, note, seedCatalog, sendSenses, songId } from '../music-helpers';

type Cost = (name: string, fn: () => Promise<Response>, status: number, stub?: never) => Promise<void>;

const TRACKS = 300;
const NOTES = 200;

export async function musicCalls(cost: Cost, grant: (ip: string, password?: string) => Promise<SignedIn>) {
  const d = await grant('192.0.2.251', `${PASSWORD} new`);
  const night = (
    await apiJson<NewAgentResponse>('POST', '/v1/auth/agents', {
      token: d.token,
      body: { name: 'night-cost-music', role: 'mind:night', current_password: `${PASSWORD} new` },
    })
  ).body.token;
  const m = music() as unknown as never;
  const senses = sensesObject(env) as unknown as never;
  const core = coreStub() as unknown as never;
  const ids = await seedCatalog(
    Array.from({ length: TRACKS }, (_, i) => ({ title: `Cost song ${i}`, artist: `Artist ${i % 20}`, genre: 'Pop' })),
  );
  const batch = ids.slice(0, NOTES).map((id, i) =>
    note(id, {
      moods: { calm: 0.8, dreamy: 0.5, nostalgic: 0.3 },
      occasions: { 'wind-down': 0.7, study: 0.4 },
      themes: ['night'],
      language: 'en',
      era: 1990 + (i % 3) * 10,
      energy: (i % 10) / 10,
      conf: { themes: 0.5, language: 0.9, era: 0.6, energy: 0.6 },
    }),
  );
  const put = () => api('PUT', '/v1/music/notes', { token: night, body: { items: batch } });
  await evictDurableObject(music());
  await cost(`PUT /v1/music/notes, ${NOTES} notes (Music, cold: ${TRACKS} tracks)`, put, 200, m);
  await cost(`PUT /v1/music/notes, ${NOTES} notes again, unchanged (Music)`, put, 200, m);
  const fifty = ids.slice(0, 50).join(',');
  await cost(
    'GET /v1/music/notes?ids= 50 (Music)',
    () => api('GET', `/v1/music/notes?ids=${fifty}`, { token: night }),
    200,
    m,
  );
  await cost(
    'GET /v1/music/notes, a page of 200 (Music)',
    () => api('GET', '/v1/music/notes', { token: night }),
    200,
    m,
  );
  await cost(
    'GET /v1/music/tracks?untagged=1, 200 (Music)',
    () => api('GET', '/v1/music/tracks?untagged=1&limit=200', { token: night }),
    200,
    m,
  );

  // Find: a day of the phone's senses (40 early skips among 200 events) and three never-play rules.
  const events = Array.from({ length: 200 }, (_, i) => ({
    type: i % 5 ? 'music.play' : 'music.skip',
    id: songId(1 + (i % 50)),
    at_ms: 3_000,
  }));
  await sendSenses(d.token, events);
  for (let i = 0; i < 3; i++)
    await coreSql(
      `INSERT INTO facts (id, kind, about, subject, text, source, confidence, evidence_json, recorded_at, last_confirmed,
         sensitivity, written_by, lineage_id)
       VALUES (?, 'rule', 'owner', 'music.never', ?, 'user', 1, '[]', ?, ?, 0, 'owner', ?)`,
      `cost-rule-${i}`,
      `Never play this again (music:${ids[i]}).`,
      Date.now(),
      Date.now(),
      `cost-rule-${i}`,
    );
  const find = () => api('GET', '/v1/music/find?moods=calm&occasion=wind-down&limit=30', { token: night });
  await evictDurableObject(music());
  await cost(`GET /v1/music/find (Music, cold: ${TRACKS} tracks, ${NOTES} notes)`, find, 200, m);
  await cost('GET /v1/music/find (Music, warm)', find, 200, m);
  await evictDurableObject(sensesObject(env));
  await cost('GET /v1/music/find (Senses, cold: 40 early skips among 200 events)', find, 200, senses);
  await cost('GET /v1/music/find (Senses, warm)', find, 200, senses);
  await cost('GET /v1/music/find (Core, 3 never-play rules)', find, 200, core);
}

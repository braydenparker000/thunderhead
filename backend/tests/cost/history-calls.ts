// The listening history's calls of the cost suite (MUSIC.md §11, DATA.md §8): a Spotify export of
// 6,000 invented streams (about 5,000 summary rows) taken, imported by Core's alarm in a split and
// three parts of 2,000 (the first MusicBrainz step follows in the same alarm), the same file again,
// and what the mind reads: the files, the taste, similar artists fetched and then kept. Every outside
// service is a fake (history-helpers.ts).
import { runInDurableObject } from 'cloudflare:test';
import type { NewAgentResponse, SignedIn } from '../../../shared/contract/api';
import { useFetch } from '../../src/areas/music/history-mb';
import type { Core } from '../../src/objects/core';
import { api, apiJson, core, PASSWORD } from '../helpers';
import { fakeBrainz, mbidOf, putHistory, spotifyRows } from '../history-helpers';
import { music } from '../music-helpers';

type Cost = (name: string, fn: () => Promise<Response>, status: number, stub?: unknown) => Promise<void>;

export async function historyCalls(cost: Cost, grant: (ip: string, password?: string) => Promise<SignedIn>) {
  useFetch(fakeBrainz([]));
  const d = await grant('192.0.2.252', `${PASSWORD} new`);
  const made = await apiJson<NewAgentResponse>('POST', '/v1/auth/agents', {
    token: d.token,
    body: { name: 'chat-history-cost', role: 'mind:chat', current_password: `${PASSWORD} new` },
  });
  const m = { token: made.body.token, headers: { 'TH-Session': 'cse_cost_history' } };
  const body = {
    claim: false,
    session_id: 'cse_cost_history',
    role: 'chat',
    constitution_sha256: 'none',
    th_version: '0.1.0',
  };
  await api('POST', '/v1/mind/brief', { ...m, body });
  const bytes = new TextEncoder().encode(JSON.stringify(spotifyRows(6_000, 997, 5)));
  const name = 'Streaming_History_Audio_2019-2023_0.json';
  const put = async () => {
    const r = await putHistory(d.token, name, bytes);
    return new Response(null, { status: r.status });
  };
  const alarm = async () => {
    await runInDurableObject(core() as unknown as DurableObjectStub<Core>, (o: Core) => o.alarm());
    return new Response(null, { status: 200 });
  };
  const k = core();
  const mu = music();
  await cost('PUT /v1/music/history, a new file of 6,000 streams (Core)', put, 202, k);
  await cost("music.history: the file's whole import in one alarm, 5,000 rows (Music)", alarm, 200, mu);
  await cost('PUT /v1/music/history, the same file again (Music)', put, 200, mu);
  await cost('GET /v1/music/history (Music)', () => api('GET', '/v1/music/history', d), 200, mu);
  await cost('GET /v1/music/taste (Music)', () => api('GET', '/v1/music/taste', m), 200, mu);
  const similar = () => api('GET', `/v1/music/similar/${mbidOf(1)}`, m);
  await cost('GET /v1/music/similar/:mbid, fetched (Music)', similar, 200, mu);
  await cost('GET /v1/music/similar/:mbid, kept (Music)', similar, 200, mu);
  // The second file's import, measured in Core: its job rows, the lane and the ledger note.
  const other = new TextEncoder().encode(JSON.stringify(spotifyRows(6_001, 997, 5)));
  await putHistory(d.token, 'Streaming_History_Audio_2019-2023_1.json', other);
  await cost("music.history: the file's whole import in one alarm, 5,000 rows (Core)", alarm, 200, k);
}

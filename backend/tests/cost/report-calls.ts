// The phone's report calls of the cost suite (cost.test.ts checks every budget): one batch, and a
// page of 50 from a table of 250, which reads its own rows and not the table. Then Podcasts' sync
// (podcast-calls.ts) and the Briefing page (briefing-calls.ts), from the same `it` (cost.test.ts
// stays under 300 lines).
import type { SignedIn } from '../../../shared/contract/api';
import { api, core, coreSql, PASSWORD } from '../helpers';
import { briefingCalls } from './briefing-calls';
import { podcastCalls } from './podcast-calls';

type Cost = (
  name: string,
  fn: () => Promise<Response>,
  status: number,
  stub?: ReturnType<typeof core>,
) => Promise<void>;

export async function reportCalls(cost: Cost, grant: (ip: string, password?: string) => Promise<SignedIn>) {
  const d = await grant('192.0.2.253', `${PASSWORD} new`);
  await api('GET', '/v1/auth/me', d);
  const body = {
    kind: 'playback',
    body: { v: 1, events: [{ t: 1200, type: 'first sound', track: 'r2_native_abc', ms: 840 }] },
  };
  await cost('POST /v1/ops/reports (Core)', () => api('POST', '/v1/ops/reports', { ...d, body }), 201, core());
  await coreSql(
    `INSERT INTO reports (kind, at, id, device_id, body_json)
     SELECT 'playback', ? - value, 'cost-' || value, 'seeded', '{"v":1}' FROM json_each(?)`,
    Date.now() - 60_000,
    JSON.stringify([...Array(249).keys()]),
  );
  await cost(
    'GET /v1/ops/reports (50 of 250) (Core)',
    () => api('GET', '/v1/ops/reports?kind=playback&limit=50', d),
    200,
    core(),
  );
}

export async function phoneCalls(cost: Cost, grant: (ip: string, password?: string) => Promise<SignedIn>) {
  await reportCalls(cost, grant);
  await podcastCalls(cost, grant);
  await briefingCalls(cost, grant);
}

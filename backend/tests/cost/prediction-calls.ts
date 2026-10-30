// The P9 prediction calls of the cost suite (cost.test.ts checks every budget): the night shift's
// prediction, the list, the skill, the meter, and a tick that resolves one whose day is over.
import { runInDurableObject } from 'cloudflare:test';
import type { NewAgentResponse, SignedIn } from '../../../shared/contract/api';
import { logicalDay } from '../../src/areas/conversation/day';
import { uuidv7 } from '../../src/lib/ids';
import { dayBefore } from '../../src/lib/time';
import type { Core } from '../../src/objects/core';
import { api, apiJson, core, coreSql, PASSWORD } from '../helpers';

type Cost = (
  name: string,
  fn: () => Promise<Response>,
  status: number,
  stub?: ReturnType<typeof core>,
) => Promise<void>;

export async function predictionCalls(cost: Cost, grant: (ip: string, password?: string) => Promise<SignedIn>) {
  const pw = `${PASSWORD} new`;
  const d = await grant('192.0.2.252', pw);
  const token = (
    await apiJson<NewAgentResponse>('POST', '/v1/auth/agents', {
      token: d.token,
      body: { name: 'night-cost-9', role: 'mind:night', current_password: pw },
    })
  ).body.token;
  const n = { token };
  await api('GET', '/v1/auth/me', n);
  const settings = await apiJson<Record<string, unknown>>('GET', '/v1/settings', d);
  const open = String(
    settings.body['day.current'] ?? logicalDay(Date.now(), String(settings.body['owner.tz'] ?? 'UTC')),
  );
  const body = { category: 'chat.any', args: {}, day: dayBefore(open, -1), p: 0.8, why: 'Writes most days.' };
  await cost(
    'PUT /v1/predictions/:id (Core)',
    () => api('PUT', `/v1/predictions/${uuidv7()}`, { ...n, body }),
    200,
    core(),
  );
  await cost('GET /v1/predictions (Core)', () => api('GET', '/v1/predictions?open=1', d), 200, core());
  await cost('GET /v1/predictions/skill (Core)', () => api('GET', '/v1/predictions/skill', d), 200, core());
  await cost('GET /v1/insight (Core)', () => api('GET', '/v1/insight', d), 200, core());
  await coreSql(
    `INSERT INTO predictions (id, made_at, made_by, category, args_json, day, p, why, req_sha256)
     VALUES (?, 0, 'mind:night', 'chat.before', '{"time":"09:00"}', ?, 0.6, 'synthetic', 'x')`,
    uuidv7(),
    dayBefore(open),
  );
  const tick = async () => {
    await runInDurableObject(core() as unknown as DurableObjectStub<Core>, (o: Core) => o.tick());
    return new Response(null, { status: 204 });
  };
  await cost('cron tick, resolving a prediction (Core)', tick, 204, core());
}

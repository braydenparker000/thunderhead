// Scheduled actions and plans in the cost suite (cost.test.ts checks every budget; API.md §11.11),
// on a Core that already holds every other call's rows: a verb queued for later, the list of what
// waits, a plan of two Worker-side steps, and home's read of today's plan lines (its ledger rows of
// kind `plan` since the day began, which reads through the ledger's time index).
import type { NewAgentResponse, SignedIn } from '../../../shared/contract/api';
import { uuidv7 } from '../../src/lib/ids';
import { api, apiJson, core, PASSWORD } from '../helpers';

type Cost = (
  name: string,
  fn: () => Promise<Response>,
  status: number,
  stub?: ReturnType<typeof core>,
) => Promise<void>;

export async function verbCalls(cost: Cost, grant: (ip: string, password?: string) => Promise<SignedIn>) {
  // "Today" for home's read: the six hours before cover every row the suite wrote.
  const since = Date.now() - 6 * 3_600_000;
  const d = await grant('192.0.2.249', `${PASSWORD} new`);
  const token = (
    await apiJson<NewAgentResponse>('POST', '/v1/auth/agents', {
      token: d.token,
      body: { name: 'night-cost-plans', role: 'mind:night', current_password: `${PASSWORD} new` },
    })
  ).body.token;
  const n = { token };
  const k = core();
  const later = {
    verb: 'shell.appearance',
    schema: 1,
    args: { mode: 'night' },
    why: 'the owner asked for night mode at nine',
    fire_at: new Date(Date.now() + 3_600_000).toISOString(),
  };
  await cost(
    'PUT /v1/verbs/:id (fire_at) (Core)',
    () => api('PUT', `/v1/verbs/${uuidv7()}`, { ...n, body: later }),
    201,
    k,
  );
  await cost('GET /v1/verbs/scheduled (1 waiting) (Core)', () => api('GET', '/v1/verbs/scheduled', d), 200, k);
  const plan = {
    id: uuidv7(),
    why: 'the owner asked for the evening',
    what: 'Set up your evening.',
    steps: [
      { verb: 'settings.set', schema: 1, args: { key: 'briefing.units', value: 'f' } },
      { verb: 'briefing.pin_tile', schema: 1, args: { tile: 'due' } },
    ],
  };
  await cost('POST /v1/verbs/plan (2 steps) (Core)', () => api('POST', '/v1/verbs/plan', { ...n, body: plan }), 201, k);
  await cost(
    'GET /v1/ledger (kind plan, today) (Core)',
    () => api('GET', `/v1/ledger?kind=plan&since=${since}&limit=20`, d),
    200,
    k,
  );
}

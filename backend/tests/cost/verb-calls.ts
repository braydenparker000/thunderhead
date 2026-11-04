// Scheduled actions and plans in the cost suite (cost.test.ts checks every budget; API.md §11.11),
// on a Core that already holds every other call's rows: a verb queued for later, the list of what
// waits, a plan of two Worker-side steps, and home's read of today's plan lines (its ledger rows of
// kind `plan` since the day began, which reads through the ledger's time index). Then routines: two
// stored (as a yes would), Settings' read of them, the tick with none due (the soonest is one index
// read, then kept in memory) and the tick that runs one of two steps.
import { runInDurableObject } from 'cloudflare:test';
import type { NewAgentResponse, SignedIn } from '../../../shared/contract/api';
import { insert as insertRoutine } from '../../src/areas/verbs/routine-store';
import { uuidv7 } from '../../src/lib/ids';
import type { Writer } from '../../src/objects/commit';
import type { Core } from '../../src/objects/core';
import { api, apiJson, core, PASSWORD } from '../helpers';
import { ticks } from './ticks';

type Writes = { write: (fn: (w: Writer) => void) => void };
/** A routine stored on, due at `next` (what the owner's yes writes, without the card). */
function routineRow(name: string, next: number) {
  const id = uuidv7();
  const steps = [
    { verb: 'settings.set', schema: 1, args: { key: 'briefing.units', value: 'c' }, device_id: null },
    { verb: 'briefing.pin_tile', schema: 1, args: { tile: 'holidays' }, device_id: null },
  ];
  return {
    id,
    name,
    what: 'The Briefing is set.',
    why: 'the owner sets the Briefing up most days',
    steps_json: JSON.stringify(steps),
    cond_json: JSON.stringify({ at: '12:00' }),
    when_text: 'Every day at 12:00',
    event_type: null,
    actor: 'mind:night',
    proposal_id: uuidv7(),
    permit: 'tell',
    status: 'on' as const,
    approved_at: Date.now(),
    updated_at: Date.now(),
    next_at: next,
    last_run_at: null,
    last_ledger_id: null,
    last_day: null,
    last_error: null,
  };
}

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
  const stub = k as unknown as DurableObjectStub<Core>;
  const store = (rows: ReturnType<typeof routineRow>[]) =>
    runInDurableObject(stub, (o: Core) =>
      (o as unknown as Writes).write((w) => {
        for (const r of rows) insertRoutine(w.db, r);
        w.change('routine', null);
      }),
    );
  const tomorrow = Date.now() + 86_400_000;
  await store([routineRow('Noon briefing', tomorrow), routineRow('Evening briefing', tomorrow + 3_600_000)]);
  await cost('GET /v1/routines (2 routines) (Core)', () => api('GET', '/v1/routines', d), 200, k);
  await ticks(k, async (tick) => {
    await cost('cron tick, 2 routines not due (Core)', tick, 204, k);
  });
  await store([routineRow('Briefing now', Date.now() - 1_000)]);
  await ticks(k, async (tick) => {
    await cost('cron tick, running a routine of 2 steps (Core)', tick, 204, k);
  });
}

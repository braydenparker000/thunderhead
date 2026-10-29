// The P3 import's calls in the cost suite (cost.test.ts checks every budget): a part and the
// manifest (the private bucket only, no Core rows), a run of 50 old threads in one part and its
// verification, its status, and the same run again, whose step writes only its own bookkeeping
// (the run, the job, the lane and the ledger row): no imported row changes.
import { runInDurableObject } from 'cloudflare:test';
import type { NewAgentResponse, SignedIn } from '../../../shared/contract/api';
import { uuidv7 } from '../../src/lib/ids';
import type { Core } from '../../src/objects/core';
import { api, apiJson, core, PASSWORD } from '../helpers';
import { gz, oldChats, postPart, sha } from '../import-helpers';

type Cost = (
  name: string,
  fn: () => Promise<Response>,
  status: number,
  stub?: ReturnType<typeof core>,
) => Promise<void>;

export async function importCalls(cost: Cost, grant: (ip: string, password?: string) => Promise<SignedIn>) {
  const pw = `${PASSWORD} new`;
  const d = await grant('192.0.2.241', pw);
  const chat = (
    await apiJson<NewAgentResponse>('POST', '/v1/auth/agents', {
      token: d.token,
      body: { name: 'import-cost', role: 'mind:chat', current_password: pw },
    })
  ).body.token;
  await api('GET', '/v1/auth/me', { token: chat });
  const k = core();
  const { threads } = oldChats('cost', 3, 50, 0);
  const bytes = await gz(threads);
  await cost(
    'POST /v1/ops/import/parts (Core)',
    () => postPart(chat, 'run-cost/claude-chat-v1/cc_threads/0001', bytes, 50),
    201,
    k,
  );
  const manifest = {
    run_id: 'run-cost',
    worker_version: null,
    started_at: 1,
    finished_at: 2,
    instances: {
      'claude-chat-v1': {
        tables: {
          cc_threads: { rows: 50, parts: 1, columns: Object.keys(threads[0]), sha256s: [await sha(bytes)] },
        },
      },
    },
  };
  await cost(
    'PUT /v1/ops/import/manifest/:run_id (Core)',
    () => api('PUT', '/v1/ops/import/manifest/run-cost', { token: chat, body: manifest }),
    201,
    k,
  );
  // The start arms Core's alarm, which runs the job at once; a start and its job are measured
  // together, running the alarm here only when it hasn't yet.
  const done = async (id: string) =>
    (await apiJson<{ state: string }>('GET', `/v1/import/runs/${id}`, d)).body.state === 'done';
  const run = (id: string) => async () => {
    const res = await api('POST', '/v1/import/runs', { ...d, body: { id, run_id: 'run-cost', dataset: 'threads' } });
    for (let i = 0; i < 5 && !(await done(id)); i++)
      await runInDurableObject(k as unknown as DurableObjectStub<Core>, (o: Core) => o.alarm());
    return res;
  };
  const id = uuidv7();
  await cost('POST /v1/import/runs and its job: 1 part of 50 threads, verified (Core)', run(id), 202, k);
  await cost('GET /v1/import/runs/:id (Core)', () => api('GET', `/v1/import/runs/${id}`, d), 200, k);
  await cost('POST /v1/import/runs and its job: the same part again, no row changed (Core)', run(uuidv7()), 202, k);
}

// The P3 memory calls of the cost suite (cost.test.ts runs them and checks every budget): on a
// Core that already holds the P2 rows, plus a handful of facts, one loose end and one day note,
// so each figure is a call's own cost, not a table scan. Then the night shift's run record and a
// closed day's input (stage C).
import type { BriefResponse, Message, NewAgentResponse, SignedIn } from '../../../shared/contract/api';
import { uuidv7 } from '../../src/lib/ids';
import { api, apiJson, core, PASSWORD } from '../helpers';

type Cost = (
  name: string,
  fn: () => Promise<Response>,
  status: number,
  stub?: ReturnType<typeof core>,
) => Promise<void>;

export async function memoryCalls(cost: Cost, grant: (ip: string, password?: string) => Promise<SignedIn>) {
  const pw = `${PASSWORD} new`;
  const d = await grant('192.0.2.231', pw);
  const agent = async (name: string, role: string) =>
    (
      await apiJson<NewAgentResponse>('POST', '/v1/auth/agents', {
        token: d.token,
        body: { name, role, current_password: pw },
      })
    ).body.token;
  const m = { token: await agent('chat-cost-3', 'mind:chat'), headers: { 'TH-Session': 'cse_cost_session' } };
  const n = { token: await agent('night-cost-3', 'mind:night'), headers: { 'TH-Session': 'cse_cost_night' } };
  await api('GET', '/v1/auth/me', m);
  await api('GET', '/v1/auth/me', n);
  // Memory writes need a claimed session of the writer's role (the chat one claimed in the P2 run).
  const claim = {
    claim: true,
    session_id: 'cse_cost_night',
    role: 'night',
    constitution_sha256: 'none',
    th_version: '0.1.0',
  };
  // The night briefing names the closed day the night works on.
  const nightDay = (await apiJson<BriefResponse>('POST', '/v1/mind/brief', { ...n, body: claim })).body.day;
  const said = (await apiJson<Message>('PUT', `/v1/messages/${uuidv7()}`, { ...d, body: { body: 'I like tea.' } }))
    .body;
  const k = core();
  const add = (text: string) => ({
    batch_id: uuidv7(),
    ops: [{ op: 'add', id: uuidv7(), kind: 'preference', text, source: 'user', evidence: [`msg:${said.id}`] }],
  });
  for (const t of ['Likes green tea', 'Likes rain', 'Likes calm music'])
    await api('POST', '/v1/memory/ops', { ...m, body: add(t) });
  await cost(
    'POST /v1/memory/ops (1 add) (Core)',
    () => api('POST', '/v1/memory/ops', { ...m, body: add('Likes long walks') }),
    200,
    k,
  );
  await cost('GET /v1/memory/facts (4 facts) (Core)', () => api('GET', '/v1/memory/facts', d), 200, k);
  const [first] = (await apiJson<{ items: { id: string }[] }>('GET', '/v1/memory/facts', d)).body.items;
  await cost('GET /v1/memory/facts/:id (Core)', () => api('GET', `/v1/memory/facts/${first.id}`, d), 200, k);
  await cost('GET /v1/memory/profile (4 facts) (Core)', () => api('GET', '/v1/memory/profile', d), 200, k);
  const thread = { text: 'Buy more tea', owner: 'owner', evidence: [`msg:${said.id}`] };
  await cost(
    'PUT /v1/memory/open-threads/:id (Core)',
    () => api('PUT', `/v1/memory/open-threads/${uuidv7()}`, { ...m, body: thread }),
    200,
    k,
  );
  await cost('GET /v1/memory/open-threads (Core)', () => api('GET', '/v1/memory/open-threads', d), 200, k);
  const note = { summary: 'A quiet day with tea.', decisions: [], importance: 3 };
  await cost(
    'PUT /v1/memory/day-notes/:day (Core)',
    () => api('PUT', '/v1/memory/day-notes/2020-01-02', { ...n, body: note }),
    200,
    k,
  );
  await cost('GET /v1/memory/day-notes (Core)', () => api('GET', '/v1/memory/day-notes', d), 200, k);
  await cost('GET /v1/search (messages, facts, day notes) (Core)', () => api('GET', '/v1/search?q=tea', d), 200, k);

  const step = (body: object) => api('POST', '/v1/mind/night', { ...n, body: { day: nightDay, ...body } });
  await cost('POST /v1/mind/night (start) (Core)', () => step({ action: 'start' }), 200, k);
  await cost('POST /v1/mind/night (step done) (Core)', () => step({ action: 'step_done', step: 1 }), 200, k);
  await cost(
    'POST /v1/mind/night (step again, nothing new) (Core)',
    () => step({ action: 'step_done', step: 1 }),
    200,
    k,
  );
  for (const part of ['stats', 'messages', 'ledger', 'notes'])
    await cost(
      `GET /v1/mind/day/:day (${part}) (Core)`,
      () => api('GET', `/v1/mind/day/${nightDay}?part=${part}`, n),
      200,
      k,
    );
}

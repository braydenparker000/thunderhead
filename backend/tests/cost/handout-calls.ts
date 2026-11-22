// The handout's call of the cost suite (cost.test.ts checks every budget; feed/handout.ts): one
// owner message handed out by GET /v1/live/wait to the chat session, with the presence set to
// working by the Worker and the message's memories searched by words in Core (messages, facts, day
// notes; the meaning search has no model here, so it adds no Core rows). Run after the settings'
// calls, on a Core holding the suite's earlier messages. Its time is printed beside the table.
import type { LiveWaitResponse, NewAgentResponse, SignedIn } from '../../../shared/contract/api';
import { uuidv7 } from '../../src/lib/ids';
import { api, apiJson, core, coreSql, PASSWORD } from '../helpers';

type Cost = (
  name: string,
  fn: () => Promise<Response>,
  status: number,
  stub?: ReturnType<typeof core>,
) => Promise<void>;

export async function handoutCalls(cost: Cost, grant: (ip: string, password?: string) => Promise<SignedIn>) {
  const pw = `${PASSWORD} new`;
  const d = await grant('192.0.2.249', pw);
  const made = await apiJson<NewAgentResponse>('POST', '/v1/auth/agents', {
    token: d.token,
    body: { name: 'chat-handout-cost', role: 'mind:chat', current_password: pw },
  });
  const m = { token: made.body.token, headers: { 'TH-Session': 'cse_cost_handout' } };
  await api('GET', '/v1/auth/me', d);
  await api('GET', '/v1/auth/me', m);
  // An earlier session's lease would refuse this one: it has long gone.
  await coreSql('DELETE FROM leases');
  await coreSql("UPDATE messages SET answered_at = 1 WHERE author = 'owner' AND answered_at IS NULL");
  const claim = {
    claim: true,
    session_id: 'cse_cost_handout',
    role: 'chat',
    constitution_sha256: 'none',
    th_version: '0.1.0',
  };
  await api('POST', '/v1/mind/brief', { ...m, body: claim });
  const seq = (await apiJson<LiveWaitResponse>('GET', '/v1/live/wait?after=0&timeout=1', m)).body.seq;
  await api('PUT', `/v1/messages/${uuidv7()}`, { token: d.token, body: { body: 'what was message number 7 about' } });
  let ms = 0;
  await cost(
    'GET /v1/live/wait (1 owner message handed out, recall and presence) (Core)',
    async () => {
      const t = Date.now();
      const r = await api('GET', `/v1/live/wait?after=${seq}&timeout=1`, m);
      ms = Date.now() - t;
      return r;
    },
    200,
    core(),
  );
  console.log(`handout with recall: ${ms} ms`);
  // Leave no live session or open message behind for the calls measured after these: it stops.
  await coreSql("UPDATE messages SET answered_at = 1 WHERE author = 'owner' AND answered_at IS NULL");
  await api('POST', '/v1/mind/status', { ...m, body: { state: 'stopping' } });
}

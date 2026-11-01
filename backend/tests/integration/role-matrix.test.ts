// RUNTIME.md §7.1's token scopes, capability by capability, for every role: the rules inside routes
// that the route-scope test (who may call a route at all) can't see ("role tokens enforced", P4). Each key has a claimed session
// of its own role, so a refusal here is the role's, never a missing session. Synthetic data only.
import { beforeAll, describe, expect, it } from 'vitest';
import type { BriefResponse } from '../../../shared/contract/api';
import { uuidv7 } from '../../src/lib/ids';
import { apiJson, coreSql, makeAgent, setupOwner } from '../helpers';
import { addOp, firedWake, ownerSays } from '../memory-helpers';
import { note, seedCatalog } from '../music-helpers';

type Role = 'D' | 'C' | 'N' | 'R' | 'M' | 'I';
const SESSION: Partial<Record<Role, string>> = { C: 'cse_matrix_chat', N: 'cse_matrix_night', R: 'cse_matrix_reflex' };
const ROLE = { C: 'chat', N: 'night', R: 'reflex' } as const;
const tokens = {} as Record<Role, string>;
/** The CI key's id: a revoke card must name a key that exists. */
let ciKey = '';
/** A track in a synthetic catalog, for the music notes. */
let song = '';

beforeAll(async () => {
  tokens.D = (await setupOwner()).token;
  tokens.C = await makeAgent(tokens.D, 'mind:chat');
  tokens.N = await makeAgent(tokens.D, 'mind:night');
  tokens.R = await makeAgent(tokens.D, 'mind:reflex');
  tokens.M = await makeAgent(tokens.D, 'muse');
  tokens.I = await makeAgent(tokens.D, 'ci');
  ciKey = (await apiJson<{ agent_id: string }>('GET', '/v1/auth/me', { token: tokens.I })).body.agent_id;
  [song] = await seedCatalog([{ title: 'A Synthetic Song', artist: 'Test Artist' }]);
  for (const r of ['C', 'N', 'R'] as const) {
    const s = SESSION[r] as string;
    const b = await apiJson<BriefResponse>('POST', '/v1/mind/brief', {
      token: tokens[r],
      headers: { 'TH-Session': s },
      body: { claim: true, session_id: s, role: ROLE[r], constitution_sha256: 'a'.repeat(64), th_version: '0.1.0' },
    });
    expect(b.status).toBe(200);
  }
});

const as = (r: Role): { token: string; headers: Record<string, string> } => {
  const s = SESSION[r];
  return { token: tokens[r], headers: s ? { 'TH-Session': s } : {} };
};
const status = async (r: Role, method: string, path: string, body?: unknown) =>
  (await apiJson(method, path, { ...as(r), body })).status;
const revokeCard = () => ({
  class: 'access',
  question: 'Revoke the CI key?',
  why: 'It is no longer used.',
  if_ignored: 'Nothing happens.',
  options: ['Revoke it', 'Keep it'],
  spec: { v: 1, op: 'agents.revoke', args: { agent_id: ciKey } },
});

/** Each capability: the request, and the roles that may do it (every other role is refused). */
const CAPABILITIES: { name: string; may: Role[]; call: (r: Role) => Promise<number> }[] = [
  {
    name: 'post a reply in a conversation thread',
    may: ['D', 'C'],
    call: (r) => status(r, 'PUT', `/v1/messages/${uuidv7()}`, { body: 'hello' }),
  },
  {
    name: 'post an error line to the system thread',
    may: ['N', 'R'],
    call: (r) =>
      status(r, 'PUT', `/v1/messages/${uuidv7()}`, {
        kind: 'error',
        thread_id: 'system',
        body: 'night step 3 failed: timeout',
      }),
  },
  {
    name: 'write a home line (surfaces)',
    may: ['C', 'N'],
    call: (r) =>
      status(r, 'PUT', '/v1/surfaces/home/line.1', {
        kind: 'line',
        schema: 1,
        payload: { text: 'Hi.' },
        why: 'a short greeting',
        topic_key: `greeting-${r.toLowerCase()}`,
      }),
  },
  {
    name: 'remember a fact',
    may: ['C', 'N', 'D'],
    call: async (r) => {
      const msg = await ownerSays(tokens.D, 'I like calm music in the evening');
      const op = r === 'D' ? { ...addOp([`msg:${msg}`]), source: 'user' } : addOp([`msg:${msg}`]);
      return status(r, 'POST', '/v1/memory/ops', { batch_id: uuidv7(), ops: [op] });
    },
  },
  { name: 'read memory', may: ['D', 'C', 'N'], call: (r) => status(r, 'GET', '/v1/memory/facts') },
  {
    name: 'raise a decision card',
    may: ['C', 'N', 'R'],
    // Cancelled at once: one card waits per key, and the next role asks about the same one.
    call: async (r) => {
      const put = await apiJson<{ id: string }>('PUT', `/v1/proposals/${uuidv7()}`, { ...as(r), body: revokeCard() });
      if (put.status < 300)
        await apiJson('POST', `/v1/proposals/${put.body.id}/cancel`, {
          token: tokens.D,
          body: { why: 'clearing the matrix' },
        });
      return put.status;
    },
  },
  {
    name: 'read the ledger, errors and health',
    may: ['D', 'C', 'N', 'R'],
    call: (r) => status(r, 'GET', '/v1/ledger'),
  },
  {
    name: 'write what it knows of a song (music notes)',
    may: ['C', 'N'],
    call: (r) => status(r, 'PUT', '/v1/music/notes', { items: [note(song, { moods: { calm: 0.8 } })] }),
  },
  // Songs' tags taint the session that reads them (MUSIC.md §10.5): the cards below take a fresh chat.
  { name: 'read the music notes', may: ['D', 'C', 'N'], call: (r) => status(r, 'GET', `/v1/music/notes?ids=${song}`) },
  { name: 'find songs by feeling', may: ['C', 'N'], call: (r) => status(r, 'GET', '/v1/music/find?moods=calm') },
  { name: 'issue agent keys (auth admin)', may: ['D'], call: (r) => status(r, 'GET', '/v1/auth/agents') },
  { name: 'change settings', may: ['D'], call: (r) => status(r, 'PATCH', '/v1/settings', { 'quiet.start': '22:00' }) },
  // NEXT-BATCH.md part 7: Podcasts' positions and follows. The phone writes them; the night reads
  // them (new episodes, leaving out those started) and records the shows it read.
  {
    name: 'sync Podcasts positions and follows',
    may: ['D'],
    call: (r) =>
      status(r, 'PUT', '/v1/podcasts/progress', {
        items: [
          {
            key: 'https://feeds.example.org/matrix.xml#0123456789abcdef',
            position_s: 12,
            duration_s: 60,
            played: false,
            updated_at: Date.now() - 1000,
          },
        ],
      }),
  },
  {
    name: 'read Podcasts positions and follows',
    may: ['D', 'N'],
    call: async (r) =>
      Math.max(
        await status(r, 'GET', '/v1/podcasts/progress?since=0'),
        await status(r, 'GET', '/v1/podcasts/follows?since=0'),
      ),
  },
  {
    name: "record the night's check of a followed show",
    may: ['N'],
    call: (r) =>
      status(r, 'POST', '/v1/podcasts/follows/checked', {
        items: [{ show_id: '0123456789abcdef', latest_at: null, new_n: 0 }],
      }),
  },
];

describe('RUNTIME.md §7.1, capability by role', () => {
  for (const cap of CAPABILITIES)
    it(cap.name, async () => {
      for (const r of ['D', 'C', 'N', 'R', 'M', 'I'] as Role[]) {
        const s = await cap.call(r);
        if (cap.may.includes(r)) expect(s, `${r} may ${cap.name}`).toBeLessThan(300);
        // 403 for a role the route refuses; 422 where the route takes the role but not this request
        // (only night and reflex may name the system thread).
        else expect([403, 422], `${r} may not ${cap.name} (${s})`).toContain(s);
      }
    });

  it('only a device decides by a tap, and only mind:chat records the owner’s words', async () => {
    // The chat that read songs above is tainted: the session the Worker fires next starts clean.
    await coreSql("UPDATE leases SET renewed_at = 0 WHERE task = 'chat'");
    await firedWake('chat', 'session_matrix_chat_2');
    SESSION.C = 'cse_matrix_chat_2';
    const b = await apiJson<BriefResponse>('POST', '/v1/mind/brief', {
      ...as('C'),
      body: {
        claim: true,
        session_id: SESSION.C,
        role: 'chat',
        constitution_sha256: 'a'.repeat(64),
        th_version: '0.1.0',
      },
    });
    expect([b.status, b.body.tainted]).toEqual([200, false]);
    const put = await apiJson<{ id: string; spec_hash: string }>('PUT', `/v1/proposals/${uuidv7()}`, {
      ...as('C'),
      body: revokeCard(),
    });
    const decide = (r: Role, body: object) => status(r, 'POST', `/v1/proposals/${put.body.id}/decide`, body);
    const tap = { decision: 'reject', spec_hash: put.body.spec_hash };
    for (const r of ['N', 'R', 'M', 'I'] as Role[]) expect(await decide(r, tap)).toBe(403);
    expect(await decide('C', tap)).toBe(422); // words only
    expect(await decide('D', { ...tap, by_message: uuidv7() })).toBe(422); // a tap only
    expect(await decide('D', tap)).toBe(200);
  });
});

// What comes with owner messages handed out by GET /v1/live/wait (feed/handout.ts): the presence set
// to working by the Worker itself, and `recall`, up to 5 memories from the search `th recall` runs:
// words matched and hits by meaning, never today's own conversation, never a memory labelled
// outside; none for a short message; the words alone when the meaning search is late; none on an
// error. And the briefing's part 1, where each waiting message carries up to 3. Invented text only.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { BriefResponse, LiveWaitResponse, Message, MindPresence } from '../../../shared/contract/api';
import { SEMANTIC } from '../../src/areas/search/sources';
import { uuidv7 } from '../../src/lib/ids';
import { apiJson, coreSql, makeAgent, setupOwner } from '../helpers';

const LIVE = SEMANTIC.recall;
let D = '';
let C = '';
const S = 'cse_handout_session';
const as = (token: string) => ({ token, headers: { 'TH-Session': S } });
const say = (body: string) => apiJson<Message>('PUT', `/v1/messages/${uuidv7()}`, { token: D, body: { body } });
const wait = (after: number) => apiJson<LiveWaitResponse>('GET', `/v1/live/wait?after=${after}&timeout=1`, as(C));
const presence = async () =>
  JSON.parse(
    (await coreSql<{ value_json: string }>("SELECT value_json FROM settings WHERE key = 'mind.status'"))[0].value_json,
  ) as MindPresence;
/** Hands out one owner message and returns it as the wait gave it. */
async function handOut(body: string) {
  const { body: start } = await wait(0);
  const m = (await say(body)).body;
  const got = (await wait(start.seq)).body.messages.find((x) => x.id === m.id);
  expect(got).toBeDefined();
  return got as LiveWaitResponse['messages'][number];
}
const meaning = (ref: string) => ({
  async run() {
    return [{ source: 'facts' as const, ref, snippet: 'A note found by meaning', at: 1, provenance: 'owner' as const }];
  },
});

beforeAll(async () => {
  D = (await setupOwner()).token;
  C = await makeAgent(D, 'mind:chat');
  const brief = { claim: true, session_id: S, role: 'chat', constitution_sha256: 'none', th_version: '0.1.0' };
  expect((await apiJson<BriefResponse>('POST', '/v1/mind/brief', { ...as(C), body: brief })).status).toBe(200);
  // An older conversation that mentions the fence, with its search entry, as the writer keeps it.
  await coreSql(
    `INSERT INTO messages (id, thread_id, created_at, author, origin, kind, body)
     VALUES ('old-fence-1', 'old-thread', ?, 'owner', 'owner_device', 'text', 'the garden fence painted green last spring')`,
    Date.now() - 30 * 86_400_000,
  );
  await coreSql("INSERT INTO messages_fts (rowid, body) SELECT seq, body FROM messages WHERE id = 'old-fence-1'");
});

afterEach(() => {
  SEMANTIC.recall = LIVE;
});

describe('the handout', () => {
  it('sets the presence to working without a model step', async () => {
    await coreSql("DELETE FROM settings WHERE key = 'mind.status'");
    SEMANTIC.recall = meaning('fact:by-meaning');
    await handOut('is anyone there at all');
    const p = await presence();
    expect(p.state).toBe('working');
    expect(p.note).toBeNull();
    // The session's own first report right after it still lands (its repeat slot is its own).
    const card = { state: 'working', title: 'Looking that up' };
    expect((await apiJson('POST', '/v1/mind/status', { ...as(C), body: card })).status).toBe(204);
    expect((await presence()).title).toBe('Looking that up');
  });

  it("carries the words' matches and the meaning's, never today's own conversation", async () => {
    SEMANTIC.recall = meaning('fact:by-meaning');
    const m = await handOut('the garden fence painted green');
    const refs = (m.recall ?? []).map((r) => r.ref);
    expect(refs).toContain('msg:old-fence-1');
    expect(refs).toContain('fact:by-meaning');
    expect(refs.every((r) => !r.startsWith(`msg:${m.id}`))).toBe(true);
    expect(m.recall?.length).toBeLessThanOrEqual(5);
    for (const r of m.recall ?? []) expect(r.text.length).toBeLessThanOrEqual(200);
  });

  it('a meaning search that is late leaves the words alone; the handout does not wait for it', async () => {
    SEMANTIC.recall = { run: () => new Promise(() => {}) };
    const started = Date.now();
    const m = await handOut('the garden fence painted green');
    expect(Date.now() - started).toBeLessThan(3_000);
    expect((m.recall ?? []).map((r) => r.ref)).toEqual(['msg:old-fence-1']);
  });

  it('none on an error, for a short message, or for a memory labelled outside', async () => {
    SEMANTIC.recall = {
      async run() {
        throw new Error('down');
      },
    };
    expect((await handOut('the garden fence painted green')).recall).toBeUndefined();
    SEMANTIC.recall = meaning('fact:by-meaning');
    expect((await handOut('fence green')).recall).toBeUndefined();
    SEMANTIC.recall = {
      async run() {
        return [{ source: 'facts' as const, ref: 'fact:outside', snippet: 'outside', at: 1, provenance: 'outside' }];
      },
    };
    const m = await handOut('the garden fence painted green');
    expect((m.recall ?? []).map((r) => r.ref)).not.toContain('fact:outside');
  });
});

describe("the briefing's parts", () => {
  it('part 1 shows a waiting message with its memories; parts stay under the cap', async () => {
    await say('the garden fence painted green');
    const r = await apiJson<BriefResponse>('POST', '/v1/mind/brief', {
      ...as(C),
      body: { claim: false, session_id: S, role: 'chat', constitution_sha256: 'none', th_version: '0.1.0' },
    });
    expect(r.body.parts).toHaveLength(3);
    for (const p of r.body.parts) expect(p.length).toBeLessThanOrEqual(9_400);
    expect(r.body.parts[0]).toMatch(/the garden fence painted green\n {2}recall \[msg:old-fence-1\]/);
    expect(r.body.role_section).toBeUndefined();
  });
});

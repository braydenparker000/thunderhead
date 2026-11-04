// Delete and Restore (decisions.md 2026-10-31 and 2026-11-01; conversation/held.ts): only the
// owner's device deletes or restores, never the mind (no route, no verb, no proposal op); a deleted
// conversation is gone at once from the menu, search, the briefing and the mind, and memory refuses
// it; deleting today's thread settles its waiting messages and the next message starts a fresh
// today; Recently deleted lists it for 30 days; Restore gives it back, beside a fresh today when one
// began, and after 30 days it is gone.
import { beforeAll, describe, expect, it } from 'vitest';
import type {
  BriefResponse,
  DeletedThreadsResponse,
  Page,
  RestoredThread,
  Thread,
  ThreadDeleted,
  TodayResponse,
} from '../../../shared/contract/api';
import { HELD_LIMITS } from '../../../shared/contract/held.ts';
import { PROPOSAL_OPS } from '../../../shared/contract/proposals.ts';
import { VERBS } from '../../../shared/contract/verbs.ts';
import { uuidv7 } from '../../src/lib/ids';
import { chat, say } from '../held-helpers';
import { api, apiJson, coreSql, makeAgent } from '../helpers';
import { addOp, CHAT_SESSION, ops, ownerSays, type Principals, principals, reason } from '../memory-helpers';

let p: Principals;
let R = '';
/** Yesterday's conversation (filed), with a word only it has. */
let past = '';
let pastMsg = '';
let reply = '';
let fact = '';

/** Files today's thread as of an earlier day, so the next message starts a fresh today. */
async function fileAs(threadId: string, day: string) {
  await coreSql("UPDATE threads SET day = ?, status = 'filed', filed_at = ? WHERE id = ?", day, Date.now(), threadId);
}
const del = (token: string, id: string) =>
  apiJson<ThreadDeleted & { error?: { code: string } }>('DELETE', `/v1/threads/${id}`, { token });
const restore = (token: string, id: string) =>
  apiJson<RestoredThread & { error?: { code: string } }>('POST', `/v1/threads/${id}/restore`, { token });
const listed = async (token: string) =>
  (await apiJson<Page<Thread>>('GET', '/v1/threads?limit=50', { token })).body.items.map((t) => t.id);
const hits = async (token: string, q: string) =>
  (await apiJson<{ items: unknown[] }>('GET', `/v1/search?q=${q}`, { token })).body.items.length;

beforeAll(async () => {
  p = await principals();
  R = await makeAgent(p.D, 'mind:reflex');
  const m = (await say({ token: p.D }, 'the pomegranate plan for the weekend')).body;
  pastMsg = m.id;
  past = m.thread_id;
  reply = (await say(chat(p.C), 'Saturday it is.', { reply_to: m.id })).body.id;
  fact = (await ops(chat(p.C), [addOp([`msg:${pastMsg}`], { text: 'Plans the weekend ahead' })])).body.applied[0]
    .fact_id;
  await fileAs(past, '2026-10-01');
});

describe('only the owner deletes and restores', () => {
  it('the mind, night and reflex keys get 403 on every held route; no verb or proposal op deletes', async () => {
    for (const token of [p.C, p.N, R]) {
      expect((await api('DELETE', `/v1/threads/${past}`, chat(token))).status).toBe(403);
      expect((await api('POST', `/v1/threads/${past}/restore`, chat(token))).status).toBe(403);
      expect((await api('GET', '/v1/threads/deleted', chat(token))).status).toBe(403);
    }
    // The verbs on a conversation file it under a topic or name it: they delete nothing, and a held
    // one is 404.
    expect(Object.keys(VERBS).filter((v) => /thread|conversation/.test(v))).toEqual(['thread.file', 'thread.title']);
    expect(Object.keys(PROPOSAL_OPS).filter((v) => /thread|conversation/.test(v))).toEqual([]);
  });
});

describe('a deleted conversation', () => {
  it('goes at once: out of the lists, reads 404, search finds nothing; a ledger row without its words', async () => {
    expect(await hits(p.D, 'pomegranate')).toBe(1);
    const r = await del(p.D, past);
    expect(r.status).toBe(200);
    expect(r.body.purge_at).toBeGreaterThan(Date.now() + HELD_LIMITS.deleted_ms - 60_000);
    for (const token of [p.D, p.C, p.N]) expect(await listed(token)).not.toContain(past);
    for (const call of [{ token: p.D }, chat(p.C)]) {
      expect((await api('GET', `/v1/threads/${past}`, call)).status).toBe(404);
      expect((await api('GET', `/v1/threads/${past}/messages`, call)).status).toBe(404);
      expect(await hits(call.token, 'pomegranate')).toBe(0);
    }
    const notes = await coreSql<{ actor: string; what: string; why: string }>(
      'SELECT actor, what, why FROM ledger WHERE ref = ?',
      `thread:${past}`,
    );
    expect(notes).toEqual([
      {
        actor: 'owner',
        what: 'deleted a conversation (Recently deleted for 30 days)',
        why: 'the owner deleted it from the menu',
      },
    ]);
    expect((await del(p.D, past)).body.error?.code).toBe('gone');
    // The mind can't amend its reply in it, and a fact citing it no longer quotes it.
    expect((await api('PATCH', `/v1/messages/${reply}`, { ...chat(p.C), body: { body: 'Sunday.' } })).status).toBe(410);
    const d = await apiJson<{ evidence: { text: string | null }[] }>('GET', `/v1/memory/facts/${fact}`, { token: p.D });
    expect(d.body.evidence.map((e) => e.text)).toEqual([null]);
  });

  it('is in Recently deleted, for the device only, with its kind and count', async () => {
    const r = await apiJson<DeletedThreadsResponse>('GET', '/v1/threads/deleted', { token: p.D });
    expect(r.body.items).toEqual([
      expect.objectContaining({ id: past, kind: 'daily', day: '2026-10-01', message_count: 2 }),
    ]);
  });

  it('becomes no memory: a fact or a loose end citing it is refused (deleted_evidence, 410 gone)', async () => {
    expect(await reason(chat(p.C), addOp([`msg:${pastMsg}`]))).toBe('deleted_evidence');
    expect(await reason({ token: p.D }, addOp([`msg:${pastMsg}`]))).toBe('deleted_evidence');
    const loose = await apiJson<{ error: { code: string } }>('PUT', `/v1/memory/open-threads/${uuidv7()}`, {
      ...chat(p.C),
      body: { text: 'plan the weekend', owner: 'mind', evidence: [`msg:${pastMsg}`] },
    });
    expect(loose.status).toBe(410);
  });
});

describe("deleting today's thread", () => {
  let today = '';
  let waiting = '';
  it('settles what waits in it, and the next message starts a fresh today', async () => {
    waiting = await ownerSays(p.D, 'a question about the quince tart');
    today = (await apiJson<TodayResponse>('GET', '/v1/threads/today', { token: p.D })).body.thread?.id as string;
    expect((await apiJson<{ unanswered: string[] }>('GET', '/v1/mind/pending', chat(p.C))).body.unanswered).toContain(
      waiting,
    );
    expect((await del(p.D, today)).status).toBe(200);
    const after = await apiJson<TodayResponse>('GET', '/v1/threads/today', { token: p.D });
    expect(after.body.thread).toBeNull();
    expect(after.body.messages).toEqual([]);
    expect((await apiJson<{ unanswered: string[] }>('GET', '/v1/mind/pending', chat(p.C))).body.unanswered).toEqual([]);
    const b = await apiJson<BriefResponse>('POST', '/v1/mind/brief', {
      ...chat(p.C),
      body: {
        claim: false,
        session_id: CHAT_SESSION,
        role: 'chat',
        constitution_sha256: 'a'.repeat(64),
        th_version: '0.1.0',
      },
    });
    expect(b.body.full).not.toContain('quince');
    const fresh = (await say({ token: p.D }, 'starting over')).body;
    expect(fresh.thread_id).not.toBe(today);
    expect((await apiJson<TodayResponse>('GET', '/v1/threads/today', { token: p.D })).body.thread?.id).toBe(
      fresh.thread_id,
    );
  });

  it('restores beside the fresh today (kind restored, filed); its words are found again', async () => {
    const r = await restore(p.D, today);
    expect(r.body).toEqual({ id: today, kind: 'restored', beside: true });
    const t = await apiJson<Thread>('GET', `/v1/threads/${today}`, { token: p.D });
    expect(t.body).toMatchObject({ kind: 'restored', status: 'filed', purge_at: null });
    expect(await listed(p.D)).toContain(today);
    expect(await hits(p.D, 'quince')).toBe(1);
    expect((await restore(p.D, today)).status).toBe(404);
  });

  it("an earlier day's comes back as it was; one past its 30 days is gone, and not listed", async () => {
    const r = await restore(p.D, past);
    expect(r.body).toEqual({ id: past, kind: 'daily', beside: false });
    expect(await hits(p.C, 'pomegranate')).toBe(1);
    expect((await del(p.D, past)).status).toBe(200);
    await coreSql('UPDATE threads SET purge_at = ? WHERE id = ?', Date.now() - 1, past);
    expect((await apiJson<DeletedThreadsResponse>('GET', '/v1/threads/deleted', { token: p.D })).body.items).toEqual(
      [],
    );
    expect((await restore(p.D, past)).body.error?.code).toBe('gone');
  });
});

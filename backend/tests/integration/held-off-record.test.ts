// Off the record (NEXT-BATCH.md part 8; conversation/held.ts): only the owner's device starts one;
// the owner and the chat mind write in it, never anyone else; its messages have no FTS entry and no
// search finds them; the chat mind gets them marked, with the role-side note, and its answer lands
// in it; nothing from it becomes memory (facts, rules, confirms, supersedes, loose ends, session
// notes, titles), refused with clear codes; the night and the reflex never read it, nor its files.
import { beforeAll, describe, expect, it } from 'vitest';
import type { BriefResponse, LiveWaitResponse, Message, Page, Thread } from '../../../shared/contract/api';
import { HELD_LIMITS } from '../../../shared/contract/held.ts';
import { uuidv7 } from '../../src/lib/ids';
import { chat, fileOf, ftsHits, offRecord, say, threadRow } from '../held-helpers';
import { api, apiJson, coreSql, makeAgent } from '../helpers';
import {
  addOp,
  brief,
  CHAT_SESSION,
  firedWake,
  NIGHT_SESSION,
  ops,
  ownerSays,
  type Principals,
  principals,
  reason,
} from '../memory-helpers';

let p: Principals;
let R = '';
let t: Thread;
let asked: Message;
/** An owner question in the daily thread, older than everything off the record. */
let plain = '';
const night = () => chat(p.N, NIGHT_SESSION);
/** A new chat session the Worker fired and the lease passes to (`cse_<s>`). */
async function claim(s: string) {
  await coreSql("UPDATE leases SET renewed_at = 0 WHERE task = 'chat'");
  await firedWake('chat', `session_${s}`);
  await brief(p.C, `cse_${s}`, 'chat');
}

beforeAll(async () => {
  p = await principals();
  R = await makeAgent(p.D, 'mind:reflex');
  t = await offRecord(p.D);
});

describe('starting one', () => {
  it('is the device alone: a thread off the record under its id, 7 days to live; the same id again answers it', async () => {
    expect(t).toMatchObject({ kind: 'off_record', status: 'open', message_count: 0, title: null });
    expect(t.purge_at).toBeGreaterThan(Date.now() + HELD_LIMITS.off_record_ms - 60_000);
    const again = await apiJson<Thread>('PUT', `/v1/threads/${t.id}/off-record`, { token: p.D });
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(t.id);
    for (const token of [p.C, p.N, R])
      expect((await api('PUT', `/v1/threads/${uuidv7()}/off-record`, { token })).status).toBe(403);
    // Another thread's id is not taken over.
    const first = (await say({ token: p.D }, 'a plain message today')).body;
    plain = first.id;
    expect((await api('PUT', `/v1/threads/${first.thread_id}/off-record`, { token: p.D })).status).toBe(409);
  });
});

describe('writing in it', () => {
  it('the owner names it; the message has no FTS entry, and its purge moves to 7 days after it', async () => {
    const r = await say({ token: p.D }, 'zanzibar is my secret word', { thread_id: t.id });
    expect(r.status).toBe(201);
    asked = r.body;
    expect(asked.thread_id).toBe(t.id);
    expect(await ftsHits('zanzibar')).toBe(0);
    const row = await threadRow(t.id);
    expect(row?.purge_at).toBeGreaterThanOrEqual(asked.created_at + HELD_LIMITS.off_record_ms);
    for (const token of [p.D, p.C]) {
      const s = await apiJson<{ items: unknown[] }>('GET', '/v1/search?q=zanzibar', { token });
      expect(s.body.items).toEqual([]);
    }
  });

  it('only a live conversation off the record can be named, and only by the owner or the chat mind', async () => {
    const daily = (await say({ token: p.D }, 'another plain one')).body.thread_id;
    const named = await say({ token: p.D }, 'x', { thread_id: daily });
    expect(named.status).toBe(422);
    expect((await say({ token: p.D }, 'x', { thread_id: uuidv7() })).status).toBe(404);
    const n = await say(night(), 'boom', { kind: 'error', thread_id: t.id });
    expect(n.status).toBe(403);
  });

  it('the chat mind gets it marked: the live wait names it, the briefing marks it with the note', async () => {
    const w = await apiJson<LiveWaitResponse>('GET', '/v1/live/wait?after=0&timeout=1', chat(p.C));
    expect(w.body.messages.map((m) => m.id)).toContain(asked.id);
    expect(w.body.off_record).toEqual([t.id]);
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
    const waiting = b.body.core.slice(b.body.core.indexOf('## 2. Waiting'), b.body.core.indexOf('## 3.'));
    expect(waiting).toContain(`Off the record (thread ${t.id})`);
    expect(waiting).toContain('Remember nothing from it');
    expect(waiting).toMatch(new RegExp(`\\[${asked.id}\\] \\d\\d:\\d\\d owner \\(off the record\\): zanzibar`));
    // Not in today's part of the briefing, which is the daily thread's.
    expect(b.body.full.slice(b.body.full.indexOf('## 5.'), b.body.full.indexOf('## 6.'))).not.toContain('zanzibar');
  });

  it("the chat mind's answer lands in it (reply_to), settles only it, and is not indexed either", async () => {
    const r = await say(chat(p.C), 'Kept between us: quokka.', { reply_to: asked.id });
    expect(r.status).toBe(201);
    expect(r.body.thread_id).toBe(t.id);
    expect(await ftsHits('quokka')).toBe(0);
    const page = await apiJson<Page<Message>>('GET', `/v1/threads/${t.id}/messages?after_seq=0`, { token: p.D });
    expect(page.body.items.find((m) => m.id === asked.id)?.answered_at).not.toBeNull();
    // A reply off the record never settles the daily thread's older question.
    const pending = await apiJson<{ unanswered: string[] }>('GET', '/v1/mind/pending', chat(p.C));
    expect(pending.body.unanswered).toContain(plain);
    expect(pending.body.unanswered).not.toContain(asked.id);
  });
});

describe('never memory (M17)', () => {
  // The session the wait handed it to remembers nothing at all (below): these run in a fresh one.
  beforeAll(async () => {
    await claim('otr_clean');
  });
  const clean = () => chat(p.C, 'cse_otr_clean');

  it('no fact, rule, confirm or supersede cites it, from the mind or the device', async () => {
    expect(await reason(clean(), addOp([`msg:${asked.id}`]))).toBe('off_record_evidence');
    expect(await reason(clean(), addOp([`msg:${asked.id}`], { kind: 'rule', subject: 'answers.short' }))).toBe(
      'off_record_evidence',
    );
    expect(await reason({ token: p.D }, addOp([`msg:${asked.id}`]))).toBe('off_record_evidence');
    const said = await ownerSays(p.D, 'I like calm music in the evening');
    const added = await ops(clean(), [addOp([`msg:${said}`])]);
    const fact = added.body.applied[0]?.fact_id as string;
    expect(fact).toBeTruthy();
    expect(await reason(clean(), { op: 'confirm', id: fact, evidence: [`msg:${asked.id}`] })).toBe(
      'off_record_evidence',
    );
    const sup = {
      op: 'supersede',
      id: fact,
      new: { id: uuidv7(), text: 'Likes quiet music', evidence: [`msg:${asked.id}`] },
    };
    expect(await reason(clean(), sup)).toBe('off_record_evidence');
  });

  it('no loose end, session note or title: 403 off_record; no Continue this', async () => {
    for (const evidence of [[`msg:${asked.id}`], [`thread:${t.id}`]]) {
      const r = await apiJson<{ error: { code: string } }>('PUT', `/v1/memory/open-threads/${uuidv7()}`, {
        ...clean(),
        body: { text: 'remember the secret word', owner: 'mind', evidence },
      });
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe('off_record');
    }
    const note = await apiJson<{ error: { code: string } }>('POST', '/v1/mind/notes', {
      ...clean(),
      body: { id: uuidv7(), thread_id: t.id, body: 'Talked off the record.', open_items: [] },
    });
    expect([note.status, note.body.error.code]).toEqual([403, 'off_record']);
    const title = await apiJson<{ error: { code: string } }>('PATCH', `/v1/threads/${t.id}`, {
      ...clean(),
      body: { title: 'The secret word' },
    });
    expect([title.status, title.body.error.code]).toEqual([403, 'off_record']);
    const cont = await apiJson<{ error: { code: string } }>('POST', `/v1/threads/${t.id}/continue`, { token: p.D });
    expect([cont.status, cont.body.error.code]).toEqual([403, 'off_record']);
  });
});

describe('the session it was handed to', () => {
  const memoryWrites = async (session: string, said: string) => {
    const call = chat(p.C, session);
    const fact = await ops(call, [addOp([`msg:${said}`])]);
    const loose = await apiJson<{ error?: { code: string } }>('PUT', `/v1/memory/open-threads/${uuidv7()}`, {
      ...call,
      body: { text: 'ask about the trip', owner: 'mind', evidence: [`msg:${said}`] },
    });
    const note = await apiJson<{ error?: { code: string } }>('POST', '/v1/mind/notes', {
      ...call,
      body: { id: uuidv7(), body: 'A plain session.', open_items: [] },
    });
    return [fact.body?.error?.code ?? 'ok', loose.body?.error?.code ?? 'ok', note.body?.error?.code ?? 'ok'];
  };

  it('writes no memory at all, whatever it cites: the wait, the briefing, a thread read each mark it', async () => {
    const said = await ownerSays(p.D, 'I am planning a trip to the coast');
    // The wait hands out a message off the record: that session is marked.
    await claim('otr_wait');
    const q = (await say({ token: p.D }, 'the code is 4417', { thread_id: t.id })).body;
    const w = await apiJson<LiveWaitResponse>('GET', '/v1/live/wait?after=0&timeout=1', chat(p.C, 'cse_otr_wait'));
    expect(w.body.off_record).toEqual([t.id]);
    expect(await memoryWrites('cse_otr_wait', said)).toEqual(['off_record', 'off_record', 'off_record']);
    // A briefing that shows it waiting marks the session it claims.
    await claim('otr_brief');
    expect(await memoryWrites('cse_otr_brief', said)).toEqual(['off_record', 'off_record', 'off_record']);
    // Answered, it waits no more: the next session starts clean, until it reads the thread.
    expect((await say(chat(p.C, 'cse_otr_brief'), 'Noted, between us.', { reply_to: q.id })).status).toBe(201);
    await claim('otr_next');
    expect(await memoryWrites('cse_otr_next', await ownerSays(p.D, 'I like the coast'))).toEqual(['ok', 'ok', 'ok']);
    expect((await api('GET', `/v1/threads/${t.id}/messages`, chat(p.C, 'cse_otr_next'))).status).toBe(200);
    expect((await memoryWrites('cse_otr_next', said))[0]).toBe('off_record');
  });
});

describe('who reads it', () => {
  it('the owner lists and reads it; the chat mind reads it by id; the night and the reflex never', async () => {
    const list = async (token: string) =>
      (await apiJson<Page<Thread>>('GET', '/v1/threads?limit=50', { token })).body.items.map((x) => x.id);
    expect(await list(p.D)).toContain(t.id);
    for (const token of [p.C, p.N, R]) expect(await list(token)).not.toContain(t.id);
    expect((await api('GET', `/v1/threads/${t.id}`, { token: p.D })).status).toBe(200);
    expect((await api('GET', `/v1/threads/${t.id}/messages`, chat(p.C))).status).toBe(200);
    for (const call of [night(), { token: R }]) {
      expect((await api('GET', `/v1/threads/${t.id}`, call)).status).toBe(404);
      expect((await api('GET', `/v1/threads/${t.id}/messages`, call)).status).toBe(404);
    }
  });

  it("its files: the owner's and the chat mind's, never the night's", async () => {
    const ref = await fileOf(p.D, 'a photo of the secret');
    const r = await say({ token: p.D }, '', { thread_id: t.id, attachments: [ref] });
    expect(r.status).toBe(201);
    const id = ref.slice('file:'.length);
    expect((await api('GET', `/v1/files/${id}?meta=1`, { token: p.D })).status).toBe(200);
    expect((await api('GET', `/v1/files/${id}?meta=1`, chat(p.C))).status).toBe(200);
    expect((await api('GET', `/v1/files/${id}?meta=1`, night())).status).toBe(404);
  });

  it("the night's briefing never shows it", async () => {
    const b = await brief(p.N, NIGHT_SESSION, 'night');
    expect(b.body.full).not.toContain('zanzibar');
    expect(b.body.full).not.toContain('quokka');
  });
});

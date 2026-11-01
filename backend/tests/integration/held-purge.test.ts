// The purge of held conversations (conversation/purge.ts, objects/core-held.ts), by the cron's
// prune pass with a fake clock: off the record 7 days after the last message, deleted 30 days after
// the delete, not a minute before; once due a thread is gone from every read and refuses every
// write even before the tick; the purge takes the messages and their FTS entries, the files' rows
// and bytes, the evidence links (a fact keeps its text) and the mind's session notes about it, leaves
// a ledger row with no words, goes
// in steps of 500 messages, and waits while the rows guard holds the heavy work.
import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Fact, OpenThread, Thread } from '../../../shared/contract/api';
import { HELD_LIMITS } from '../../../shared/contract/held.ts';
import { budgetAt } from '../../../shared/contract/meter.ts';
import { uuidv7 } from '../../src/lib/ids';
import { utcDay } from '../../src/lib/time';
import { chat, DAY_MS, fileOf, ftsHits, offRecord, say, threadRow, tick } from '../held-helpers';
import { api, apiJson, coreSql } from '../helpers';
import { addOp, freshSession, ops, ownerSays, type Principals, principals } from '../memory-helpers';

let p: Principals;
const MIN = 60_000;
const keyOf = async (fileId: string) =>
  (await coreSql<{ key: string }>('SELECT key FROM files WHERE id = ?', fileId))[0]?.key;
const purgeNotes = (id: string) =>
  coreSql<{ actor: string; what: string; why: string }>(
    "SELECT actor, what, why FROM ledger WHERE ref = ? AND actor = 'worker'",
    `thread:${id}`,
  );

beforeAll(async () => {
  p = await principals();
});

describe('off the record', () => {
  let t: Thread;
  let last = 0;
  let fileId = '';
  let key = '';
  it('is kept until 7 days after its last message, not a minute less', async () => {
    t = await offRecord(p.D);
    const ref = await fileOf(p.D, 'the synthetic photo bytes');
    fileId = ref.slice('file:'.length);
    key = (await keyOf(fileId)) as string;
    const asked = (await say({ token: p.D }, 'a word kept between us', { thread_id: t.id, attachments: [ref] })).body;
    last = (await say(chat(p.C), 'Understood.', { reply_to: asked.id })).body.created_at;
    expect((await threadRow(t.id))?.purge_at).toBe(last + HELD_LIMITS.off_record_ms);
    await tick(last + HELD_LIMITS.off_record_ms - MIN);
    expect(await threadRow(t.id)).toBeDefined();
    expect((await coreSql('SELECT id FROM messages WHERE thread_id = ?', t.id)).length).toBe(2);
    expect(await env.VAULT.head(key)).not.toBeNull();
  });

  it('once due it is gone from every read and refuses writes, before the tick purges it', async () => {
    await coreSql('UPDATE threads SET purge_at = ? WHERE id = ?', Date.now() - 1, t.id);
    expect((await api('GET', `/v1/threads/${t.id}`, { token: p.D })).status).toBe(404);
    expect((await api('GET', `/v1/files/${fileId}?meta=1`, { token: p.D })).status).toBe(404);
    const late = await say({ token: p.D }, 'one more', { thread_id: t.id });
    expect([late.status, late.body.error?.code]).toEqual([410, 'gone']);
    expect((await api('PUT', `/v1/threads/${t.id}/off-record`, { token: p.D })).status).toBe(410);
  });

  it('the tick takes its messages, its files (rows and bytes) and the thread; a ledger row without words', async () => {
    await tick(last + HELD_LIMITS.off_record_ms + MIN);
    expect(await threadRow(t.id)).toBeUndefined();
    expect(await coreSql('SELECT id FROM messages WHERE thread_id = ?', t.id)).toEqual([]);
    expect(await coreSql('SELECT id FROM files WHERE id = ?', fileId)).toEqual([]);
    expect(await env.VAULT.head(key)).toBeNull();
    expect(await purgeNotes(t.id)).toEqual([
      {
        actor: 'worker',
        what: 'purged a conversation off the record',
        why: 'off the record: gone 7 days after its last message',
      },
    ]);
  });
});

describe('a deleted conversation', () => {
  let thread = '';
  let said = '';
  let fact = '';
  let loose = '';
  let deletedAt = 0;
  let note = '';
  it('stays 30 days after the delete; its fact and loose end still cite it meanwhile', async () => {
    said = await ownerSays(p.D, 'I keep a persimmon tree on the balcony');
    const other = await ownerSays(p.D, 'and I water it on Sundays');
    thread = (await coreSql<{ thread_id: string }>('SELECT thread_id FROM messages WHERE id = ?', said))[0].thread_id;
    // The ticks above ran days ahead, which ended the first session: a fresh one writes memory.
    const mind = chat(p.C, await freshSession(p.C, 'chat', 'cse_purge_chat_2'));
    const r = await ops(mind, [addOp([`msg:${said}`, `msg:${other}`], { text: 'Keeps a persimmon tree' })]);
    fact = r.body.applied[0].fact_id;
    loose = uuidv7();
    await apiJson('PUT', `/v1/memory/open-threads/${loose}`, {
      ...mind,
      body: { text: 'ask how the tree is doing', owner: 'mind', evidence: [`msg:${said}`] },
    });
    note = uuidv7();
    const n = await api('POST', '/v1/mind/notes', {
      ...mind,
      body: { id: note, thread_id: thread, body: 'Talked about the tree.', open_items: [] },
    });
    expect(n.status).toBe(201);
    const d = await apiJson<{ purge_at: number }>('DELETE', `/v1/threads/${thread}`, { token: p.D });
    deletedAt = d.body.purge_at - HELD_LIMITS.deleted_ms;
    await tick(deletedAt + 30 * DAY_MS - MIN);
    expect((await threadRow(thread))?.kind).toBe('deleted');
    expect(await ftsHits('persimmon')).toBe(1);
  });

  it('then goes: messages and FTS entries (the index whole), the links; the fact keeps its text', async () => {
    await tick(deletedAt + 30 * DAY_MS + MIN);
    expect(await threadRow(thread)).toBeUndefined();
    expect(await coreSql('SELECT id FROM messages WHERE thread_id = ?', thread)).toEqual([]);
    expect(await ftsHits('persimmon')).toBe(0);
    await coreSql(`INSERT INTO messages_fts (messages_fts, rank) VALUES ('integrity-check', 1)`);
    const f = (await apiJson<{ fact: Fact }>('GET', `/v1/memory/facts/${fact}`, { token: p.D })).body.fact;
    expect(f.text).toBe('Keeps a persimmon tree');
    expect(f.evidence).toEqual([]);
    const lt = (await apiJson<{ items: OpenThread[] }>('GET', '/v1/memory/open-threads', { token: p.D })).body.items;
    expect(lt.find((x) => x.id === loose)?.evidence).toEqual([]);
    expect((await purgeNotes(thread))[0]?.what).toBe('purged a deleted conversation');
    // The mind's session note about it goes too; what it learned stays in What I remember.
    expect(await coreSql('SELECT id FROM session_notes WHERE id = ?', note)).toEqual([]);
  });
});

describe('steps and the rows guard', () => {
  it('purges 500 messages a tick, the rest on the next', async () => {
    const t = await offRecord(p.D);
    await coreSql(
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 600)
       INSERT INTO messages (id, thread_id, created_at, author, origin, kind, body)
       SELECT printf('held-%04d', i), ?, 1, 'owner', 'owner_device', 'text', 'filler' FROM n`,
      t.id,
    );
    const due = (t.purge_at as number) + MIN;
    await tick(due);
    expect((await coreSql('SELECT id FROM messages WHERE thread_id = ?', t.id)).length).toBe(
      600 - HELD_LIMITS.purge_messages,
    );
    await tick(due + 15 * MIN);
    expect(await threadRow(t.id)).toBeUndefined();
  });

  it('waits while the day is past 80% of its rows, and goes once the hold lifts', async () => {
    const t = await offRecord(p.D);
    await say({ token: p.D }, 'held back by the guard', { thread_id: t.id });
    const row = await threadRow(t.id);
    const due = (row?.purge_at as number) + MIN;
    const seed = (n: number) =>
      coreSql(
        'INSERT OR REPLACE INTO meter_days (day, class, rows_read, rows_written, updated_at) VALUES (?, ?, 0, ?, 0)',
        utcDay(due),
        'music',
        n,
      );
    await seed(budgetAt(80, 'rows_written') + 1);
    await tick(due);
    expect(await threadRow(t.id)).toBeDefined();
    await seed(0);
    await tick(due + MIN);
    expect(await threadRow(t.id)).toBeUndefined();
  });
});

// The import of the old Chats (DATA.md §12, MIGRATION.md §4 I1–I3) from parts in the private
// bucket: threads, then messages across three parts, then the notebook. Each run counts every
// source row as imported or skipped with its reason, checks 20 (here: all) source rows against
// what it wrote with a recorded seed, checks each thread's shape (count, first and last time)
// against the source, ends with one ledger row of counts, and a second run of a dataset changes
// no row. A part lost in the middle fails a step, which is retried and ends as an uninterrupted
// run would.
import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ImportStatus, MemoryOpsResponse } from '../../../shared/contract/api';
import { importedId, uuidv7 } from '../../src/lib/ids';
import { apiJson, coreSql } from '../helpers';
import { BASE, exportRun, gz, postPart, untilDone } from '../import-helpers';
import { as, CHAT_SESSION, type Principals, principals } from '../memory-helpers';

let p: Principals;
const RUN = 'run-chats-1';
const MIN = 60_000;
const thread = (i: number) => ({
  id: `t${i}`,
  title: ` Old chat ${i} `,
  created_ms: BASE + i * 3_600_000,
  updated_ms: BASE + i * 3_600_000 + 600_000,
  archived: 0,
  session_url: null,
});
const msg = (i: number, thread: string, role: string, extra: object = {}) => ({
  seq: i,
  id: `m${i}`,
  thread_id: thread,
  role,
  kind: 'text',
  body: `old message ${i} about lanterns`,
  meta: null,
  reply_to: null,
  created_ms: BASE + i * MIN,
  delivered_ms: null,
  answered_ms: null,
  ...extra,
});
const MESSAGES = [
  [msg(1, 't1', 'owner'), msg(2, 't1', 'claude', { reply_to: 'm1' }), msg(3, 't2', 'owner')],
  [msg(4, 't2', 'claude'), msg(5, 'gone', 'owner'), msg(6, 't3', 'owner', { body: '  ' })],
  [msg(7, 't3', 'claude', { attachments: '[{"key":"chat/files/x"}]' }), msg(8, 't4', 'owner')],
];
const start = (id: string, dataset: string, run = RUN) =>
  apiJson<{ import_id: string } & { error?: { code: string } }>('POST', '/v1/import/runs', {
    token: p.D,
    body: { id, run_id: run, dataset },
  });

beforeAll(async () => {
  p = await principals();
  await exportRun(p.C, RUN, {
    'claude-chat-v1/cc_threads': [[thread(1), thread(2), thread(3), thread(4)]],
    'claude-chat-v1/cc_messages': MESSAGES,
    'claude-chat-v1/cc_state': [
      [
        { key: 'notebook', value: JSON.stringify({ body: 'Likes tea in the evening.', version: 3, updatedAt: BASE }) },
        { key: 'lease', value: '{}' },
      ],
    ],
  });
});

describe('the old Chats, imported', () => {
  let threadsRun = '';
  it('messages wait for threads; threads arrive filed, with their day and title, all spot checks passing', async () => {
    expect((await start(uuidv7(), 'messages')).status).toBe(422);
    threadsRun = uuidv7();
    expect((await start(threadsRun, 'threads')).status).toBe(202);
    const s = await untilDone(p.D, threadsRun);
    expect(s).toMatchObject({
      state: 'done',
      counts: { expected: 4, imported: 4, skipped: 0, skip_reasons: {}, files_waiting: 0 },
      report: {
        spot_checks: { checked: 4, passed: 4, failed: [] },
        thread_shapes: null,
        rows_changed: 4,
        rerun_delta: null,
      },
    });
    const [told] = await coreSql<{ what: string; actor: string; kind: string }>(
      "SELECT what, actor, kind FROM ledger WHERE why = 'the import of run run-chats-1'",
    );
    expect(told).toEqual({
      what: 'Imported 4 of 4 conversations (0 skipped); 4 of 4 spot checks matched; 4 rows changed.',
      actor: 'worker',
      kind: 'note',
    });
    const rows = await coreSql<{ title: string; status: string; day: string }>(
      "SELECT title, status, day FROM threads WHERE kind = 'imported' ORDER BY started_at",
    );
    expect(rows.map((r) => r.title)).toEqual(['Old chat 1', 'Old chat 2', 'Old chat 3', 'Old chat 4']);
    expect(rows.every((r) => r.status === 'filed' && r.day === '2026-09-01')).toBe(true);
  });

  it('messages: a lost part fails its step, the retry ends as an uninterrupted run; every row counted', async () => {
    const id = uuidv7();
    const part2 = `imports/old/${RUN}/claude-chat-v1/cc_messages/part-0002.jsonl.gz`;
    const bytes = await gz(MESSAGES[1]);
    await env.VAULT.delete(part2);
    expect((await start(id, 'messages')).status).toBe(202);
    for (let i = 0; i < 3; i++) await untilDone(p.D, id, 1).catch(() => null);
    const [job] = await coreSql<{ attempts: number; last_error: string; state: string }>(
      'SELECT j.attempts, j.last_error, j.state FROM jobs j JOIN imports i ON i.job_id = j.id WHERE i.id = ?',
      id,
    );
    // The first step already reads every part (a message names its reply by the old one's time).
    expect(job).toMatchObject({ attempts: 1, last_error: 'missing_part' });
    expect(['queued', 'running']).toContain(job.state);
    expect((await postPart(p.C, `${RUN}/claude-chat-v1/cc_messages/0002`, bytes, 3)).status).toBe(201);
    await coreSql('UPDATE jobs SET due_at = 0 WHERE state != ?', 'done');
    const s = await untilDone(p.D, id);
    expect(s).toMatchObject({
      state: 'done',
      counts: { expected: 8, imported: 6, skipped: 2, skip_reasons: { invalid_ref: 1, empty: 1 }, files_waiting: 1 },
      report: {
        spot_checks: { checked: 8, passed: 8, failed: [] },
        thread_shapes: { checked: 4, failed: [] },
        rerun_delta: null,
      },
    });
    const m1 = await importedId('messages', 'm1', BASE + MIN);
    const [m2] = await coreSql<{ reply_to: string; origin: string; author: string }>(
      'SELECT reply_to, origin, author FROM messages WHERE id = ?',
      await importedId('messages', 'm2', BASE + 2 * MIN),
    );
    expect(m2).toEqual({ reply_to: m1, origin: 'import', author: 'mind' });
    const waiting = await coreSql(
      "SELECT id FROM messages WHERE origin = 'import' AND author = 'owner' AND answered_at IS NULL",
    );
    expect(waiting).toEqual([]);
    const t1 = await importedId('threads', 't1', BASE + 3_600_000);
    expect((await coreSql('SELECT message_count FROM threads WHERE id = ?', t1))[0]).toEqual({ message_count: 2 });
    const found = await apiJson<{ items: { source: string; ref: string }[] }>('GET', '/v1/search?q=lanterns', {
      token: p.D,
    });
    expect(found.body.items.filter((i) => i.source === 'messages').length).toBe(6);
  });

  it('a second run of a dataset changes no row and says so', async () => {
    const before = (await coreSql<{ n: number }>("SELECT count(*) AS n FROM messages WHERE origin = 'import'"))[0].n;
    const s = await untilDone(p.D, (await start(uuidv7(), 'messages')).body.import_id);
    expect(s.report).toMatchObject({ rows_changed: 0, rerun_delta: 0, spot_checks: { passed: 8 } });
    expect((await coreSql<{ n: number }>("SELECT count(*) AS n FROM messages WHERE origin = 'import'"))[0].n).toBe(
      before,
    );
    expect((await start(threadsRun, 'threads')).body.import_id).toBe(threadsRun);
    expect((await start(threadsRun, 'notebook')).status).toBe(409);
  });

  it('a thread whose messages differ from the source fails verification, naming the thread', async () => {
    const t2 = await importedId('threads', 't2', BASE + 2 * 3_600_000);
    const m3 = await importedId('messages', 'm3', BASE + 3 * MIN);
    await coreSql(
      `INSERT INTO messages (id, thread_id, created_at, author, origin, kind, body, req_sha256)
       SELECT ?, thread_id, created_at + 1, author, origin, kind, body, req_sha256 FROM messages WHERE id = ?`,
      uuidv7(),
      m3,
    );
    const s = await untilDone(p.D, (await start(uuidv7(), 'messages')).body.import_id);
    expect(s).toMatchObject({
      state: 'failed',
      last_error: 'thread_shape_mismatch',
      report: { spot_checks: { passed: 8 }, thread_shapes: { checked: 4, failed: [t2] }, rerun_delta: 0 },
    });
    const told = await coreSql<{ what: string }>(
      "SELECT what FROM ledger WHERE why = 'the import of run run-chats-1' ORDER BY seq DESC LIMIT 1",
    );
    expect(told[0].what).toBe(
      'The import of messages stopped (thread_shape_mismatch). Nothing was lost; the old system still has it.',
    );
    await coreSql(
      'DELETE FROM messages WHERE thread_id = ? AND created_at = ? AND id != ?',
      t2,
      BASE + 3 * MIN + 1,
      m3,
    );
  });

  it("the notebook becomes one raw document, citable as import evidence but never as the owner's words", async () => {
    const s = await untilDone(p.D, (await start(uuidv7(), 'notebook')).body.import_id);
    expect(s).toMatchObject({
      state: 'done',
      counts: { expected: 2, imported: 1, skipped: 1, skip_reasons: { dropped: 1 } },
    });
    const [item] = await coreSql<{ id: string; body_json: string }>(
      "SELECT id, body_json FROM import_items WHERE dataset = 'notebook'",
    );
    expect(JSON.parse(item.body_json).body).toBe('Likes tea in the evening.');
    const add = (source: string) => ({
      batch_id: uuidv7(),
      ops: [
        {
          op: 'add',
          id: uuidv7(),
          kind: 'preference',
          text: 'Likes tea in the evening',
          source,
          evidence: [`import:${item.id}`],
        },
      ],
    });
    const inferred = await apiJson<MemoryOpsResponse>('POST', '/v1/memory/ops', {
      ...as(p.C, CHAT_SESSION),
      body: add('inferred'),
    });
    expect(inferred.body.applied).toHaveLength(1);
    const user = await apiJson<MemoryOpsResponse & { error?: { details?: { issue: string }[] } }>(
      'POST',
      '/v1/memory/ops',
      {
        ...as(p.C, CHAT_SESSION),
        body: add('user'),
      },
    );
    expect(user.body.error?.details?.[0]?.issue).toBe('not_owner_evidence');
  });

  it('a manifest whose count the parts do not reach fails verification, with its report', async () => {
    await exportRun(
      p.C,
      'run-short',
      { 'claude-chat-v1/cc_threads': [[thread(9)]] },
      { rows: { 'claude-chat-v1/cc_threads': 2 } },
    );
    const s: ImportStatus = await untilDone(p.D, (await start(uuidv7(), 'threads', 'run-short')).body.import_id);
    expect(s).toMatchObject({ state: 'failed', last_error: 'count_mismatch', counts: { expected: 2, imported: 1 } });
    expect(s.report?.spot_checks.failed).toEqual([]);
  });
});

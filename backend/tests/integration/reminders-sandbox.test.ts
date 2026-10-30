// A reminder in the eval sandbox (EVALS.md §1.1): the chat mind may set one there from a seeded
// owner line, and the sandbox's alarm delivers it as a line in the sandbox's own conversation, but
// it never pushes: nothing from the sandbox reaches the owner's phones or the Auth object's outbox.
import { env, runInDurableObject } from 'cloudflare:test';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ReminderResponse } from '../../../shared/contract/reminders.ts';
import { uuidv7 } from '../../src/lib/ids';
import { MINUTE } from '../../src/lib/time';
import type { Core } from '../../src/objects/core';
import { apiJson, authSql, makeAgent, setupOwner } from '../helpers';

const SESSION = 'cse_eval_chat_reminder';
let C = '';
const sandbox = { 'TH-Sandbox': 'eval', 'TH-Session': SESSION };
const evalCore = () => env.CORE.getByName('core-eval') as unknown as DurableObjectStub<Core>;
const evalSql = <T>(q: string, ...b: unknown[]) =>
  runInDurableObject(evalCore(), (_o, s) => s.storage.sql.exec(q, ...b).toArray()) as Promise<T[]>;

beforeAll(async () => {
  const D = (await setupOwner()).token;
  C = await makeAgent(D, 'mind:chat');
  const seed = [{ t: 'say', ref: 'm1', body: 'Remind me in ten minutes to stretch.' }];
  expect((await apiJson('POST', '/v1/evals/sandbox', { token: C, headers: sandbox, body: { seed } })).status).toBe(200);
  const brief = {
    claim: true,
    session_id: SESSION,
    role: 'chat',
    constitution_sha256: 'a'.repeat(64),
    th_version: '0.1.0',
  };
  expect((await apiJson('POST', '/v1/mind/brief', { token: C, headers: sandbox, body: brief })).status).toBe(200);
});

describe('a reminder in the eval sandbox', () => {
  it('is set and delivered there, and never pushes', async () => {
    const [asked] = await evalSql<{ id: string }>("SELECT id FROM messages WHERE author = 'owner'");
    const body = { text: 'Stretch', at: Date.now() + 10 * MINUTE, source_message_id: asked.id };
    const set = await apiJson<ReminderResponse>('PUT', `/v1/reminders/${uuidv7()}`, {
      token: C,
      headers: sandbox,
      body,
    });
    expect(set.status).toBe(201);
    const r = set.body.reminder;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(r.fire_at + 1_000);
    try {
      await runInDurableObject(evalCore(), (o: Core) => o.alarm());
      expect((await runInDurableObject(evalCore(), (o: Core) => o.pushContext())).reminders).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
    const [row] = await evalSql<{ state: string; push_until: number | null }>(
      'SELECT state, push_until FROM reminders WHERE id = ?',
      r.id,
    );
    expect(row).toEqual({ state: 'done', push_until: null });
    const lines = await evalSql("SELECT id FROM messages WHERE json_extract(meta_json, '$.reminder.id') = ?", r.id);
    expect(lines).toHaveLength(1);
    expect(await authSql('SELECT id FROM pushes WHERE id = ?', r.id)).toEqual([]);
  });
});

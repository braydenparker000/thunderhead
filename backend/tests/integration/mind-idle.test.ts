// B5 latency (RUNTIME.md §4.2, §4.6): the chat's idle cutoff grows with the day's owner messages
// from the owner's `mind.idle` setting (at most double it, never past 4 hours; a pre-warm with no
// message stays 10), and a chat session's first reply to an owner message is kept on the wake it
// claimed, which the usage meter turns into the cold-wake latency.
import { runInDurableObject } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Message, Page } from '../../../shared/contract/api';
import type { PendingResponse, WakeItem } from '../../../shared/contract/conversation';
import type { UsageResponse } from '../../../shared/contract/watches.ts';
import { uuidv7 } from '../../src/lib/ids';
import type { Core } from '../../src/objects/core';
import { apiJson, core, coreSql } from '../helpers';
import { as, CHAT_SESSION, ownerSays, type Principals, principals } from '../memory-helpers';

let p: Principals;
const SESSION = CHAT_SESSION;
const pending = (session: string) => apiJson<PendingResponse>('GET', '/v1/mind/pending', as(p.C, session));
const ownerToday = async () =>
  (await coreSql<{ n: number }>("SELECT count(*) AS n FROM messages WHERE author = 'owner'"))[0].n;
const cutoff = (base: number, n: number) => Math.min(base + 15 * Math.max(0, n - 1), 2 * base, 240);

beforeAll(async () => {
  // A chat wake a message fired 9 s before the claim the helpers make for CHAT_SESSION binds to it.
  const at = Date.now();
  await coreSql(
    "INSERT INTO wakes (id, at, task, reason, status, fired_at, session_id) VALUES (?, ?, 'chat', 'message', 'fired', ?, ?)",
    uuidv7(),
    at,
    at - 9_000,
    SESSION,
  );
  p = await principals();
  await apiJson('PATCH', '/v1/settings', { token: p.D, body: { 'owner.tz': 'UTC' } });
});

describe('the idle cutoff', () => {
  it('is the setting plus 15 min per owner message after the first, at most double, never past 240', async () => {
    expect(
      (await coreSql<{ wake_id: string | null }>('SELECT wake_id FROM mind_sessions WHERE session_id = ?', SESSION))[0]
        .wake_id,
    ).not.toBeNull();
    const check = async (base: number) => {
      const r = await pending(SESSION);
      expect(r.status).toBe(200);
      expect(r.body.idle_cutoff_min).toBe(cutoff(base, await ownerToday()));
      return r.body.idle_cutoff_min;
    };
    const n0 = await ownerToday();
    expect(await check(120)).toBe(cutoff(120, n0));
    for (let i = 0; i < 3; i++) await ownerSays(p.D, `message ${i}`);
    expect(await check(120)).toBe(cutoff(120, n0 + 3));
    expect(cutoff(120, n0 + 3)).toBeGreaterThan(120);
    for (let i = 0; i < 9; i++) await ownerSays(p.D, `more ${i}`);
    expect(await check(120)).toBe(240);
    await apiJson('PATCH', '/v1/settings', { token: p.D, body: { 'mind.idle': 30 } });
    expect(await check(30)).toBe(60);
    await apiJson('PATCH', '/v1/settings', { token: p.D, body: { 'mind.idle': 120 } });
  });

  it('records the first reply on the wake, once, and the meter reads it as the cold-wake latency', async () => {
    const before = await coreSql<{ first_reply_at: number | null }>(
      'SELECT first_reply_at FROM wakes WHERE session_id = ?',
      SESSION,
    );
    expect(before[0].first_reply_at).toBeNull();
    const msg = await ownerSays(p.D, 'are you there?');
    // A status report is not a reply.
    await apiJson('POST', '/v1/mind/status', { ...as(p.C, SESSION), body: { state: 'working', note: 'reading' } });
    const first = await apiJson<Message>('PUT', `/v1/messages/${uuidv7()}`, {
      ...as(p.C, SESSION),
      body: { body: 'Here.', reply_to: msg },
    });
    expect(first.status).toBe(201);
    const [w] = await coreSql<{ first_reply_at: number | null; claimed_at: number; fired_at: number }>(
      'SELECT first_reply_at, claimed_at, fired_at FROM wakes WHERE session_id = ?',
      SESSION,
    );
    expect(w.first_reply_at).toBe(first.body.created_at);
    expect(w.first_reply_at).toBeGreaterThanOrEqual(w.claimed_at);
    const again = await ownerSays(p.D, 'and now?');
    await apiJson('PUT', `/v1/messages/${uuidv7()}`, {
      ...as(p.C, SESSION),
      body: { body: 'Still here.', reply_to: again },
    });
    const [w2] = await coreSql<{ first_reply_at: number | null }>(
      'SELECT first_reply_at FROM wakes WHERE session_id = ?',
      SESSION,
    );
    expect(w2.first_reply_at).toBe(w.first_reply_at);
    const items = (await apiJson<Page<WakeItem>>('GET', '/v1/mind/wakes', { token: p.D })).body.items;
    const [{ id }] = await coreSql<{ id: string }>('SELECT id FROM wakes WHERE session_id = ?', SESSION);
    expect(items.find((i) => i.id === id)?.first_reply_at).toBe(w.first_reply_at);
    const u: UsageResponse = await runInDurableObject(core() as unknown as DurableObjectStub<Core>, (o: Core) =>
      o.usage(),
    );
    expect(u.today.latency).toEqual({
      replies: 1,
      claim_s: Math.round((w.claimed_at - w.fired_at) / 1000),
      reply_s: Math.round(((w.first_reply_at as number) - w.claimed_at) / 1000),
    });
    expect(u.today.latency.claim_s).toBeGreaterThanOrEqual(9);
  });
});

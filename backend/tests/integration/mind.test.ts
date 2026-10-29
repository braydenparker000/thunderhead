// The mind's loop (RUNTIME.md §3–4): claim and lease, the briefing's shape and cap, hand-out of
// owner messages through GET /v1/live/wait, acknowledgement by `status working`, requeue by the
// alarm, the fire conditions, the 120 s retry and 240 s give-up with the honest line, the fire
// call itself, and the day roll with its day_closed signal.
import { runInDurableObject } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import type { BriefResponse, LiveWaitResponse, Message, PendingResponse, Settings } from '../../../shared/contract/api';
import { fire } from '../../src/areas/mind/fire';
import * as wake from '../../src/areas/mind/wake';
import { uuidv7 } from '../../src/lib/ids';
import { commit, type Writer } from '../../src/objects/commit';
import type { Core } from '../../src/objects/core';
import { apiJson, core, coreSql, makeAgent, setupOwner } from '../helpers';

let D = '';
let C = '';
const S1 = 'cse_0123456789abcdef';
const as = (token: string, session = S1) => ({ token, headers: { 'TH-Session': session } });
const brief = (token: string, session: string, claim = true) =>
  apiJson<BriefResponse & { error?: { code: string } }>('POST', '/v1/mind/brief', {
    ...as(token, session),
    body: { claim, session_id: session, role: 'chat', constitution_sha256: 'none', th_version: '0.1.0' },
  });
const say = (body: string) => apiJson<Message>('PUT', `/v1/messages/${uuidv7()}`, { token: D, body: { body } });
const wait = (after: number, session = S1) =>
  apiJson<LiveWaitResponse>('GET', `/v1/live/wait?after=${after}&timeout=1`, as(C, session));
/** Runs `fn` inside Core with a Writer, as an area would. */
const inCore = <T>(fn: (w: Writer, o: Core) => T) =>
  runInDurableObject(
    core() as unknown as DurableObjectStub<Core>,
    (o: Core, state) => commit(state.storage, (o as unknown as { db: Writer['db'] }).db, (w) => fn(w, o)).value,
  );

beforeAll(async () => {
  D = (await setupOwner()).token;
  C = await makeAgent(D, 'mind:chat');
});

describe('claim, lease and briefing', () => {
  it('a claim with no open wake is manual, holds the lease, and a second chat session is refused', async () => {
    await say('Are you there?');
    const first = await brief(C, S1);
    expect(first.status).toBe(200);
    expect(first.body.wake).toMatchObject({ reason: 'manual', claim_match: 'manual' });
    expect(first.body.core).toMatch(/^## 1\. Now\n/m);
    expect(first.body.core).toContain('## 2. Waiting');
    expect(first.body.core).toContain('Are you there?');
    expect(first.body.core.length).toBeLessThanOrEqual(9_500);
    expect(first.body.full.length).toBeGreaterThan(first.body.core.length);
    const second = await brief(C, 'cse_another_session');
    expect(second.status).toBe(409);
    expect(second.body.error?.code).toBe('already_live');
  });

  it('refuses a body role that differs from the key', async () => {
    const r = await apiJson('POST', '/v1/mind/brief', {
      ...as(C),
      body: { claim: false, session_id: S1, role: 'night', constitution_sha256: 'none', th_version: '0.1.0' },
    });
    expect(r.status).toBe(403);
  });
});

describe('hand-out, acknowledgement and requeue', () => {
  it('a wait hands out the owner message; status working acknowledges it', async () => {
    const { body: start } = await wait(0);
    const m = (await say('What is on today?')).body;
    const { body } = await wait(start.seq);
    expect(body.changed).toBe(true);
    expect(body.kinds).toContain('message');
    expect(body.messages.map((x) => x.id)).toContain(m.id);
    expect(
      (await apiJson('POST', '/v1/mind/status', { ...as(C), body: { state: 'working', thread_id: m.thread_id } }))
        .status,
    ).toBe(204);
    const [row] = await coreSql<{ acked_at: number | null }>('SELECT acked_at FROM messages WHERE id = ?', m.id);
    expect(row.acked_at).not.toBeNull();
    const settings = (await apiJson<Settings>('GET', '/v1/settings', { token: D })).body as Record<string, unknown>;
    expect((settings['mind.status'] as { state: string }).state).toBe('working');
  });

  it('a wait with nothing new returns after its timeout', async () => {
    const { body: now } = await wait(0);
    const started = Date.now();
    const { body } = await wait(now.seq);
    expect(body.changed).toBe(false);
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
  });

  it('a handed-out message nobody acknowledges is requeued by the alarm after 120 s', async () => {
    const { body: start } = await wait(0);
    const m = (await say('Still there?')).body;
    expect((await wait(start.seq)).body.messages.map((x) => x.id)).toContain(m.id);
    await coreSql('UPDATE messages SET delivered_at = delivered_at - 121000 WHERE id = ?', m.id);
    await runInDurableObject(core() as unknown as DurableObjectStub<Core>, (o: Core) => o.alarm());
    const [row] = await coreSql<{ delivered_at: number | null }>(
      'SELECT delivered_at FROM messages WHERE id = ?',
      m.id,
    );
    expect(row.delivered_at).toBeNull();
    const pending = await apiJson<PendingResponse>('GET', '/v1/mind/pending', as(C));
    expect(pending.body.unanswered).toContain(m.id);
  });
});

describe('waking', () => {
  it('an unconnected mind never fires and shows as unconfigured', async () => {
    await coreSql('DELETE FROM leases');
    const f = await inCore((w) => wake.maybeWake(w, 'message', false));
    expect(f).toBeNull();
    const s = (await apiJson<Settings>('GET', '/v1/settings', { token: D })).body as Record<string, unknown>;
    expect((s['mind.status'] as { state: string }).state).toBe('unconfigured');
  });

  it('fires once, retries once at 120 s, gives up at 240 s with the honest line and a backoff', async () => {
    await coreSql('DELETE FROM leases');
    await coreSql('DELETE FROM wakes');
    const first = await inCore((w) => wake.maybeWake(w, 'message', true));
    expect(first).not.toBeNull();
    expect(await inCore((w) => wake.maybeWake(w, 'message', true))).toBeNull(); // unclaimed fire < 90 s
    await coreSql('UPDATE wakes SET at = at - 121000, fired_at = fired_at - 121000');
    const retry = await inCore((w) => wake.onAlarm(w, true, 'UTC'));
    expect(retry).toHaveLength(1);
    await coreSql('UPDATE wakes SET at = at - 121000 WHERE retry_of IS NOT NULL');
    await inCore((w) => wake.onAlarm(w, true, 'UTC'));
    const rows = await coreSql<{ status: string }>('SELECT status FROM wakes ORDER BY at');
    expect(rows.map((r) => r.status)).toEqual(['failed', 'failed']);
    const lines = await coreSql<{ body: string }>("SELECT body FROM messages WHERE author = 'system'");
    expect(lines.map((l) => l.body)).toContain(wake.NOT_WAKING);
    expect(await inCore((w) => wake.maybeWake(w, 'message', true))).toBeNull(); // backoff
  });

  it('the fire call sends only {"text":"wake"} with the routine headers', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return Response.json({ claude_code_session_id: 'session_abc' });
    }) as unknown as typeof fetch;
    const r = await fire({ url: 'https://example.test/fire', token: 'tok' }, fake);
    expect(r).toEqual({ status: 200, session_id: 'session_abc', error: null });
    expect(seen[0].init.body).toBe('{"text":"wake"}');
    expect(new Headers(seen[0].init.headers).get('anthropic-beta')).toBe('experimental-cc-routine-2026-04-01');
  });
});

describe('the day roll', () => {
  it('files the old day after 60 quiet minutes, titles it, opens the new day and closes the session', async () => {
    await coreSql("UPDATE settings SET value_json = '\"2020-01-01\"' WHERE key = 'day.current'");
    await coreSql("UPDATE threads SET day = '2020-01-01'");
    await coreSql('UPDATE messages SET created_at = created_at - 7200000');
    await coreSql("UPDATE mind_sessions SET day = '2020-01-01'");
    const r = await runInDurableObject(core() as unknown as DurableObjectStub<Core>, (o: Core) => o.tick());
    expect(r.rolled).not.toBeNull();
    const [old] = await coreSql<{ status: string; title: string }>(
      "SELECT status, title FROM threads WHERE day = '2020-01-01'",
    );
    expect(old.status).toBe('filed');
    expect(old.title).toBe('Are you there?');
    const pending = await apiJson<PendingResponse>('GET', '/v1/mind/pending', as(C));
    expect(pending.body.day_closed).toBe(true);
    expect((await wait(0)).body.signals).toContain('day_closed');
  });

  it("a reply after the roll can still answer yesterday's unanswered messages", async () => {
    const [last] = await coreSql<{ id: string }>(
      "SELECT id FROM messages WHERE author = 'owner' AND answered_at IS NULL ORDER BY seq DESC LIMIT 1",
    );
    const r = await apiJson<Message>('PUT', `/v1/messages/${uuidv7()}`, {
      ...as(C),
      body: { body: 'Sorry for the wait. Here it is.', reply_to: last.id },
    });
    expect(r.status).toBe(201);
    expect((await apiJson<PendingResponse>('GET', '/v1/mind/pending', as(C))).body.unanswered).toEqual([]);
  });
});

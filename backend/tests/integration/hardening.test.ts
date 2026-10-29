// Review findings on P2 stage 1, each pinned by a test: taint is never dropped, a verb's undo is
// asked once however often it is asked, a claim leaves no wake for the alarm to refire and arms
// the requeue alarm, a live session stops retries, night leaves the chat's state alone, and the
// edges of search, surfaces, the feed and message replies.
import { runInDurableObject } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import type { LedgerEntry, Message, Settings, UndoResponse, Verb } from '../../../shared/contract/api';
import * as wake from '../../src/areas/mind/wake';
import { uuidv7 } from '../../src/lib/ids';
import { commit, type Writer } from '../../src/objects/commit';
import type { Core } from '../../src/objects/core';
import { api, apiJson, core, coreSql, makeAgent, setupOwner } from '../helpers';

let D = '';
let C = '';
let N = '';
const as = (token: string, session = 'cse_hardening_1') => ({ token, headers: { 'TH-Session': session } });
const brief = (token: string, session: string, role = 'chat') =>
  apiJson('POST', '/v1/mind/brief', {
    ...as(token, session),
    body: { claim: true, session_id: session, role, constitution_sha256: 'none', th_version: '0.2.0' },
  });
const inCore = <T>(fn: (w: Writer) => T) =>
  runInDurableObject(
    core() as unknown as DurableObjectStub<Core>,
    (o: Core, state) => commit(state.storage, (o as unknown as { db: Writer['db'] }).db, fn).value,
  );

beforeAll(async () => {
  D = (await setupOwner()).token;
  C = await makeAgent(D, 'mind:chat');
  N = await makeAgent(D, 'mind:night');
});

describe('taint', () => {
  it('is kept for a session that never claimed, and needs a session to mark', async () => {
    const r = await apiJson('POST', '/v1/mind/taint', { ...as(C, 'cse_never_claimed'), body: { source: 'WebFetch' } });
    expect(r.body).toEqual({ tainted: true });
    const [row] = await coreSql<{ tainted_at: number | null; taint_source: string }>(
      "SELECT tainted_at, taint_source FROM mind_sessions WHERE session_id = 'cse_never_claimed'",
    );
    expect(row.tainted_at).not.toBeNull();
    expect(row.taint_source).toBe('WebFetch');
    expect((await api('POST', '/v1/mind/taint', { token: C, body: { source: 'WebFetch' } })).status).toBe(422);
  });
});

describe('undo of a phone action', () => {
  it('the mind may undo a verb it queued, and asking twice queues one inverse', async () => {
    const id = uuidv7();
    await apiJson('PUT', `/v1/verbs/${id}`, {
      ...as(C),
      body: { verb: 'shell.appearance', schema: 1, args: { mode: 'night' }, why: 'the owner asked for night mode' },
    });
    await apiJson('POST', `/v1/verbs/${id}/claim`, { token: D });
    const done = await apiJson<Verb>('POST', `/v1/verbs/${id}/result`, {
      token: D,
      body: {
        ok: true,
        result: { previous: 'day' },
        undo: { verb: 'shell.appearance', schema: 1, args: { mode: 'day' } },
      },
    });
    const ledgerId = done.body.ledger_id as string;
    const first = await apiJson<UndoResponse>('POST', `/v1/ledger/${ledgerId}/undo`, as(C));
    expect(first.status).toBe(200);
    expect(first.body.status).toBe('queued');
    const again = await apiJson<UndoResponse>('POST', `/v1/ledger/${ledgerId}/undo`, as(C));
    expect(again.body).toEqual(first.body);
    const inverses = await coreSql('SELECT id FROM verbs WHERE ref = ?', `ledger:${ledgerId}`);
    expect(inverses).toHaveLength(1);
  });
});

describe('waking', () => {
  it('a claim settles every open wake, so the alarm refires none, and arms the requeue alarm', async () => {
    await coreSql('DELETE FROM leases');
    await coreSql('DELETE FROM wakes');
    await coreSql('UPDATE settings SET value_json = \'{"until":0,"step":-1}\' WHERE key = \'mind.backoff\'');
    await inCore((w) => wake.maybeWake(w, 'message', true));
    await coreSql('UPDATE wakes SET at = at - 100000, fired_at = fired_at - 100000');
    await inCore((w) => wake.maybeWake(w, 'message', true)); // a second fire, 100 s later
    expect(await coreSql("SELECT id FROM wakes WHERE status = 'fired'")).toHaveLength(2);
    await apiJson<Message>('PUT', `/v1/messages/${uuidv7()}`, { token: D, body: { body: 'Is anyone there?' } });
    // No alarm before the claim, so only the claim itself can arm it.
    await runInDurableObject(core() as unknown as DurableObjectStub<Core>, async (o: Core, st) => {
      await st.storage.deleteAlarm();
      (o as unknown as { alarmAt: number | null }).alarmAt = null;
    });
    expect((await brief(C, 'cse_claims_all')).status).toBe(200);
    expect(await coreSql("SELECT id FROM wakes WHERE status IN ('fired', 'unclaimed')")).toEqual([]);
    const alarm = await runInDurableObject(core() as unknown as DurableObjectStub<Core>, (_o, s) =>
      s.storage.getAlarm(),
    );
    expect(alarm).not.toBeNull(); // the briefing's hand-out needs an ack within 120 s
    await coreSql('UPDATE wakes SET at = at - 300000');
    expect(await inCore((w) => wake.onAlarm(w, true, 'UTC'))).toEqual([]);
    expect(await coreSql("SELECT body FROM messages WHERE author = 'system'")).toEqual([]);
  });

  it('a live session stops retries and give-ups of wakes it did not claim', async () => {
    await coreSql(
      "INSERT INTO wakes (id, at, task, reason, status, fired_at) VALUES ('w-late', ?, 'chat', 'message', 'fired', ?)",
      Date.now() - 300_000,
      Date.now() - 300_000,
    );
    await apiJson('POST', '/v1/mind/status', { ...as(C, 'cse_claims_all'), body: { state: 'working' } });
    expect(await inCore((w) => wake.onAlarm(w, true, 'UTC'))).toEqual([]);
    const [row] = await coreSql<{ status: string; session_id: string }>(
      "SELECT status, session_id FROM wakes WHERE id = 'w-late'",
    );
    expect(row).toEqual({ status: 'claimed', session_id: 'cse_claims_all' });
  });

  it("the wakes list shows each fire's status, so a refused trigger is visible", async () => {
    const f = await inCore((w) => {
      w.db.run('DELETE FROM leases');
      return wake.maybeWake(w, 'message', true);
    });
    expect(f).not.toBeNull();
    await inCore((w) => wake.fired(w, (f as { id: string }).id, { status: 401, session_id: null, error: 'http_401' }));
    const list = await apiJson<{ items: { id: string; fire_status: number; fire_error: string }[] }>(
      'GET',
      '/v1/mind/wakes',
      { token: D },
    );
    expect(list.body.items.find((x) => x.id === f?.id)).toMatchObject({ fire_status: 401, fire_error: 'http_401' });
  });

  it('a night claim leaves the chat backoff, presence and Stop alone', async () => {
    await coreSql(
      "INSERT OR REPLACE INTO settings (key, value_json, updated_at, actor) VALUES ('mind.backoff', '{\"until\":9999999999999,\"step\":1}', 1, 'worker')",
    );
    const status = async () =>
      ((await apiJson<Settings>('GET', '/v1/settings', { token: D })).body as Record<string, { state?: string }>)[
        'mind.status'
      ]?.state;
    const before = await status();
    expect((await brief(N, 'cse_night_1', 'night')).status).toBe(200);
    const [b] = await coreSql<{ value_json: string }>("SELECT value_json FROM settings WHERE key = 'mind.backoff'");
    expect(JSON.parse(b.value_json).step).toBe(1);
    expect(await status()).toBe(before);
  });
});

describe('edges', () => {
  it('search ignores control characters instead of failing', async () => {
    expect((await api('GET', `/v1/search?q=${encodeURIComponent('is\u0000anyone')}`, { token: D })).status).toBe(200);
  });

  it('a surface in a slot name like "constructor" is refused, not a crash', async () => {
    const body = {
      kind: 'line',
      schema: 1,
      payload: { text: 'Hello.' },
      why: 'a short morning greeting',
      topic_key: 'x',
    };
    expect((await api('PUT', '/v1/surfaces/constructor/line.1', { ...as(C), body })).status).toBe(422);
    expect((await api('PUT', '/v1/surfaces/home/constructor', { ...as(C), body })).status).toBe(422);
  });

  it('a feed cursor past the newest change asks for a resync (a restored store)', async () => {
    const r = await apiJson<{ error: { code: string } }>('GET', '/v1/changes?after=99999999', { token: D });
    expect(r.status).toBe(410);
    expect(r.body.error.code).toBe('resync_required');
  });

  it("the mind's wait with a cursor past the newest change starts from the newest", async () => {
    const r = await apiJson<{ seq: number }>('GET', '/v1/live/wait?after=99999999&timeout=1', as(C, 'cse_claims_all'));
    expect(r.status).toBe(200);
    expect(r.body.seq).toBeLessThan(99999999);
  });

  it('a created message comes back without engineering fields', async () => {
    const r = await apiJson<Record<string, unknown>>('PUT', `/v1/messages/${uuidv7()}`, {
      token: D,
      body: { body: 'Plain.' },
    });
    expect(r.status).toBe(201);
    expect(r.body).not.toHaveProperty('req_sha256');
    expect(r.body).not.toHaveProperty('session_id');
  });

  it('undoing an older surface action never overwrites a newer one', async () => {
    const put = (text: string, topic: string) =>
      apiJson<{ ledger_id: string }>('PUT', '/v1/surfaces/home/line.2', {
        ...as(C),
        body: { kind: 'line', schema: 1, payload: { text }, why: 'a short evening line', topic_key: topic },
      });
    const older = (await put('First line.', 'first')).body.ledger_id;
    const newer = (await put('Second line.', 'second')).body.ledger_id;
    expect((await apiJson('POST', `/v1/ledger/${older}/undo`, as(C))).status).toBe(409);
    expect((await apiJson<UndoResponse>('POST', `/v1/ledger/${newer}/undo`, as(C))).body.status).toBe('undone');
    const [row] = await coreSql<{ payload_json: string }>("SELECT payload_json FROM surfaces WHERE slot = 'line.2'");
    expect(JSON.parse(row.payload_json).text).toBe('First line.');
    const rows = (await apiJson<{ items: LedgerEntry[] }>('GET', '/v1/ledger?kind=arrangement', { token: D })).body
      .items;
    expect(rows.find((r) => r.id === older)?.status).toBe('done');
  });

  it('an expired surface goes on the next prune pass', async () => {
    await coreSql("UPDATE surfaces SET expires_at = ? WHERE slot = 'line.2'", Date.now() - 1000);
    await coreSql("DELETE FROM settings WHERE key = 'prune.day'");
    await runInDurableObject(core() as unknown as DurableObjectStub<Core>, (o: Core) => o.tick());
    expect(await coreSql("SELECT slot FROM surfaces WHERE slot = 'line.2'")).toEqual([]);
  });
});

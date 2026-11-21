// An owner's message is answered or owned up to (RUNTIME.md §4.5, §9 F3): a chat session that
// acknowledged a message and died is refired for it once its lease lapses (at most twice per
// message), then the presence turns `failed` so home stops showing "thinking"; a message sent
// during a usage backoff gets one wake when the backoff ends; and `reply.late` trips on a message
// unanswered for more than 30 minutes, outside quiet hours only.
import { runInDurableObject } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { LiveWaitResponse, Message, MindPresence } from '../../../shared/contract/api';
import { CONVERSATION_CHECKS } from '../../src/areas/conversation/checks';
import * as wake from '../../src/areas/mind/wake';
import { CHECKS } from '../../src/areas/watchdogs/checks';
import { uuidv7 } from '../../src/lib/ids';
import { commit, type Writer } from '../../src/objects/commit';
import type { Core } from '../../src/objects/core';
import { apiJson, core, coreSql, makeAgent, setupOwner } from '../helpers';

let D = '';
let C = '';
const as = (session: string) => ({ token: C, headers: { 'TH-Session': session } });
const say = (body: string) => apiJson<Message>('PUT', `/v1/messages/${uuidv7()}`, { token: D, body: { body } });
const claim = (session: string) =>
  apiJson('POST', '/v1/mind/brief', {
    ...as(session),
    body: { claim: true, session_id: session, role: 'chat', constitution_sha256: 'none', th_version: '0.1.0' },
  });
const working = (session: string) =>
  apiJson('POST', '/v1/mind/status', { ...as(session), body: { state: 'working', note: 'looking' } });
const inCore = <T>(fn: (w: Writer) => T) =>
  runInDurableObject(
    core() as unknown as DurableObjectStub<Core>,
    (o: Core, state) => commit(state.storage, (o as unknown as { db: Writer['db'] }).db, (w) => fn(w)).value,
  );
const row = async (id: string) =>
  (
    await coreSql<{ delivered_at: number | null; acked_at: number | null; refires: number }>(
      'SELECT delivered_at, acked_at, refires FROM messages WHERE id = ?',
      id,
    )
  )[0];
const presence = async () =>
  JSON.parse(
    (await coreSql<{ value_json: string }>("SELECT value_json FROM settings WHERE key = 'mind.status'"))[0].value_json,
  ) as MindPresence;
/** The session is gone: its lease ran out a while ago, and earlier wakes are out of the way. */
const lapse = async () => {
  await coreSql('UPDATE leases SET renewed_at = renewed_at - ?', wake.LEASE_MS + 1000);
  await coreSql("UPDATE wakes SET at = at - 7200000, status = 'ended'");
};

beforeAll(async () => {
  D = (await setupOwner()).token;
  C = await makeAgent(D, 'mind:chat');
});

beforeEach(async () => {
  await coreSql("UPDATE messages SET answered_at = 1 WHERE author = 'owner' AND answered_at IS NULL");
  await coreSql('DELETE FROM leases');
  await coreSql('DELETE FROM wakes');
  await coreSql("DELETE FROM settings WHERE key = 'mind.backoff'");
});

describe('a session that dies after acknowledging', () => {
  it('is refired at its lease end, at most twice per message, then the presence says failed', async () => {
    const m = (await say('Is the bridge open today?')).body;
    for (const [n, session] of ['cse_lapse_one', 'cse_lapse_two'].entries()) {
      expect((await claim(session)).status).toBe(200);
      await working(session); // acknowledges what the briefing handed out
      expect((await row(m.id)).acked_at).not.toBeNull();
      const due = await runInDurableObject(core() as unknown as DurableObjectStub<Core>, (o: Core) =>
        wake.nextAlarmAt((o as unknown as { db: Writer['db'] }).db),
      );
      expect(due).not.toBeNull();
      expect(await inCore((w) => wake.onAlarm(w, true, 'UTC'))).toEqual([]); // the lease is still live
      await lapse();
      const fires = await inCore((w) => wake.onAlarm(w, true, 'UTC'));
      expect(fires).toHaveLength(1);
      expect(await row(m.id)).toEqual({ delivered_at: null, acked_at: null, refires: n + 1 });
      expect((await presence()).state).toBe('waking');
      const [w] = await coreSql<{ reason: string }>("SELECT reason FROM wakes WHERE status = 'fired'");
      expect(w.reason).toBe('requeue');
    }
    expect((await claim('cse_lapse_three')).status).toBe(200);
    await working('cse_lapse_three');
    await lapse();
    expect(await inCore((w) => wake.onAlarm(w, true, 'UTC'))).toEqual([]);
    expect((await row(m.id)).refires).toBe(2);
    expect((await presence()).state).toBe('failed');
    // Nothing more is due for it: the alarm doesn't spin.
    const due = await runInDurableObject(core() as unknown as DurableObjectStub<Core>, (o: Core) =>
      wake.nextAlarmAt((o as unknown as { db: Writer['db'] }).db),
    );
    expect(due).toBeNull();
  });

  it('a wait that handed out a message, then a dead session: the presence stops saying working', async () => {
    expect((await claim('cse_lapse_four')).status).toBe(200);
    const { body: start } = await apiJson<LiveWaitResponse>(
      'GET',
      '/v1/live/wait?after=0&timeout=1',
      as('cse_lapse_four'),
    );
    await say('And the ferry?');
    await apiJson('GET', `/v1/live/wait?after=${start.seq}&timeout=1`, as('cse_lapse_four'));
    expect((await presence()).state).toBe('working');
    await lapse();
    await inCore((w) => wake.onAlarm(w, true, 'UTC'));
    expect((await presence()).state).toBe('failed');
  });
});

describe('a usage backoff', () => {
  it('a message sent during it is refused a wake, then gets one when it ends, once', async () => {
    const until = Date.now() + 15 * 60_000;
    await coreSql(
      "INSERT INTO settings (key, value_json, updated_at, actor) VALUES ('mind.backoff', ?, ?, 'worker')",
      JSON.stringify({ until, step: 0 }),
      Date.now(),
    );
    await say('Remind me what we said about the trip.');
    // A backoff comes with the presence that says the mind isn't coming (giveUp: failed); this
    // test Worker has no routine, so the post itself set unconfigured.
    await coreSql(
      "INSERT OR REPLACE INTO settings (key, value_json, updated_at, actor) VALUES ('mind.status', ?, ?, 'worker')",
      JSON.stringify({ state: 'failed', note: null, since: Date.now() }),
      Date.now(),
    );
    expect(await inCore((w) => wake.maybeWake(w, 'message', true))).toBeNull(); // the backoff refuses it
    expect(await coreSql('SELECT id FROM wakes')).toHaveLength(0);
    const due = await runInDurableObject(core() as unknown as DurableObjectStub<Core>, (o: Core) =>
      wake.nextAlarmAt((o as unknown as { db: Writer['db'] }).db),
    );
    expect(due).toBe(until);
    expect(await inCore((w) => wake.onAlarm(w, true, 'UTC'))).toEqual([]); // not yet
    await coreSql(
      "UPDATE settings SET value_json = ? WHERE key = 'mind.backoff'",
      JSON.stringify({ until: Date.now() - 1000, step: 0 }),
    );
    const fires = await inCore((w) => wake.onAlarm(w, true, 'UTC'));
    expect(fires).toHaveLength(1);
    expect((await coreSql<{ reason: string }>('SELECT reason FROM wakes'))[0].reason).toBe('message');
    // The wake went out after the backoff ended: no second one for the same end.
    await coreSql("UPDATE wakes SET at = ?, status = 'ended'", Date.now());
    expect(await inCore((w) => wake.onAlarm(w, true, 'UTC'))).toEqual([]);
  });
});

describe('reply.late', () => {
  const check = CONVERSATION_CHECKS['reply.late'];
  const day = new Date();
  const noon = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 12, 0);
  const night = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 23, 0);
  const run = (at: number) =>
    inCore((w) => check(w.db, { at, tz: 'UTC', dbBytes: 0, nightConfigured: false }, null).detail);

  it('is a built watchdog that trips after 30 minutes outside quiet hours, and clears once answered', async () => {
    expect(CHECKS['reply.late']).toBe(check);
    const m = (await say('Did the parcel come?')).body;
    await coreSql('UPDATE messages SET created_at = ? WHERE id = ?', noon - 29 * 60_000, m.id);
    expect(await run(noon)).toBeNull();
    await coreSql('UPDATE messages SET created_at = ? WHERE id = ?', noon - 31 * 60_000, m.id);
    expect(await run(noon)).toBe('an owner message has waited 31 min for a reply');
    await coreSql('UPDATE messages SET created_at = ? WHERE id = ?', night - 60 * 60_000, m.id);
    expect(await run(night)).toBeNull(); // 23:00 is inside the default quiet hours
    await coreSql('UPDATE messages SET answered_at = ? WHERE id = ?', noon, m.id);
    expect(await run(noon)).toBeNull();
  });
});

// Honest when the plan runs out (RUNTIME.md §9 F2/F4, §11): an owner's message a backoff or the
// hour's cap refuses is held to the time they lift, the chat says until when (the reset time when
// the platform gives one), the hit is counted, and one wake goes out when the hold ends, whatever
// the presence says, with what a stopped session took handed out again first.
import { runInDurableObject } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Message } from '../../../shared/contract/api';
import { clock } from '../../src/areas/mind/brief-text';
import * as wake from '../../src/areas/mind/wake';
import { uuidv7 } from '../../src/lib/ids';
import { HOUR, MINUTE } from '../../src/lib/time';
import { commit, type Writer } from '../../src/objects/commit';
import type { Core } from '../../src/objects/core';
import { apiJson, core, coreSql } from '../helpers';
import { as, brief, type Principals, principals } from '../memory-helpers';

let p: Principals;
const stub = () => core() as unknown as DurableObjectStub<Core>;
const inCore = <T>(fn: (w: Writer) => T) =>
  runInDurableObject(
    stub(),
    (o: Core, state) => commit(state.storage, (o as unknown as { db: Writer['db'] }).db, fn).value,
  );
const nextAlarm = () =>
  runInDurableObject(stub(), (o: Core) => wake.nextAlarmAt((o as unknown as { db: Writer['db'] }).db));
const say = async (body: string) =>
  (await apiJson<Message>('PUT', `/v1/messages/${uuidv7()}`, { token: p.D, body: { body } })).body;
const setting = async (key: string) => {
  const [r] = await coreSql<{ value_json: string }>('SELECT value_json FROM settings WHERE key = ?', key);
  return r ? JSON.parse(r.value_json) : undefined;
};
const putSetting = (key: string, value: unknown) =>
  coreSql(
    "INSERT OR REPLACE INTO settings (key, value_json, updated_at, actor) VALUES (?, ?, 0, 'worker')",
    key,
    JSON.stringify(value),
  );
const heldLines = () =>
  coreSql<{ body: string }>(
    "SELECT body FROM messages WHERE author = 'system' AND json_extract(meta_json, '$.line') = 'not_waking' ORDER BY seq DESC",
  );

beforeAll(async () => {
  p = await principals();
});

beforeEach(async () => {
  await coreSql("UPDATE messages SET answered_at = 1 WHERE author = 'owner' AND answered_at IS NULL");
  await coreSql('DELETE FROM leases');
  await coreSql('DELETE FROM wakes');
  await coreSql("DELETE FROM settings WHERE key IN ('mind.backoff', 'mind.held', 'mind.limit_hits')");
  await coreSql("DELETE FROM messages WHERE author = 'system'");
});

describe('a message the plan holds', () => {
  it('past 20 fires in the hour: held to when the hour frees, told so once, woken then', async () => {
    for (let k = 0; k < 20; k++)
      await coreSql(
        "INSERT INTO wakes (id, at, task, reason, status) VALUES (?, ?, 'chat', 'message', 'ended')",
        uuidv7(),
        Date.now() - 2 * MINUTE - k * MINUTE,
      );
    await say('Is the market on today?');
    expect(await inCore((w) => wake.maybeWake(w, 'message', true, 'UTC'))).toBeNull();
    const [oldest] = await coreSql<{ at: number }>('SELECT min(at) AS at FROM wakes');
    const until = oldest.at + HOUR;
    expect((await setting('mind.backoff')).until).toBe(until);
    expect((await setting('mind.status')).state).toBe('limited');
    expect((await heldLines())[0].body).toContain(`answers it first at ${clock(until, 'UTC')}`);
    await inCore((w) => wake.maybeWake(w, 'message', true, 'UTC'));
    expect(await heldLines()).toHaveLength(1); // the same time: no second line
    expect(await nextAlarm()).toBe(until);
    await coreSql('UPDATE wakes SET at = at - ?', HOUR);
    await putSetting('mind.backoff', { until: Date.now() - 1000, step: -1 });
    expect(await inCore((w) => wake.onAlarm(w, true, 'UTC'))).toHaveLength(1);
  });

  it('a limit in a turn: the backoff ends at the reset the platform gave, the chat says so, the hit counts', async () => {
    await say('What did we plan for Saturday?');
    const reset = Date.now() + 3 * HOUR + 7 * MINUTE;
    await inCore((w) => wake.limited(w, 'rate_limit', reset));
    expect((await setting('mind.backoff')).until).toBe(reset);
    expect((await heldLines())[0].body).toContain(`when the limit resets at ${clock(reset, 'UTC')}`);
    expect(await setting('mind.limit_hits')).toHaveLength(1);
  });

  it('a backoff ends in a wake even when the presence went back to asleep', async () => {
    const until = Date.now() + 20 * MINUTE;
    await putSetting('mind.backoff', { until, step: 0 });
    await putSetting('mind.status', { state: 'asleep', note: null, since: Date.now() });
    await say('Can you find that recipe again?');
    expect(await nextAlarm()).toBe(until); // before: null, so nothing ever fired for it
  });

  it('a refused fire (429) with a reset time holds to it and says until when', async () => {
    await say('Is it going to rain?');
    const f = await inCore((w) => wake.maybeWake(w, 'message', true, 'UTC'));
    expect(f).not.toBeNull();
    const retry = Date.now() + 2 * HOUR;
    await inCore((w) =>
      wake.fired(w, f?.id ?? '', { status: 429, session_id: null, error: 'http_429', retry_at: retry }),
    );
    expect((await setting('mind.backoff')).until).toBe(retry);
    expect((await heldLines())[0].body).toContain(`resets at ${clock(retry, 'UTC')}`);
    expect(await setting('mind.limit_hits')).toHaveLength(1);
  });

  it('what a session the limit stopped had taken is handed out again when the backoff ends, first', async () => {
    const m = await say('Book the table for four.');
    expect((await brief(p.C, 'cse_limit_one', 'chat')).status).toBe(200);
    await apiJson('POST', '/v1/mind/status', {
      ...as(p.C, 'cse_limit_one'),
      body: { state: 'working', note: 'on it' },
    });
    await apiJson('POST', '/v1/mind/status', {
      ...as(p.C, 'cse_limit_one'),
      body: { state: 'limited', error: 'rate_limit', resets_at: Date.now() + HOUR },
    });
    expect((await heldLines())[0].body).toContain('when the limit resets at');
    await coreSql('UPDATE leases SET renewed_at = renewed_at - ?', 2 * HOUR);
    await coreSql("UPDATE wakes SET at = at - 7200000, status = 'ended'");
    await putSetting('mind.backoff', { until: Date.now() - 1000, step: 0, reset: true });
    expect(await inCore((w) => wake.onAlarm(w, true, 'UTC'))).toHaveLength(1);
    const [row] = await coreSql<{ delivered_at: number | null; acked_at: number | null }>(
      'SELECT delivered_at, acked_at FROM messages WHERE id = ?',
      m.id,
    );
    expect(row).toEqual({ delivered_at: null, acked_at: null });
  });
});

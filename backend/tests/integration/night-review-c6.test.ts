// Stage C.6, the night shift's review fixes: a day's window starts no earlier than its own start
// (with no thread the day before, two nights read the same rows); a 429 on the night fire doesn't
// hold the owner's chat wakes; and only real calendar days are taken. Each failed on 49fa9d7.
import { runInDurableObject } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ErrorBody, MindNightResponse, Page, SessionNote, TodayResponse } from '../../../shared/contract/api';
import { maybeWake } from '../../src/areas/mind/wake';
import { dayBefore, HOUR, zonedInstant } from '../../src/lib/time';
import { commit, type Writer } from '../../src/objects/commit';
import type { Core } from '../../src/objects/core';
import { api, apiJson, core, coreSql } from '../helpers';
import { as, brief, type Principals, principals } from '../memory-helpers';

let p: Principals;
let today = '';
const stub = () => core() as unknown as DurableObjectStub<Core>;
const inCore = <T>(fn: (w: Writer) => T) =>
  runInDurableObject(
    stub(),
    (o: Core, state) => commit(state.storage, (o as unknown as { db: Writer['db'] }).db, fn).value,
  );

beforeAll(async () => {
  p = await principals();
  today = (await apiJson<TodayResponse>('GET', '/v1/threads/today', { token: p.D })).body.day;
});

describe("a day's window", () => {
  it('starts no earlier than the day itself when the day before had no thread', async () => {
    const [A, B, C] = [dayBefore(today, 30), dayBefore(today, 29), dayBefore(today, 28)];
    const rollAt = (d: string) => zonedInstant(d, 4, 'UTC') + HOUR;
    const thread = (id: string, d: string) =>
      coreSql(
        `INSERT INTO threads (id, day, kind, status, started_at, filed_at, updated_at) VALUES (?, ?, 'daily', 'filed', ?, ?, ?)`,
        id,
        d,
        rollAt(d),
        rollAt(dayBefore(d, -1)),
        rollAt(dayBefore(d, -1)),
      );
    await thread('t-c6-a', A);
    await thread('t-c6-c', C);
    // A note written while day B was open (B had no messages, so no thread).
    await coreSql(
      `INSERT INTO session_notes (id, session_id, wake_id, role, thread_id, created_at, body, open_items_json) VALUES ('n-c6-b', 's', NULL, 'night', NULL, ?, 'written during B', '[]')`,
      rollAt(B) + 2 * HOUR,
    );
    const notes = async (d: string) =>
      (await apiJson<Page<SessionNote>>('GET', `/v1/mind/day/${d}?part=notes`, { token: p.N })).body.items.map(
        (n) => n.id,
      );
    expect(await notes(B)).toContain('n-c6-b');
    expect(await notes(C)).not.toContain('n-c6-b');
  });
});

describe('a 429 on the night fire', () => {
  it("is recorded on the night wake but doesn't hold the owner's chat wakes", async () => {
    await coreSql(
      `INSERT INTO settings (key, value_json, updated_at, actor) VALUES ('day.current', ?, 0, 'worker')
       ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json`,
      JSON.stringify(dayBefore(today, 5)),
    );
    await coreSql('UPDATE messages SET created_at = created_at - 7200000');
    // No session live and no wake open, so a message from the owner would wake the chat role.
    await coreSql('DELETE FROM leases');
    await coreSql("UPDATE wakes SET status = 'failed' WHERE status IN ('fired', 'unclaimed', 'claimed')");
    await coreSql("DELETE FROM settings WHERE key = 'mind.backoff'");
    const r = await runInDurableObject(stub(), async (o: Core) => {
      const self = o as unknown as { env: Env };
      const before = self.env;
      self.env = { ...before, ROUTINE_NIGHT_URL: 'https://api.example.test/night', ROUTINE_NIGHT_TOKEN: 'tok' };
      try {
        return await o.tick(Date.now(), (async () => new Response('{}', { status: 429 })) as unknown as typeof fetch);
      } finally {
        self.env = before;
      }
    });
    expect(r.night).not.toBeNull();
    expect(await coreSql('SELECT fire_status FROM wakes WHERE id = ?', r.night)).toEqual([{ fire_status: 429 }]);
    expect(await coreSql("SELECT key FROM settings WHERE key = 'mind.backoff'")).toEqual([]);
    expect(await inCore((w) => maybeWake(w, 'message', true))).not.toBeNull();
  });
});

describe('a day that is not a calendar date', () => {
  it('is refused by both night routes, and no run row is made', async () => {
    expect((await api('GET', '/v1/mind/day/2026-00-00?part=stats', { token: p.N })).status).toBe(422);
    await brief(p.N, 'cse_c6_baddate', 'night');
    const n = await apiJson<MindNightResponse & ErrorBody>('POST', '/v1/mind/night', {
      ...as(p.N, 'cse_c6_baddate'),
      body: { day: '2026-02-31', action: 'start' },
    });
    expect(n.status).toBe(422);
    expect(await coreSql("SELECT day FROM night_runs WHERE day = '2026-02-31'")).toEqual([]);
  });
});

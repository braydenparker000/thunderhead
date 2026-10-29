// Stage A.7, the third look at P3 memory: each finding as a test that fails on a19148a. A taint is
// found by its own time, not by the day its session was claimed on, so a session that runs across
// the day roll can't shed it, and it carries over for 24 hours: 23 hours old it does, 25 it doesn't.
// The never-stored sentences are unit tests (tests/unit/memory-guards.test.ts); two of them go
// through the route here. Storage carries over between tests, so the untainted case runs first.
import { beforeAll, describe, expect, it } from 'vitest';
import { dayBefore, HOUR } from '../../src/lib/time';
import { apiJson, coreSql } from '../helpers';
import {
  addOp,
  as,
  brief,
  CHAT_SESSION,
  NIGHT_SESSION,
  ownerSays,
  type Principals,
  principals,
  reason,
} from '../memory-helpers';

let P = {} as Principals;
let said = '';
let today = '';
const taint = (token: string, session: string) =>
  apiJson('POST', '/v1/mind/taint', { ...as(token, session), body: { source: 'WebFetch' } });
const stop = (token: string, session: string) =>
  apiJson('POST', '/v1/mind/status', { ...as(token, session), body: { state: 'stopping' } });
const add = (token: string, session: string, text: string) =>
  reason(as(token, session), addOp([`msg:${said}`], { text }));
/** Moves every tainted session of `role` to a taint `hours` old. */
const age = (role: string, hours: number) =>
  coreSql(
    'UPDATE mind_sessions SET tainted_at = ? WHERE role = ? AND tainted_at IS NOT NULL',
    Date.now() - hours * HOUR,
    role,
  );

beforeAll(async () => {
  P = await principals();
  said = await ownerSays(P.D, 'Probe owner words.');
  today = (await brief(P.N, NIGHT_SESSION, 'night')).body.day;
});

describe('never stored, through the route', () => {
  it('a PIN-protected notebook is kept; a password said in one word is refused', async () => {
    expect(await add(P.C, CHAT_SESSION, 'Keeps a PIN-protected notebook')).toBeNull();
    expect(await add(P.C, CHAT_SESSION, 'My password is Summer')).toBe('never_stored');
  });
});

describe('a taint is found by its own time, and holds for 24 hours', () => {
  it('a chat session that runs across the day roll passes its taint to the next claim', async () => {
    await stop(P.C, CHAT_SESSION);
    expect((await brief(P.C, 'cse_a7_spans', 'chat')).body.tainted).toBe(false);
    // The day rolls while that session still runs, then it reads outside text.
    await coreSql(
      `INSERT INTO settings (key, value_json, updated_at, actor) VALUES ('day.current', ?, 0, 'worker')
       ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json`,
      JSON.stringify(dayBefore(today, -1)),
    );
    await taint(P.C, 'cse_a7_spans');
    await stop(P.C, 'cse_a7_spans');
    const next = await brief(P.C, 'cse_a7_after_roll', 'chat');
    expect([next.body.day, next.body.tainted]).toEqual([dayBefore(today, -1), true]);
    expect(await add(P.C, 'cse_a7_after_roll', 'Laundered across the roll')).toBe('session_tainted');
  });

  it('a taint 23 hours old carries over', async () => {
    await taint(P.N, NIGHT_SESSION);
    await age('night', 23);
    expect((await brief(P.N, 'cse_a7_23h', 'night')).body.tainted).toBe(true);
  });

  it("a taint 25 hours old doesn't", async () => {
    // The claim above inherited the taint with its own time, so it is 25 hours old too.
    await age('night', 25);
    const b = await brief(P.N, 'cse_a7_25h', 'night');
    expect(b.body.tainted).toBe(false);
    expect(await add(P.N, 'cse_a7_25h', 'A clean write a day later')).toBeNull();
  });
});

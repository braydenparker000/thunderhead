// A night run already done (RUNTIME.md §12) answers `done` only to a night session that claimed
// and is live, or ended with that run (a retried `done`); that session's end is the one write.
// A made-up session id, one that never claimed, another role's session or a night session that
// ended before the run is refused (403 session_required), and no session is ended for it.
import { beforeAll, describe, expect, it } from 'vitest';
import type { ErrorBody, MindNightResponse, TodayResponse } from '../../../shared/contract/api';
import { dayBefore } from '../../src/lib/time';
import { apiJson, coreSql } from '../helpers';
import { as, brief, CHAT_SESSION, type Principals, principals } from '../memory-helpers';

let p: Principals;
let day = '';
const DONE_AT = 1_000_000;
const start = (session: string) =>
  apiJson<MindNightResponse & ErrorBody>('POST', '/v1/mind/night', {
    ...as(p.N, session),
    body: { day, action: 'start' },
  });
const ended = async (session: string) =>
  (await coreSql<{ ended_at: number | null }>('SELECT ended_at FROM mind_sessions WHERE session_id = ?', session))[0]
    ?.ended_at ?? null;

beforeAll(async () => {
  p = await principals();
  day = dayBefore((await apiJson<TodayResponse>('GET', '/v1/threads/today', { token: p.D })).body.day);
  await coreSql(
    "INSERT INTO night_runs (day, started_at, step, steps_json, done_at, session_id) VALUES (?, 1, 10, '{}', ?, 'cse_gone')",
    day,
    DONE_AT,
  );
});

describe('a night run already done', () => {
  it('refuses a session that never claimed, a made-up one, another role and one ended before it', async () => {
    await brief(p.N, 'cse_night_live', 'night');
    await brief(p.N, 'cse_night_old', 'night');
    await coreSql('UPDATE mind_sessions SET ended_at = ? WHERE session_id = ?', DONE_AT - 1, 'cse_night_old');
    for (const session of ['cse_made_up', CHAT_SESSION, 'cse_night_old']) {
      const r = await start(session);
      expect(r.status, session).toBe(403);
      expect(r.body.error.code, session).toBe('session_required');
    }
    expect(await ended('cse_night_live')).toBeNull();
    expect(await ended(CHAT_SESSION)).toBeNull();
    expect(await ended('cse_night_old')).toBe(DONE_AT - 1);
  });

  it('answers the claimed night session done and ends it; its retry gets the same answer', async () => {
    const r = await start('cse_night_live');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ resume_from: 11, done: true });
    const at = await ended('cse_night_live');
    expect(at).not.toBeNull();
    expect((await start('cse_night_live')).body).toMatchObject({ done: true });
    expect(await ended('cse_night_live')).toBe(at);
  });
});

// The night in one pass (RUNTIME.md §12, 2026-11-22): `th` closes the steps itself. `through`
// closes every open step up to its own (a step not due tonight keeps its reason), never the last
// one; a plain `done` closes what is left as done; a resumed run starts at the first open step.

import { beforeAll, describe, expect, it } from 'vitest';
import type { ErrorBody, MindNightRequest, MindNightResponse, TodayResponse } from '../../../shared/contract/api';
import { NIGHT_END } from '../../../shared/contract/night.ts';
import { weekly } from '../../src/areas/mind/night';
import { dayBefore } from '../../src/lib/time';
import { apiJson, coreSql } from '../helpers';
import { as, brief, type Principals, principals } from '../memory-helpers';

let p: Principals;
let today = '';
const night = (body: MindNightRequest, session: string) =>
  apiJson<MindNightResponse & ErrorBody>('POST', '/v1/mind/night', { ...as(p.N, session), body });
const steps = async (day: string) =>
  JSON.parse(
    (await coreSql<{ steps_json: string }>('SELECT steps_json FROM night_runs WHERE day = ?', day))[0].steps_json,
  );

beforeAll(async () => {
  p = await principals();
  today = (await apiJson<TodayResponse>('GET', '/v1/threads/today', { token: p.D })).body.day;
});

describe('the night closes its own steps', () => {
  it('through closes every open step up to its own, in order; the last step only with done', async () => {
    const day = dayBefore(today, 4);
    await brief(p.N, 'cse_flow_a', 'night');
    expect((await night({ day, action: 'start' }, 'cse_flow_a')).body.resume_from).toBe(1);
    expect((await night({ day, action: 'through', step: 2 }, 'cse_flow_a')).body.resume_from).toBe(3);
    // Going back closes nothing more.
    expect((await night({ day, action: 'through', step: 1 }, 'cse_flow_a')).body.resume_from).toBe(3);
    // The report closes 3, 4, 7, 13 and health (5) with it.
    expect((await night({ day, action: 'through', step: 12 }, 'cse_flow_a')).body.resume_from).toBe(6);
    const s = await steps(day);
    for (const n of [1, 2, 3, 4, 5, 7, 12]) expect(s[n], `${n}`).toMatchObject({ done: true, session: 'cse_flow_a' });
    expect((await night({ day, action: 'through', step: 10 }, 'cse_flow_a')).status).toBe(422);
    expect((await night({ day, action: 'through', step: 42 }, 'cse_flow_a')).status).toBe(422);
  });

  it('a resumed run starts at the first open step, and a plain done closes the rest as done', async () => {
    const day = dayBefore(today, 4);
    await brief(p.N, 'cse_flow_b', 'night');
    // The first session stopped; after its hold a refire takes over where it was.
    await coreSql("UPDATE mind_sessions SET ended_at = 1 WHERE session_id = 'cse_flow_a'");
    expect((await night({ day, action: 'start' }, 'cse_flow_b')).body).toMatchObject({ resume_from: 6, done: false });
    const r = await night({ day, action: 'done' }, 'cse_flow_b');
    expect(r.body).toEqual({ resume_from: NIGHT_END, done: true, cursor: null, skipped: weekly(day) ? [8] : [8, 9] });
    const s = await steps(day);
    for (const n of [6, 11, 10]) expect(s[n], `${n}`).toMatchObject({ done: true, session: 'cse_flow_b' });
    expect(s[8].skipped).toBe('later');
  });
});

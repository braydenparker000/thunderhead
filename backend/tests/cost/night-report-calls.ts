// The night's report in the cost suite (cost.test.ts checks every budget; BRIEFING.md "The report
// card"): night step 12's PUT from a claimed night session, first (the open day's thread already
// has the owner's words here, so it is a tile only: the report row, its ledger row and the
// change-feed rows, after reading the run, the night's ledger rows since it began and its
// predictions), the same body again (reads only), a replacement, then the Briefing with its tile
// (the report's row and the quiet hours' end; its lines name no ledger row, so the read is the
// same at any hour), then night step 13 (growth-calls.ts). Run from briefing-calls.ts.
import type { NewAgentResponse, SignedIn, Surface, TodayResponse } from '../../../shared/contract/api';
import { dayBefore } from '../../src/lib/time';
import { api, apiJson, core, PASSWORD } from '../helpers';
import { as, brief, firedWake } from '../memory-helpers';

type Cost = (
  name: string,
  fn: () => Promise<Response>,
  status: number,
  stub?: ReturnType<typeof core>,
) => Promise<void>;

export async function nightReportCalls(cost: Cost, d: SignedIn) {
  const N = (
    await apiJson<NewAgentResponse>('POST', '/v1/auth/agents', {
      token: d.token,
      body: { name: 'night-cost-report', role: 'mind:night', current_password: `${PASSWORD} new` },
    })
  ).body.token;
  const S = 'cse_cost_report_night';
  await firedWake('night', S);
  await brief(N, S, 'night');
  const day = dayBefore((await apiJson<TodayResponse>('GET', '/v1/threads/today', { token: d.token })).body.day);
  await api('POST', '/v1/mind/night', { ...as(N, S), body: { day, action: 'start' } });
  const tile = await apiJson<Surface>('PUT', '/v1/surfaces/briefing/note.3', {
    ...as(N, S),
    body: {
      kind: 'tile',
      schema: 1,
      payload: { label: 'Note', value: 'A made-up note' },
      why: 'An invented tile for the cost suite.',
      topic_key: 'cost.report',
      expires_at: Date.now() + 3_600_000,
    },
  });
  const body = (headline: string) => ({
    headline,
    lines: [
      { kind: 'built', text: 'Put a note on the Briefing', ref: `ledger:${tile.body.ledger_id}` },
      { kind: 'music', text: 'Music is ready for the evening', ref: 'app:music' },
    ],
  });
  const put = (headline: string) => api('PUT', `/v1/briefing/report/${day}`, { ...as(N, S), body: body(headline) });
  await cost('PUT /v1/briefing/report/:day (Core, first)', () => put('A quiet night'), 200, core());
  await cost('PUT /v1/briefing/report/:day (Core, the same again)', () => put('A quiet night'), 200, core());
  await cost('PUT /v1/briefing/report/:day (Core, replaced)', () => put('A quiet night, one note'), 200, core());
  await api('PUT', `/v1/briefing/report/${day}`, {
    ...as(N, S),
    body: { headline: 'A quiet night, one note', lines: [{ kind: 'music', text: 'Music is ready', ref: 'app:music' }] },
  });
  await cost('GET /v1/briefing (Core, with the night’s report)', () => api('GET', '/v1/briefing', d), 200, core());
  await import('./growth-calls').then((m) => m.growthCalls(cost, d, N, S, day));
}

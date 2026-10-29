// The watchdog routes and the drill (OPERATIONS.md §8.2, SETUP.md M2): who reads the registry and
// reports a trip, and the drill the owner uses to check, on the live Worker, that mind-reflex
// handles a trip end to end. Everything is synthetic.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  WATCHDOG_NAMES,
  type WatchdogDrillResponse,
  type WatchdogsResponse,
} from '../../../shared/contract/watchdogs.ts';
import { MINUTE } from '../../src/lib/time';
import { api, apiJson, coreSql, makeAgent } from '../helpers';
import type { Principals } from '../memory-helpers';
import { BIG, CLEAR, connected, notes, resetWatchdogs, setupWatchdogs, TRIP, watch } from '../watchdog-helpers';

let p: Principals;
let R = '';
beforeAll(async () => {
  const s = await setupWatchdogs();
  p = s;
  R = s.R;
});
beforeEach(resetWatchdogs);

describe('the routes', () => {
  it('every registry entry for D C N R I, never Muse or the sandbox; a report needs a trip and the report route', async () => {
    const M = await makeAgent(p.D, 'muse');
    const I = await makeAgent(p.D, 'ci', 'ci-wd');
    for (const t of [p.D, p.C, p.N, R, I])
      expect((await api('GET', '/v1/ops/watchdogs', { token: t })).status).toBe(200);
    expect((await api('GET', '/v1/ops/watchdogs', { token: M })).status).toBe(403);
    expect((await api('GET', '/v1/ops/watchdogs', { token: p.C, headers: { 'TH-Sandbox': 'eval' } })).status).toBe(422);
    const items = (await apiJson<WatchdogsResponse>('GET', '/v1/ops/watchdogs', { token: p.D })).body.items;
    expect(items.map((i) => i.name)).toEqual(WATCHDOG_NAMES);
    expect(items.filter((i) => i.state === 'ok').map((i) => i.name)).toEqual([
      'errors.spike',
      'client.errors',
      'roll.stuck',
      'night.late',
      'jobs.stuck',
      'db.size',
      'backup.stale',
      'drill.failed',
      'drill.overdue',
    ]);
    expect(items.find((i) => i.name === 'muse.silent')).toMatchObject({
      state: 'later',
      waits: 'Muse on work orders (P4 stage G)',
    });
    expect(items.find((i) => i.name === 'events.export.late')).toMatchObject({ state: 'later', waits: 'phase P5' });
    const body = { outcome: 'nothing', note: 'Nothing changed; it cleared.' };
    const report = (token: string, name: string, b: object = body) =>
      api('POST', `/v1/ops/watchdogs/${name}/handled`, { token, body: b });
    expect((await report(R, 'db.size')).status).toBe(409);
    expect((await report(R, 'nope')).status).toBe(404);
    await watch(Date.now(), { dbBytes: BIG });
    expect((await report(R, 'db.size', { outcome: 'nothing', note: 'short' })).status).toBe(422);
    expect((await report(p.D, 'db.size')).status).toBe(403);
    expect((await report(R, 'db.size')).status).toBe(200);
  });
});

describe('the drill (SETUP.md M2)', () => {
  it('trips one watchdog by hand and wakes the connected reflex; it holds until reported, then clears', async () => {
    const calls: string[] = [];
    const fake = (async (url: string) => {
      calls.push(url);
      return Response.json({ claude_code_session_id: 'session_drill' });
    }) as unknown as typeof fetch;
    const owner = { actor: 'owner', who: 'D', session_id: null, device_id: null } as const;
    const drill = (name: 'db.size' | 'roll.stuck' | 'muse.silent') =>
      connected((o) => o.watchdogDrill(owner, name, fake));
    const d = await drill('db.size');
    expect(d.ok && { fired: d.value.fired, state: d.value.item.state, detail: d.value.item.detail }).toEqual({
      fired: 'fired',
      state: 'tripped',
      detail: 'a drill: tripped by hand, nothing is wrong',
    });
    expect(calls).toEqual(['https://api.example.test/reflex']);
    const id = d.ok ? d.value.wake_id : null;
    const [w] = await coreSql('SELECT reason, fire_status, session_id FROM wakes WHERE id = ?', id);
    expect(w).toEqual({ reason: 'watchdog:db.size', fire_status: 200, session_id: 'session_drill' });
    // Tripped already, not built, or one that wakes nobody: refused.
    expect((await drill('db.size')).ok).toBe(false);
    expect((await drill('muse.silent')).ok).toBe(false);
    // Its check passes, but the drill holds until the reflex reports it.
    const now = Date.now();
    await watch(now + 15 * MINUTE);
    expect((await notes('db.size')).filter((n) => n.includes('cleared'))).toEqual([]);
    const report = { outcome: 'nothing', note: 'A drill: read health, nothing to fix.' };
    expect((await api('POST', '/v1/ops/watchdogs/db.size/handled', { token: R, body: report })).status).toBe(200);
    await watch(now + 30 * MINUTE);
    expect(await notes('db.size')).toEqual([
      'watchdog db.size tripped: a drill: tripped by hand, nothing is wrong',
      `handled watchdog db.size (nothing): ${report.note}`,
      CLEAR('db.size'),
    ]);
    // An unreported drill clears after an hour.
    await drill('roll.stuck');
    await watch(now + 45 * MINUTE);
    await watch(now + 75 * MINUTE);
    expect(await notes('roll.stuck')).toEqual([TRIP('roll.stuck'), CLEAR('roll.stuck')]);
  });

  it('the route: the owner and the chat role, never the reflex, Muse or the sandbox; unconnected, nobody is woken', async () => {
    const r = await apiJson<WatchdogDrillResponse>('POST', '/v1/ops/watchdogs/db.size/drill', { token: p.D, body: {} });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ fired: 'not_connected', wake_id: null, item: { state: 'tripped' } });
    expect((await api('POST', '/v1/ops/watchdogs/db.size/drill', { token: p.C, body: {} })).status).toBe(409);
    expect((await api('POST', '/v1/ops/watchdogs/jobs.stuck/drill', { token: R, body: {} })).status).toBe(403);
    expect(
      (
        await api('POST', '/v1/ops/watchdogs/jobs.stuck/drill', {
          token: p.C,
          headers: { 'TH-Sandbox': 'eval' },
          body: {},
        })
      ).status,
    ).toBe(422);
    expect((await api('POST', '/v1/ops/watchdogs/jobs.stuck/drill', { token: p.C, body: {} })).status).toBe(200);
  });
});

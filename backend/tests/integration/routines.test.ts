// Routines (API.md §11.11 "Routines", MIND-PLAN §3.6): a plan and a condition the owner approves
// once. Only ever a card (class routine), whose target the Worker writes from the steps and the
// condition; the yes stores it on, its permit decided then; the tick runs it at its time as one plan
// (one ledger row, one undo) under that permit, and an `after` routine on the first such sense of
// the owner's day; switched off it never runs; a failed run says so once; law 8, a now-only step and
// a Music find keep one from being proposed at all. Everything is synthetic.
import { runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ErrorBody, PlanStep } from '../../../shared/contract/api';
import type { Routine, RoutinesResponse } from '../../../shared/contract/routines.ts';
import { dueLines } from '../../src/areas/mind/brief-gather';
import { uuidv7 } from '../../src/lib/ids';
import { DAY } from '../../src/lib/time';
import type { Core } from '../../src/objects/core';
import { apiJson, core } from '../helpers';
import { sendSenses } from '../music-helpers';
import { claimChat, clearAgentCards, decide, P, raise, setup } from '../proposal-helpers';
import { ledgerRow, settle, undo } from '../verb-helpers';

beforeAll(setup);
afterEach(() => {
  vi.useRealTimers();
});

const stub = () => core() as unknown as DurableObjectStub<Core>;
/** The 15-minute tick on a clock stopped just after `at`. */
async function tickAt(at: number) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at + 1_000);
  await runInDurableObject(stub(), (o: Core) => o.tick(at + 1_000));
  vi.useRealTimers();
}
const step = (verb: string, args: object): PlanStep => ({ verb, schema: 1, args: args as PlanStep['args'] });
const STEPS = [step('settings.set', { key: 'briefing.units', value: 'f' }), step('briefing.pin_tile', { tile: 'due' })];
const args = (over: object = {}) => ({
  id: uuidv7(),
  name: 'Noon briefing',
  why: 'the owner sets the Briefing up most middays',
  what: 'The Briefing is set for the afternoon.',
  steps: STEPS,
  condition: { at: '12:00' },
  ...over,
});
const card = (a: object, over: object = {}) => ({
  class: 'routine',
  question: 'Set the Briefing up every day at noon?',
  why: 'the owner sets the Briefing up most middays',
  if_ignored: 'Nothing is set up.',
  odds: 0.6,
  options: ['Set it up', 'Not now'],
  spec: { v: 1, op: 'routine.propose', args: a },
  ...over,
});
const routines = async () => (await apiJson<RoutinesResponse>('GET', '/v1/routines', { token: P.D })).body.items;
const one = async (id: string) => (await routines()).find((r) => r.id === id) as Routine;
const turn = (id: string, on: boolean, token = P.D) =>
  apiJson<Routine & ErrorBody>('POST', `/v1/routines/${id}/switch`, { token, body: { on } });
const reason = (b: ErrorBody) => (b.error.details as { reason?: string } | undefined)?.reason;

/** A fresh chat session (a tick on a later clock ends the one before). */
let sessions = 0;
const fresh = () => claimChat(`cse_routines_${++sessions}`);

/** A routine card raised and approved by the owner's tap. */
async function approved(a: ReturnType<typeof args>) {
  await fresh();
  await clearAgentCards();
  const c = await raise(card(a));
  expect(c.status, JSON.stringify(c.body)).toBe(201);
  const d = await decide(c.body.id, { decision: 'approve', spec_hash: c.body.spec_hash });
  expect(d.body.status, JSON.stringify(d.body)).toBe('executed');
  return c.body;
}

describe('a routine', () => {
  it('is only ever a card of class routine, its target the condition and steps in words; the yes stores it once', async () => {
    await clearAgentCards();
    const a = args();
    expect((await raise(card(a, { class: 'permit' }))).status).toBe(422);
    const c = await raise(card(a));
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    expect(c.body.target).toBe(
      'Every day at 12:00: settings.set, briefing.pin_tile. Runs on its own until you switch it off.',
    );
    expect(await one(a.id)).toBeUndefined();
    const d = await decide(c.body.id, { decision: 'approve', spec_hash: c.body.spec_hash });
    expect(d.body.status).toBe('executed');
    const r = await one(a.id);
    expect([r.on, r.when, r.steps, r.proposal_id, r.last_run_at]).toEqual([
      true,
      'Every day at 12:00',
      ['settings.set', 'briefing.pin_tile'],
      c.body.id,
      null,
    ]);
    expect(r.next_at).toBeGreaterThan(Date.now());
    // The brief's "Now" names the routines due today in one line.
    const at = r.next_at as number;
    const lines = await runInDurableObject(stub(), (o: Core) =>
      dueLines((o as unknown as { db: Parameters<typeof dueLines>[0] }).db, at - 60_000, 'UTC'),
    );
    expect(lines.filter((l) => l.startsWith('routines today:'))).toEqual([
      'routines today: "Noon briefing" at 12:00 (th routine list)',
    ]);
    expect((await decide(c.body.id, { decision: 'approve', spec_hash: c.body.spec_hash })).status).toBe(409);
  });

  it('runs at its time from the tick under the permit as it stood at the yes, with one undo; off never runs', async () => {
    await settle({ 'mind.permit.tiles': 'ask' });
    const c = await approved(
      args({ condition: { at: '12:00', days: ['mon', 'wed', 'fri', 'sat', 'sun', 'tue', 'thu'] } }),
    );
    const id = (c.spec.args as { id: string }).id;
    await settle({ 'mind.permit.tiles': 'quiet' });
    const before = await one(id);
    expect(before.permit).toBe('ask');
    const at = before.next_at as number;
    await tickAt(at);
    const after = await one(id);
    expect([after.last_run_at, after.last_error, after.next_at]).toEqual([at + 1_000, null, at + DAY]);
    const row = await ledgerRow(after.last_ledger_id);
    expect([row?.kind, row?.what, row?.permit, row?.proposal_id]).toEqual([
      'plan',
      'The Briefing is set for the afternoon.',
      'ask',
      c.id,
    ]);
    // Once ran, the same tick again runs nothing more.
    await tickAt(at + 60_000);
    expect((await one(id)).last_run_at).toBe(at + 1_000);
    expect((await undo(after.last_ledger_id)).status).toBe(200);
    expect((await one(id)).last_undone).toBe(true);
    // Off: the tick passes it by; the mind may not switch it on, nor remove one that is on.
    expect((await turn(id, false)).body.on).toBe(false);
    await tickAt(at + DAY);
    expect((await one(id)).last_run_at).toBe(at + 1_000);
    expect((await turn(id, true, P.C)).status).toBe(403);
    expect((await turn(id, true)).body.on).toBe(true);
    expect(reason((await apiJson<ErrorBody>('DELETE', `/v1/routines/${id}`, { token: P.D })).body)).toBe(
      'switch it off first',
    );
    expect((await turn(id, false, P.C)).body.on).toBe(false);
    expect((await apiJson('DELETE', `/v1/routines/${id}`, { token: P.D })).status).toBe(200);
    expect(await one(id)).toBeUndefined();
  });

  it('after a sense type runs on the first such event of the owner’s day, and only once that day', async () => {
    const c = await approved(args({ name: 'After music', condition: { after: 'music.play' } }));
    const id = (c.spec.args as { id: string }).id;
    expect((await one(id)).when).toBe('After music.play, once a day');
    await sendSenses(P.D, [{ type: 'music.play', id: 'r2_song00000001' }]);
    const first = await one(id);
    expect(first.last_run_at).not.toBeNull();
    expect(first.last_ledger_id).not.toBeNull();
    await sendSenses(P.D, [{ type: 'music.play', id: 'r2_song00000002' }]);
    expect((await one(id)).last_run_at).toBe(first.last_run_at);
    await turn(id, false);
  });

  it('says once in Settings why a run stopped, and runs again at its next time', async () => {
    const mix = uuidv7();
    const c = await approved(args({ name: 'Noon mix', steps: [step('music.play_mix', { mix_id: mix })] }));
    const id = (c.spec.args as { id: string }).id;
    const at = (await one(id)).next_at as number;
    await tickAt(at);
    const r = await one(id);
    expect([r.last_run_at, r.last_ledger_id, r.last_error, r.next_at]).toEqual([
      at + 1_000,
      null,
      'not_found',
      at + DAY,
    ]);
    await turn(id, false);
  });

  it('is refused at the card for law 8, a step that runs only as asked, or a Music find', async () => {
    await fresh();
    await clearAgentCards();
    const refused = async (a: object) => {
      const r = await raise(card(a));
      expect(r.status, JSON.stringify(r.body)).toBe(422);
      return r.body;
    };
    expect(reason(await refused(args({ name: 'Evening prayer' })))).toBe('needs_owner_words');
    expect(reason(await refused(args({ why: 'to help the owner with their health each noon' })))).toBe(
      'needs_owner_words',
    );
    const note = step('memory.note', { text: 'an invented note', kind: 'fact', evidence: [`msg:${uuidv7()}`] });
    expect(JSON.stringify(await refused(args({ steps: [note] })))).toMatch(/runs only/);
    const find = step('music.play_mix', { find: { moods: ['calm'] } });
    expect(JSON.stringify(await refused(args({ steps: [find] })))).toMatch(/never a find/);
    expect(JSON.stringify(await refused(args({ condition: { after: 'no.such_type' } })))).toMatch(/sense type/);
  });
});

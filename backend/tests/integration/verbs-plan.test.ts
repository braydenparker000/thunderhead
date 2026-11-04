// Plans (API.md §11.11, MIND-PLAN §3.4): 2–8 verbs with one why, one undo and one line on home.
// Each step is checked first; the steps run in order in one commit (Worker-side ones done, phone
// ones pending as intents, in order); a step that fails takes the ones before it back with it and
// the answer names it; the plan's one ledger row (kind `plan`) undoes its steps last first. Its
// permit is the strictest of its steps' (an `ask` anywhere: one card for the whole plan); it may
// wait for `fire_at` like a verb; it counts once for the follow-through rule. Everything is synthetic.
import { runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type {
  ErrorBody,
  LedgerEntry,
  OpenThread,
  PlanAnswer,
  PlanStep,
  ScheduledResponse,
  Verb,
} from '../../../shared/contract/api';
import { uuidv7 } from '../../src/lib/ids';
import { HOUR } from '../../src/lib/time';
import type { Core } from '../../src/objects/core';
import { apiJson, core } from '../helpers';
import { chat, decide, P, raise, setup } from '../proposal-helpers';
import { FEED, ledgerRow, refusal, SONG, settings, settle, undo } from '../verb-helpers';

beforeAll(setup);
afterEach(() => {
  vi.useRealTimers();
});

type Out = PlanAnswer & ErrorBody;
const step = (verb: string, args: object): PlanStep => ({ verb, schema: 1, args: args as PlanStep['args'] });
const plan = (steps: PlanStep[], over: object = {}, id = uuidv7()) =>
  apiJson<Out>('POST', '/v1/verbs/plan', {
    ...chat(),
    body: { id, steps, why: 'the owner asked to set up the evening', what: 'Set up your evening.', ...over },
  });
const intents = async (app: string) =>
  (await apiJson<{ items: Verb[] }>('GET', `/v1/verbs/pending?app=${app}`, { token: P.D })).body.items;
const ledger = async (kind: string) =>
  (await apiJson<{ items: LedgerEntry[] }>('GET', `/v1/ledger?limit=100&kind=${kind}`, { token: P.D })).body.items;
const threads = async () =>
  (await apiJson<{ items: OpenThread[] }>('GET', '/v1/memory/open-threads?status=all', { token: P.D })).body.items;

describe('a plan', () => {
  it('runs its steps in order in one commit: Worker-side ones done, intents pending in order', async () => {
    const steps = [
      step('settings.set', { key: 'briefing.units', value: 'f' }),
      step('music.queue', { refs: [SONG(1)], at: 'end' }),
      step('briefing.pin_tile', { tile: 'due' }),
      step('music.rate', { ref: SONG(1), rating: 4 }),
    ];
    const r = await plan(steps);
    expect([r.status, r.body.status, r.body.what], JSON.stringify(r.body)).toEqual([
      201,
      'done',
      'Set up your evening.',
    ]);
    expect(r.body.steps.map((s) => [s.verb, s.status])).toEqual([
      ['settings.set', 'done'],
      ['music.queue', 'pending'],
      ['briefing.pin_tile', 'done'],
      ['music.rate', 'pending'],
    ]);
    // Its permit is the strictest of its steps': settings tell over music and tiles quiet.
    expect(r.body.permit).toEqual({ action: 'plan.run', class: 'settings', position: 'tell' });
    expect((await settings())['briefing.units']).toBe('f');
    expect((await settings())['briefing.pins']).toEqual(['due']);
    const mine = (await intents('music')).filter((v) => v.plan_id === r.body.id);
    expect(mine.map((v) => v.verb)).toEqual(['music.queue', 'music.rate']);
    // One row for the plan, its line on home; each step's own row points at it.
    const row = await ledgerRow(r.body.ledger_id);
    expect(row).toMatchObject({ kind: 'plan', what: 'Set up your evening.', undoable: true, permit: 'tell' });
    const rows = (await ledger('verb')).filter((x) => x.ref === `plan:${r.body.id}`);
    expect(rows.map((x) => x.what).sort()).toEqual([
      'briefing.pin_tile done',
      'music.queue queued',
      'music.rate queued',
      'settings.set done',
    ]);
    // The same id and body again: the plan as it stands; another body under its id, a conflict.
    const again = await plan(steps, {}, r.body.id);
    expect([again.status, again.body.status, again.body.ledger_id]).toEqual([200, 'done', r.body.ledger_id]);
    expect((await plan(steps.slice(0, 2), {}, r.body.id)).status).toBe(409);
  });

  it('checks every step first: one bad step, and nothing runs', async () => {
    const r = await plan([
      step('settings.set', { key: 'briefing.holidays', value: 'GB' }),
      step('music.queue', { refs: ['not a song'], at: 'end' }),
    ]);
    expect([r.status, r.body.error.details]).toEqual([422, [expect.objectContaining({ path: 'steps.1.args.refs.0' })]]);
    expect((await settings())['briefing.holidays']).toBeUndefined();
    expect((await plan([step('app.open', { app: 'music', path: '/music/' }), step('settings.set', {})])).status).toBe(
      422,
    );
    expect((await plan([step('settings.set', { key: 'briefing.units', value: 'c' })])).status).toBe(422);
  });

  it('a step that fails takes the steps before it back with it, and the answer names it', async () => {
    const r = await plan([
      step('settings.set', { key: 'briefing.holidays', value: 'GB' }),
      step('briefing.pin_tile', { tile: 'holidays' }),
      step('settings.set', { key: 'mind.permit.music', value: 'quiet' }),
    ]);
    expect([r.status, r.body.error.code, r.body.error.details]).toEqual([
      403,
      'forbidden',
      expect.objectContaining({ step: 3, verb: 'settings.set' }),
    ]);
    expect((await settings())['briefing.holidays']).toBeUndefined();
    expect((await settings())['briefing.pins']).toEqual(['due']);
    expect((await ledger('plan')).length).toBe(1);
  });

  it('its undo reverses the steps last first, takes back intents no app took, and is once', async () => {
    // Two writes of one setting: only last-first puts each back while it holds what it wrote.
    const r = await plan([
      step('settings.set', { key: 'briefing.due_days', value: 7 }),
      step('podcasts.follow', { feed_url: FEED, title: 'An invented show' }),
      step('settings.set', { key: 'briefing.due_days', value: 1 }),
    ]);
    expect(r.body.status, JSON.stringify(r.body)).toBe('done');
    expect((await settings())['briefing.due_days']).toBe(1);
    const u = await undo(r.body.ledger_id);
    expect([u.status, u.body.status]).toEqual([200, 'undone']);
    expect((await settings())['briefing.due_days']).toBeUndefined();
    expect((await intents('podcasts')).some((v) => v.plan_id === r.body.id)).toBe(false);
    expect(await ledgerRow(r.body.ledger_id)).toMatchObject({ status: 'undone' });
    expect((await undo(r.body.ledger_id)).body.error.code).toBe('already_undone');
  });

  it('counts once for the follow-through rule, keyed by the plan; its steps never on their own', async () => {
    const r = await plan(
      [step('podcasts.mark_played', { key: `${FEED}#ep1` }), step('music.queue', { refs: [SONG(2)], at: 'end' })],
      { what: 'Get the drive ready.' },
    );
    expect(r.body.permit?.position).toBe('quiet');
    const all = await threads();
    expect(all.filter((t) => t.text.startsWith('follow up: did the plan "Get the drive ready." land?'))).toHaveLength(
      1,
    );
    expect(all.some((t) => t.text.startsWith('follow up: did podcasts.mark_played'))).toBe(false);
    const q = (await intents('music')).find((v) => v.plan_id === r.body.id) as Verb;
    await apiJson('POST', `/v1/verbs/${q.id}/claim`, { token: P.D, body: {} });
    await apiJson('POST', `/v1/verbs/${q.id}/result`, {
      token: P.D,
      body: { ok: true, result: { queued: 1, missing: 0 } },
    });
    expect((await threads()).some((t) => t.text.startsWith('follow up: did music.queue'))).toBe(false);
  });
});

describe('an ask anywhere in a plan', () => {
  it('asks once for the whole plan: one card for its steps, used by that plan only', async () => {
    await settle({ 'mind.permit.music': 'ask' });
    const steps = [
      step('settings.set', { key: 'briefing.units', value: 'c' }),
      step('music.queue', { refs: [SONG(3)], at: 'next' }),
    ];
    const id = uuidv7();
    const r = await plan(steps, {}, id);
    const no = refusal(r.body);
    expect([r.status, no.action, no.class, no.card.class, no.card.spec.args.action]).toEqual([
      403,
      'plan.run',
      'music',
      'permit',
      'plan.run',
    ]);
    const card = await raise({
      class: 'permit',
      question: 'Change the units and queue a song?',
      why: 'Music is set to ask first.',
      if_ignored: 'Nothing happens.',
      // An arrangement's card says how sure the mind is (BEHAVIOR.md §4).
      odds: 0.7,
      options: ['Do it', 'Not now'],
      spec: no.card.spec,
    });
    expect(card.body.target).toBe('plan.run, once (a plan: its steps, one undo)');
    await decide(card.body.id, { decision: 'approve', spec_hash: card.body.spec_hash });
    // Other steps are another call.
    const other = await plan([steps[1], steps[0]], { proposal_id: card.body.id });
    expect(refusal(other.body).given).toBe('other_call');
    const ok = await plan(steps, { proposal_id: card.body.id }, id);
    expect([ok.status, ok.body.status, ok.body.permit]).toEqual([
      201,
      'done',
      { action: 'plan.run', class: 'music', position: 'ask' },
    ]);
    expect(await ledgerRow(ok.body.ledger_id)).toMatchObject({ permit: 'ask', proposal_id: card.body.id });
    expect(refusal((await plan(steps, { proposal_id: card.body.id })).body).given).toBe('used');
    await settle({ 'mind.permit.music': 'quiet' });
  });
});

describe('a scheduled plan', () => {
  const stub = () => core() as unknown as DurableObjectStub<Core>;
  async function alarmAt(at: number) {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(at + 1_000);
    await runInDurableObject(stub(), (o: Core) => o.alarm());
    vi.useRealTimers();
  }
  const fire = (at: number) => new Date(at).toISOString();

  it('waits as one scheduled row and runs at its time, its row naming when it was queued', async () => {
    const at = Date.now() + HOUR;
    const r = await plan(
      [step('settings.set', { key: 'briefing.holidays', value: 'FR' }), step('briefing.unpin_tile', { tile: 'due' })],
      { fire_at: fire(at), what: 'Tidy the Briefing.' },
    );
    expect([r.status, r.body.status, r.body.fire_at, r.body.ledger_id, r.body.shifted]).toEqual([
      201,
      'scheduled',
      at,
      null,
      false,
    ]);
    const waiting = (await apiJson<ScheduledResponse>('GET', '/v1/verbs/scheduled', { token: P.D })).body.items;
    expect(waiting.find((v) => v.id === r.body.id)?.verb).toBe('plan.run');
    expect((await settings())['briefing.holidays']).toBeUndefined();
    await alarmAt(at);
    expect((await settings())['briefing.holidays']).toBe('FR');
    const row = (await ledger('plan')).find((x) => x.what === 'Tidy the Briefing.');
    expect(row?.why).toMatch(/\(queued \d{4}-\d\d-\d\d \d\d:\d\d\)$/);
    expect((await undo(row?.id ?? null)).body.status).toBe('undone');
    expect((await settings())['briefing.holidays']).toBeUndefined();
  });

  it('never with a now-only step; one whose step fails when it runs is failed, naming it', async () => {
    const at = Date.now() + HOUR;
    const words = step('memory.note', { text: 'Likes rain', kind: 'preference', evidence: ['msg:x'] });
    expect(
      (await plan([step('settings.set', { key: 'briefing.units', value: 'f' }), words], { fire_at: fire(at) })).status,
    ).toBe(422);
    const r = await plan(
      [
        step('settings.set', { key: 'briefing.holidays', value: 'GB' }),
        step('settings.set', { key: 'no.such', value: 1 }),
      ],
      { fire_at: fire(at), what: 'A plan that cannot work.' },
    );
    expect(r.body.status).toBe('scheduled');
    await alarmAt(at);
    expect((await settings())['briefing.holidays']).toBeUndefined();
    const row = (await ledger('plan')).find((x) => x.what.startsWith('A plan that cannot work.'));
    expect(row).toMatchObject({
      status: 'failed',
      what: 'A plan that cannot work. (failed at step 2 (settings.set): validation)',
    });
    expect(r.body.status).not.toBe('failed');
  });
});

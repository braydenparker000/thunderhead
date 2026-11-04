// Scheduled actions (API.md §11.11, MIND-PLAN §3.5): a verb queued with `fire_at` waits as a
// `scheduled` row (no phone sees it, no ledger row yet) and Core's alarm runs it at that time
// through the same path as at once, under the permit checked when it was queued; its ledger row,
// written then, names when it was queued. Cancelled before, it never runs; at most 20 wait, at most
// 7 days ahead; music and podcasts wait out quiet hours (`shifted`). The time comes on a fixed
// clock (the objects run in this isolate, so they read it too). Everything is synthetic.
import { runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ScheduledResponse, Verb } from '../../../shared/contract/api';
import { DAY, HOUR, MINUTE, zonedMinute } from '../../src/lib/time';
import type { Core } from '../../src/objects/core';
import { apiJson, core } from '../helpers';
import { chat, decide, P, raise, setup } from '../proposal-helpers';
import { ledgerRow, refusal, SONG, settings, settle, undo, verb } from '../verb-helpers';

beforeAll(setup);
afterEach(() => {
  vi.useRealTimers();
});

const iso = (ms: number) => new Date(ms).toISOString();
const stub = () => core() as unknown as DurableObjectStub<Core>;
/** The alarm, on a clock stopped just after `at`. */
async function alarmAt(at: number) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at + 1_000);
  await runInDurableObject(stub(), (o: Core) => o.alarm());
  vi.useRealTimers();
}
/** The 15-minute tick on that clock: it runs what the alarm missed. */
async function tickAt(at: number) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at + 1_000);
  await runInDurableObject(stub(), (o: Core) => o.tick(at + 1_000));
  vi.useRealTimers();
}
const scheduled = async () =>
  (await apiJson<ScheduledResponse>('GET', '/v1/verbs/scheduled', { token: P.D })).body.items;
const one = async (id: string) =>
  (await apiJson<{ items: Verb[] }>('GET', '/v1/verbs/pending?app=music', { token: P.D })).body.items.find(
    (v) => v.id === id,
  );
const cancel = (id: string, call: { token: string; headers?: Record<string, string> } = { token: P.D }) =>
  apiJson<Verb & { error: { code: string } }>('POST', `/v1/verbs/${id}/cancel`, { ...call, body: {} });

describe('a scheduled Worker-side verb', () => {
  it('waits with no ledger row, is listed, and runs at its time; its row names when it was queued', async () => {
    const at = Date.now() + HOUR;
    const r = await verb('settings.set', { key: 'briefing.units', value: 'f' }, { fire_at: iso(at) });
    expect([r.status, r.body.status, r.body.fire_at, r.body.ledger_id, r.body.shifted]).toEqual([
      201,
      'scheduled',
      at,
      null,
      false,
    ]);
    expect(r.body.permit).toEqual({ action: 'settings.set', class: 'settings', position: 'tell' });
    expect((await scheduled()).map((v) => v.id)).toContain(r.body.id);
    expect((await settings())['briefing.units']).toBeUndefined();
    // The alarm follows the soonest scheduled time.
    const alarm = await runInDurableObject(stub(), (_o: Core, s) => s.storage.getAlarm());
    expect(alarm).toBeLessThanOrEqual(at);
    await alarmAt(at);
    expect((await settings())['briefing.units']).toBe('f');
    expect((await scheduled()).some((v) => v.id === r.body.id)).toBe(false);
    const [row] = (
      await apiJson<{ items: { id: string; verb_id?: string }[] }>('GET', '/v1/ledger?limit=20&kind=verb', {
        token: P.D,
      })
    ).body.items;
    const full = await ledgerRow(row.id);
    expect(full).toMatchObject({ kind: 'verb', what: 'settings.set done', undoable: true, permit: 'tell' });
    expect(full?.why).toMatch(/^the owner asked for it just now \(queued \d{4}-\d\d-\d\d \d\d:\d\d\)$/);
    // After it ran, the verb's own undo applies.
    expect((await undo(row.id)).body.status).toBe('undone');
    expect((await settings())['briefing.units']).toBeUndefined();
  });

  it('an owner-local time is read in the owner zone; a retry answers the same', async () => {
    await settle({ 'owner.tz': 'Asia/Tokyo' });
    const day = new Date(Date.now() + 2 * DAY).toISOString().slice(0, 10);
    const body = { fire_at: `${day}T18:00`, why: 'at six, as the owner asked' };
    const id = '0192f0c4-0000-7000-8000-00000000a001';
    const put = (b: object) =>
      apiJson<Verb & { shifted?: boolean }>('PUT', `/v1/verbs/${id}`, {
        ...chat(),
        body: { verb: 'settings.set', schema: 1, args: { key: 'briefing.due_days', value: 3 }, ...b },
      });
    const r = await put(body);
    expect([r.status, r.body.fire_at]).toEqual([201, zonedMinute(day, 18 * 60, 'Asia/Tokyo')]);
    expect(r.body.fire_at).toBe(Date.parse(`${day}T09:00:00Z`));
    const again = await put(body);
    expect([again.status, again.body.status, again.body.shifted]).toEqual([200, 'scheduled', false]);
    expect((await cancel(id)).body.status).toBe('cancelled');
    await settle({ 'owner.tz': 'UTC' });
  });
});

describe('a scheduled phone intent', () => {
  it('is no app’s until its time, then pending from that moment (the tick, when no alarm came)', async () => {
    const at = Date.now() + 2 * HOUR;
    const r = await verb('music.queue', { refs: [SONG(1)], at: 'end' }, { fire_at: iso(at) });
    expect(r.body.status).toBe('scheduled');
    expect(await one(r.body.id)).toBeUndefined();
    await tickAt(at);
    const v = await one(r.body.id);
    expect(v?.status).toBe('pending');
    expect(v?.expires_at).toBe(at + 24 * HOUR);
    expect(await ledgerRow(v?.ledger_id ?? null)).toMatchObject({ what: 'music.queue queued', undoable: false });
  });
});

describe('cancel', () => {
  it('takes one back before it runs (its undo until then); it never runs; once it ran, 409', async () => {
    const at = Date.now() + HOUR;
    const r = await verb('settings.set', { key: 'briefing.holidays', value: 'GB' }, { fire_at: iso(at) });
    const c = await cancel(r.body.id);
    expect([c.status, c.body.status]).toEqual([200, 'cancelled']);
    expect((await cancel(r.body.id)).body.status).toBe('cancelled');
    await alarmAt(at);
    expect((await settings())['briefing.holidays']).toBeUndefined();
    // The mind cancels its own, through the same route.
    const mine = await verb('settings.set', { key: 'briefing.holidays', value: 'FR' }, { fire_at: iso(at) });
    expect((await cancel(mine.body.id, chat())).body.status).toBe('cancelled');
    const now = await verb('settings.set', { key: 'briefing.holidays', value: 'DE' });
    expect([(await cancel(now.body.id)).status]).toEqual([409]);
    expect((await cancel('0192f0c4-0000-7000-8000-00000000ffff')).status).toBe(404);
  });
});

describe('the limits', () => {
  it('within the next 7 days, not in the past, never a now-only verb', async () => {
    const units = { key: 'briefing.units', value: 'f' };
    expect((await verb('settings.set', units, { fire_at: iso(Date.now() + 8 * DAY) })).status).toBe(422);
    expect((await verb('settings.set', units, { fire_at: iso(Date.now() - 10 * MINUTE) })).status).toBe(422);
    expect((await verb('settings.set', units, { fire_at: 'tomorrow at six' })).status).toBe(422);
    expect((await verb('settings.set', units, { fire_at: '2026-02-30T10:00' })).status).toBe(422);
    const move = await verb(
      'reminder.move',
      { id: '0192f0c4-0000-7000-8000-00000000a002', at: Date.now() + DAY },
      { fire_at: iso(Date.now() + HOUR) },
    );
    expect([move.status, JSON.stringify(move.body.error.details)]).toEqual([
      422,
      expect.stringContaining('runs only as it is asked'),
    ]);
  });

  it('at most 20 wait at once: the 21st is 429 too_many_scheduled', async () => {
    const ids: string[] = [];
    const waiting = (await scheduled()).length;
    for (let i = waiting; i < 20; i++) {
      const r = await verb('settings.set', { key: 'briefing.due_days', value: 1 }, { fire_at: iso(Date.now() + DAY) });
      expect(r.status).toBe(201);
      ids.push(r.body.id);
    }
    const over = await verb('settings.set', { key: 'briefing.due_days', value: 1 }, { fire_at: iso(Date.now() + DAY) });
    expect([over.status, over.body.error.code]).toEqual([429, 'too_many_scheduled']);
    // A verb at once is not counted.
    expect((await verb('settings.set', { key: 'briefing.due_days', value: 7 })).body.status).toBe('done');
    for (const id of ids) await cancel(id);
  });
});

describe('quiet hours', () => {
  const day = (n: number) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);
  const off = { 'quiet.start': '06:30', 'quiet.end': '06:30' };

  it('music waits for their end and says shifted; a setting does not', async () => {
    await settle({ 'owner.tz': 'UTC', 'quiet.start': '22:00', 'quiet.end': '06:30' });
    const at = Date.parse(`${day(1)}T23:00:00Z`);
    const music = await verb('music.queue', { refs: [SONG(2)], at: 'end' }, { fire_at: iso(at) });
    expect([music.body.shifted, music.body.fire_at]).toEqual([true, Date.parse(`${day(2)}T06:30:00Z`)]);
    const plain = await verb('settings.set', { key: 'briefing.units', value: 'f' }, { fire_at: iso(at) });
    expect([plain.body.shifted, plain.body.fire_at]).toEqual([false, at]);
    await cancel(music.body.id);
    await cancel(plain.body.id);
    await settle(off);
  });

  it('one that comes due inside quiet hours set since then moves to their end', async () => {
    const at = Date.parse(`${day(1)}T12:00:00Z`);
    const r = await verb('music.queue', { refs: [SONG(3)], at: 'end' }, { fire_at: iso(at) });
    expect(r.body.shifted).toBe(false);
    await settle({ 'quiet.start': '11:50', 'quiet.end': '14:00' });
    await alarmAt(at);
    expect((await scheduled()).find((v) => v.id === r.body.id)?.fire_at).toBe(Date.parse(`${day(1)}T14:00:00Z`));
    await settle(off);
    await alarmAt(Date.parse(`${day(1)}T14:00:00Z`));
    expect((await one(r.body.id))?.status).toBe('pending');
  });
});

describe('the permit, checked when it is queued', () => {
  it('under ask: refused with the card for that call and time; approved, it is scheduled once', async () => {
    await settle({ 'mind.permit.settings': 'ask' });
    const at = Date.now() + HOUR;
    const call = { fire_at: iso(at), why: 'the owner asked for it at this time' };
    const before = (await scheduled()).length;
    const r = await verb('settings.set', { key: 'briefing.units', value: 'f' }, call);
    expect([r.status, refusal(r.body).action]).toEqual([403, 'settings.set']);
    expect(await scheduled()).toHaveLength(before);
    const card = await raise({
      class: 'permit',
      question: 'Change the units at that time?',
      why: 'Your standing permission says to ask first.',
      if_ignored: 'Nothing happens.',
      options: ['Do it', 'Not now'],
      spec: refusal(r.body).card.spec,
    });
    await decide(card.body.id, { decision: 'approve', spec_hash: card.body.spec_hash });
    // Another time is another call: the card does not cover it.
    const other = await verb(
      'settings.set',
      { key: 'briefing.units', value: 'f' },
      { ...call, fire_at: iso(at + MINUTE), proposal_id: card.body.id },
    );
    expect(refusal(other.body).given).toBe('other_call');
    const ok = await verb(
      'settings.set',
      { key: 'briefing.units', value: 'f' },
      { ...call, proposal_id: card.body.id },
    );
    expect([ok.status, ok.body.status, ok.body.permit?.position]).toEqual([201, 'scheduled', 'ask']);
    // The owner moves the class back to tell; it runs under the permit it was queued with.
    await settle({ 'mind.permit.settings': 'tell' });
    await alarmAt(at);
    expect((await settings())['briefing.units']).toBe('f');
    const v = (
      await apiJson<{ items: { id: string; permit: string; proposal_id: string | null; what: string }[] }>(
        'GET',
        '/v1/ledger?limit=5&kind=verb',
        { token: P.D },
      )
    ).body.items[0];
    expect([v.what, v.permit, v.proposal_id]).toEqual(['settings.set done', 'ask', card.body.id]);
    await undo(v.id);
  });
});

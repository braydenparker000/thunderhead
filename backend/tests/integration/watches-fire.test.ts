// A watch fires once (RUNTIME.md §3): an `at` watch by the tick, an event watch from the phone's
// senses batch (or the Worker's own `reminder.fired`), a change watch once its thing settles (a
// phone verb's result); each through the chat's API trigger with `{"text":"wake"}`, the wake
// recording its reason (`reason: 'watch'`, `reason_json` {watch, kind, note}), and the session
// that claims it reading why in its briefing's section 1. A watch met while a chat session is live
// is that session's `th wait` event instead of a new wake.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { BriefResponse, LiveWaitResponse, Verb } from '../../../shared/contract/api';
import type { ReminderResponse } from '../../../shared/contract/reminders.ts';
import { uuidv7 } from '../../src/lib/ids';
import { HOUR, MINUTE } from '../../src/lib/time';
import { apiJson, coreSql } from '../helpers';
import { as, brief, CHAT_SESSION, type Principals, principals } from '../memory-helpers';
import { fires, plainTick, pulse, setWatch, sleep, tick, WHY } from '../watch-helpers';

let p: Principals;
/** The chat session that holds the lease now: each claim below takes the one the last fire named. */
let session = CHAT_SESSION;
const chat = () => as(p.C, session);
const watchRow = async (id: string) =>
  (await coreSql<Record<string, unknown>>('SELECT * FROM watches WHERE id = ?', id))[0];
const wakeRow = async (id: string) =>
  (await coreSql<Record<string, unknown>>('SELECT * FROM wakes WHERE id = ?', id))[0];
const due = (id: string) => coreSql('UPDATE watches SET fire_at = ? WHERE id = ?', Date.now() - 1_000, id);
/** Claims the wake the fake trigger's last fire named (`session_watch<n>` ↔ `cse_watch<n>`). */
async function claim(): Promise<BriefResponse> {
  session = `cse_watch${fires.length}`;
  const r = await brief(p.C, session, 'chat');
  expect(r.status).toBe(200);
  return r.body as BriefResponse;
}

beforeAll(async () => {
  p = await principals();
  await apiJson('PATCH', '/v1/settings', { token: p.D, body: { 'quiet.start': '06:30', 'quiet.end': '06:30' } });
  // The helpers' night session ends: while a night runs, met watches wait (watches-budget.test.ts).
  await coreSql("UPDATE mind_sessions SET ended_at = ? WHERE role = 'night'", Date.now());
});

describe('an at watch', () => {
  it('fires once, by the tick, through the API trigger; its wake keeps the reason; the claim reads it', async () => {
    const set = await setWatch(chat(), { kind: 'at', at: Date.now() + HOUR, note: 'the drive at six' });
    const id = set.body.id;
    expect(set.status, JSON.stringify(set.body)).toBe(201);
    await sleep(chat());
    await due(id);
    const first = await tick();
    expect(first.watch).not.toBeNull();
    expect(fires).toEqual([{ url: 'https://api.example.test/chat', body: '{"text":"wake"}' }]);
    const wake = await wakeRow(first.watch as string);
    expect(wake).toMatchObject({ task: 'chat', reason: 'watch', status: 'fired', fire_status: 200 });
    expect(JSON.parse(wake.reason_json as string)).toEqual({ watch: id, kind: 'at', note: 'the drive at six' });
    expect(await watchRow(id)).toMatchObject({ state: 'fired', by: 'wake', wake_id: first.watch });
    // Once: the next tick fires nothing.
    expect((await tick()).watch).toBeNull();
    expect(fires.length).toBe(1);
    const b = await claim();
    expect(b.wake).toEqual({ id: first.watch, reason: 'watch', claim_match: 'exact' });
    expect(b.core).toMatch(/wakes today: 1 of 12, \d+ watches live/);
    expect(b.core).toMatch(new RegExp(`watch ${id} fired \\(at \\d\\d:\\d\\d\\): ${WHY} · note: the drive at six`));
    expect(b.core).toContain('speak only by the voice ladder');
    expect(await watchRow(id)).toMatchObject({ to_session: session });
  });
});

describe('an event watch', () => {
  it('is met by the phone’s batch, fires once; an event older than the watch meets nothing', async () => {
    const set = await setWatch(chat(), { kind: 'event', type: 'guitar.session', ref: 'tab:example-piece' });
    const old = await setWatch(chat(), { kind: 'event', type: 'media.finish' });
    await sleep(chat());
    const batch = (events: unknown[]) =>
      apiJson('PUT', `/v1/senses/batches/${uuidv7()}`, { token: p.D, body: { events } });
    const ev = (type: string, over: object = {}) => ({ id: uuidv7(), at: Date.now(), type, ...over });
    expect(
      (
        await batch([
          ev('guitar.session', { ref: 'tab:other-piece', data: { seconds: 60 } }),
          ev('media.finish', { ref: 'media:example-file', at: Date.now() - 2 * HOUR }),
        ])
      ).status,
    ).toBe(200);
    expect(await watchRow(set.body.id)).toMatchObject({ state: 'live' });
    expect(await watchRow(old.body.id)).toMatchObject({ state: 'live' });
    expect((await batch([ev('guitar.session', { ref: 'tab:example-piece', data: { seconds: 600 } })])).status).toBe(
      200,
    );
    expect(await watchRow(set.body.id)).toMatchObject({ state: 'queued', met_ref: 'tab:example-piece' });
    const t = await pulse();
    expect(JSON.parse((await wakeRow(t as string)).reason_json as string)).toEqual({
      watch: set.body.id,
      kind: 'event',
      note: null,
    });
    expect(fires.length).toBe(2);
    await batch([ev('guitar.session', { ref: 'tab:example-piece' })]);
    expect(await pulse()).toBeNull();
    const b = await claim();
    expect(b.core).toContain(`watch ${set.body.id} fired (event guitar.session tab:example-piece): ${WHY}`);
    await apiJson('PUT', `/v1/verbs/${uuidv7()}`, {
      ...chat(),
      body: { verb: 'watch.cancel', schema: 1, args: { id: old.body.id }, why: 'tidy up the test' },
    });
  });

  it('a reminder ringing meets a reminder.fired watch, in the same tick', async () => {
    const at = Date.now() + 10 * MINUTE;
    const r = await apiJson<ReminderResponse>('PUT', `/v1/reminders/${uuidv7()}`, {
      token: p.D,
      body: { text: 'Stretch', at },
    });
    const set = await setWatch(chat(), {
      kind: 'event',
      type: 'reminder.fired',
      ref: `reminder:${r.body.reminder.id}`,
    });
    await sleep(chat());
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(r.body.reminder.fire_at + 1_000);
    try {
      // The tick delivers the reminder, which meets the watch; the pass then fires it.
      await plainTick();
      expect(await watchRow(set.body.id)).toMatchObject({ state: 'queued' });
      expect(await pulse()).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
    expect(await watchRow(set.body.id)).toMatchObject({ state: 'fired', met_ref: `reminder:${r.body.reminder.id}` });
    await claim();
  });
});

describe('a change watch', () => {
  it('is met when a phone verb’s result comes back, not by a watch verb of its own', async () => {
    const v = await apiJson<Verb>('PUT', `/v1/verbs/${uuidv7()}`, {
      ...chat(),
      body: { verb: 'shell.appearance', schema: 1, args: { mode: 'night' }, why: 'the owner asked for night' },
    });
    expect(v.body.status).toBe('pending');
    const set = await setWatch(chat(), { kind: 'change', type: 'verb', ref: `verb:${v.body.id}` });
    const any = await setWatch(chat(), { kind: 'change', type: 'verb' });
    // Another watch.set is a verb that is done at once: it meets no verb watch.
    const third = await setWatch(chat(), { kind: 'at', at: Date.now() + HOUR });
    expect(await watchRow(any.body.id)).toMatchObject({ state: 'live' });
    for (const id of [any.body.id, third.body.id])
      await apiJson('PUT', `/v1/verbs/${uuidv7()}`, {
        ...chat(),
        body: { verb: 'watch.cancel', schema: 1, args: { id }, why: 'tidy up the test' },
      });
    await sleep(chat());
    expect((await apiJson('POST', `/v1/verbs/${v.body.id}/claim`, { token: p.D, body: {} })).status).toBe(200);
    expect(await watchRow(set.body.id)).toMatchObject({ state: 'live' });
    const done = await apiJson('POST', `/v1/verbs/${v.body.id}/result`, {
      token: p.D,
      body: { ok: true, result: { previous: 'auto' } },
    });
    expect(done.status).toBe(200);
    expect(await watchRow(set.body.id)).toMatchObject({ state: 'queued', met_ref: `verb:${v.body.id}` });
    const t = await pulse();
    expect(JSON.parse((await wakeRow(t as string)).reason_json as string)).toMatchObject({ kind: 'change' });
    const b = await claim();
    expect(b.core).toContain(`watch ${set.body.id} fired (change verb verb:${v.body.id})`);
  });
});

describe('a live session', () => {
  it('hears a watch met while it holds the lease as a th wait event; no new wake fires', async () => {
    const wait = (after: number) => apiJson<LiveWaitResponse>('GET', `/v1/live/wait?after=${after}&timeout=1`, chat());
    const start = (await wait(0)).body.seq;
    const set = await setWatch(chat(), { kind: 'at', at: Date.now() + HOUR, note: 'look at the queue' });
    await due(set.body.id);
    const before = fires.length;
    expect((await tick()).watch).toBeNull();
    expect(fires.length).toBe(before);
    expect(await watchRow(set.body.id)).toMatchObject({ state: 'fired', by: 'event', to_session: session });
    const got = (await wait(start)).body;
    expect(got.events).toContainEqual({
      type: 'watch.fired',
      ref: `watch:${set.body.id}`,
      at: expect.any(Number),
      kind: 'at',
      why: WHY,
      note: 'look at the queue',
    });
    // Another session hears nothing of it.
    const other = await apiJson<LiveWaitResponse>('GET', `/v1/live/wait?after=${start}&timeout=1`, as(p.C, 'cse_x'));
    expect(other.body.events.filter((e) => e.type === 'watch.fired')).toEqual([]);
  });
});

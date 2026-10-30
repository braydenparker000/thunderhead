// A reminder's delivery (BEHAVIOR.md §3.4 "Owner-set reminders", PRIVACY.md §8, SECURITY.md §10):
// Core's alarm wakes for the soonest one and delivers it once, as a system line in today's thread
// that the phone's live feed hears about, then a push of kind `reminder` (payload a kind and an id,
// words "Your reminder.") to every subscribed phone: outside the 2 a day and the 2 h gap, with no
// natural pause, through "go quiet", never inside quiet hours. A cancelled one never goes; the
// 15-minute tick delivers one the alarm missed, never twice; a push the outbox missed is offered
// again for an hour. The test is the push service and the phone; a reminder's time comes on a fixed
// clock (the objects run in this isolate, so they read it too).
import { runInDurableObject } from 'cloudflare:test';
import { env, exports } from 'cloudflare:workers';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ChangesResponse, LiveFrame, LiveTicket, TodayResponse } from '../../../shared/contract/api';
import type { ReminderResponse } from '../../../shared/contract/reminders.ts';
import { useFetch } from '../../src/areas/push/outbox';
import { deliver } from '../../src/areas/push/routes';
import { uuidv7 } from '../../src/lib/ids';
import { HOUR, MINUTE, wallMinute } from '../../src/lib/time';
import type { Core } from '../../src/objects/core';
import { api, apiJson, authSql, core, coreSql, makeAgent, setupOwner } from '../helpers';
import { type Phone, phone, received } from '../push-helpers';

let D = '';
let C = '';
let mine: Phone;
let got: Uint8Array[] = [];
const stub = () => core() as unknown as DurableObjectStub<Core>;
const alarm = () => runInDurableObject(stub(), (o: Core) => o.alarm());
const tick = () => runInDurableObject(stub(), (o: Core) => o.tick(Date.now()));
const settings = (body: object) => api('PATCH', '/v1/settings', { token: D, body });
const QUIET_OFF = { 'quiet.start': '06:30', 'quiet.end': '06:30' };

const set = async (text: string, at = Date.now() + 10 * MINUTE) =>
  (await apiJson<ReminderResponse>('PUT', `/v1/reminders/${uuidv7()}`, { token: D, body: { text, at } })).body.reminder;
/** Runs `fn` on a clock stopped just after the reminder's time. */
async function later<T>(r: { fire_at: number }, fn: () => Promise<T>): Promise<T> {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(r.fire_at + 1_000);
  try {
    return await fn();
  } finally {
    vi.useRealTimers();
  }
}
const both = async () => {
  await alarm();
  await tick();
};
const row = async (id: string) =>
  (await coreSql<Record<string, unknown>>('SELECT * FROM reminders WHERE id = ?', id))[0];
const lines = (id: string) =>
  coreSql<{ id: string; author: string; origin: string; kind: string; body: string; meta_json: string }>(
    "SELECT id, author, origin, kind, body, meta_json FROM messages WHERE json_extract(meta_json, '$.reminder.id') = ?",
    id,
  );
const pushed = async () =>
  Promise.all(got.map(async (b) => JSON.parse(await received(mine, b)) as { k: string; id: string }));
const pushesOf = async (id: string) => (await pushed()).filter((p) => p.id === id).length;

async function live() {
  const { body } = await apiJson<LiveTicket>('POST', '/v1/live/ticket', { token: D });
  const res = await exports.default.fetch(
    new Request(`https://api.example.test/v1/live?ticket=${body.ticket}`, { headers: { Upgrade: 'websocket' } }),
  );
  const ws = res.webSocket as WebSocket;
  ws.accept();
  const frames: LiveFrame[] = [];
  ws.addEventListener('message', (e) => {
    frames.push(JSON.parse(String(e.data)));
  });
  const closed = new Promise((r) => ws.addEventListener('close', r));
  return {
    frames,
    close: async () => {
      ws.close(1000);
      await closed;
    },
  };
}
const until = async (check: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
};

beforeAll(async () => {
  useFetch(async (_input, init) => {
    got.push(new Uint8Array(await new Response(init?.body).arrayBuffer()));
    return new Response(null, { status: 201 });
  });
  D = (await setupOwner()).token;
  C = await makeAgent(D, 'mind:chat');
  mine = await phone();
  await settings({ 'owner.tz': 'UTC', ...QUIET_OFF });
  const endpoint = 'https://fcm.googleapis.com/fcm/send/test-phone-reminders';
  expect((await api('PUT', '/v1/push/subscription', { token: D, body: { endpoint, keys: mine.keys } })).status).toBe(
    204,
  );
  await deliver(env); // the agent key's sign-in notice
  got = [];
});
afterAll(() => useFetch((...a) => fetch(...a)));

describe('the alarm', () => {
  it('wakes for the soonest set reminder, and moves when it is taken back', async () => {
    const later = await set('Later', Date.now() + 20 * MINUTE);
    const sooner = await set('Sooner', Date.now() + 10 * MINUTE);
    const alarmAt = () => runInDurableObject(stub(), (_o: Core, s) => s.storage.getAlarm());
    expect(await alarmAt()).toBe(sooner.fire_at);
    await api('DELETE', `/v1/reminders/${sooner.id}`, { token: D });
    expect(await alarmAt()).toBe(later.fire_at);
    await api('DELETE', `/v1/reminders/${later.id}`, { token: D });
  });

  it('delivers it once at its time: the line with its meta, the live feed, one push with generic words', async () => {
    const r = await set('Call the garage about the tyres');
    await alarm();
    expect(await lines(r.id)).toEqual([]);
    const before = (await apiJson<TodayResponse>('GET', '/v1/threads/today', { token: D })).body.seq;
    const phoneOpen = await live();
    await until(() => phoneOpen.frames.length > 0);
    await later(r, alarm);

    const [line, ...more] = await lines(r.id);
    expect(more).toEqual([]);
    expect(line).toMatchObject({ author: 'system', origin: 'system', kind: 'text', body: r.text });
    expect(JSON.parse(line.meta_json)).toEqual({ reminder: { id: r.id, at: r.at } });
    const stored = await row(r.id);
    expect(stored).toMatchObject({ state: 'done', message_id: line.id });
    expect(stored.push_until).toBe(Number(stored.fired_at) + HOUR);
    const today = await apiJson<TodayResponse>('GET', '/v1/threads/today', { token: D });
    expect(today.body.messages.some((m) => m.id === line.id)).toBe(true);
    const feed = await apiJson<ChangesResponse>('GET', `/v1/changes?after=${before}`, { token: D });
    expect(feed.body.items).toContainEqual(expect.objectContaining({ kind: 'message', ref: `msg:${line.id}` }));
    await until(() => phoneOpen.frames.some((f) => f.t === 'changed'));
    expect(phoneOpen.frames.find((f) => f.t === 'changed')).toMatchObject({
      kinds: expect.arrayContaining(['message']),
    });
    await phoneOpen.close();

    expect(await pushed()).toEqual([{ k: 'reminder', id: r.id }]);
    const words = await apiJson('GET', `/v1/push/items/${r.id}`, { token: D });
    expect(words.body).toEqual({ title: 'Thunderhead', body: 'Your reminder.', url: '/' });
    expect(await authSql('SELECT kind, created_at, deadline FROM pushes WHERE id = ?', r.id)).toEqual([
      { kind: 'reminder', created_at: stored.fired_at, deadline: stored.push_until },
    ]);
    const listed = await apiJson<{ items: { id: string; state: string; message_id: string }[] }>(
      'GET',
      '/v1/reminders',
      {
        token: D,
      },
    );
    expect(listed.body.items.find((i) => i.id === r.id)).toMatchObject({ state: 'done', message_id: line.id });

    await later(r, both);
    await deliver(env);
    expect((await lines(r.id)).length).toBe(1);
    expect(await pushesOf(r.id)).toBe(1);
  });

  it('a reminder taken back never goes', async () => {
    const r = await set('Taken back');
    await api('DELETE', `/v1/reminders/${r.id}`, { token: D });
    await later(r, both);
    expect(await lines(r.id)).toEqual([]);
    expect((await row(r.id)).state).toBe('cancelled');
    expect(await pushesOf(r.id)).toBe(0);
  });
});

describe('its push', () => {
  const nudge = (topic: string) => ({
    title: 'Leave by 16:40',
    body: 'The bus is 10 minutes early today.',
    why: 'time-bound: the bus leaves early',
    topic_key: topic,
  });
  const putNudge = (id: string, topic: string) =>
    apiJson<{ error?: { code: string } }>('PUT', `/v1/pushes/${id}`, { token: C, body: nudge(topic) });

  it('is outside the 2 a day and the 2 h gap, waits for no pause and goes through "go quiet"', async () => {
    // A reminder pushed just now (above) is no nudge: the mind's next one is taken.
    expect((await putNudge('nudge-rem-1', 'trip.leave')).status).toBe(202);
    await deliver(env);
    expect(await pushesOf('nudge-rem-1')).toBe(1);
    expect((await putNudge('nudge-rem-2', 'trip.other')).body.error?.code).toBe('push_gap');
    const now = Date.now();
    await authSql(
      `INSERT INTO pushes (id, kind, title, body, url, created_at, deadline, sent_at)
       VALUES ('nudge-rem-0', 'nudge', 't', 'b', '/', ?, ?, ?)`,
      now,
      now + HOUR,
      now,
    );
    expect((await putNudge('nudge-rem-3', 'trip.third')).body.error?.code).toBe('push_budget');

    await settings({ 'quiet.until': now + HOUR });
    const looking = await live();
    const r = await set('Take the bread out');
    await later(r, alarm);
    expect(await pushesOf(r.id)).toBe(1);
    await looking.close();
    await settings({ 'quiet.until': 0 });
    expect((await putNudge('nudge-rem-4', 'trip.fourth')).body.error?.code).toBe('push_budget');
  });

  it('is not sent inside quiet hours: the line still comes', async () => {
    const r = await set('Late alarm');
    const m = wallMinute(r.fire_at, 'UTC');
    const hhmm = (x: number) =>
      `${String(Math.floor(x / 60) % 24).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
    // A window from an hour ago to an hour on, or to 06:30 when that comes later or the hour crosses midnight.
    const end = m + 60 < 1440 ? Math.max(m + 60, 390) : 390;
    expect((await settings({ 'quiet.start': hhmm((m + 1440 - 60) % 1440), 'quiet.end': hhmm(end) })).status).toBe(200);
    await later(r, alarm);
    expect((await lines(r.id)).length).toBe(1);
    expect((await row(r.id)).push_until).toBeNull();
    await deliver(env);
    expect(await pushesOf(r.id)).toBe(0);
    expect(await authSql('SELECT id FROM pushes WHERE id = ?', r.id)).toEqual([]);
    await settings(QUIET_OFF);
  });

  it('the 15-minute tick delivers one the alarm missed, once', async () => {
    const r = await set('Missed by the alarm');
    await later(r, tick);
    expect((await lines(r.id)).length).toBe(1);
    await later(r, both);
    await deliver(env);
    expect((await lines(r.id)).length).toBe(1);
    expect(await pushesOf(r.id)).toBe(1);
  });

  it('a push the outbox never got is offered again by the next delivery run, for an hour', async () => {
    const now = Date.now();
    const insert = (id: string, firedAt: number) =>
      coreSql(
        `INSERT INTO reminders (id, text, at, fire_at, state, origin, created_at, fired_at, message_id, push_until, req_sha256)
         VALUES (?, 'Handed off', ?, ?, 'done', 'owner_device', ?, ?, ?, ?, 'x')`,
        id,
        firedAt,
        firedAt,
        firedAt - HOUR,
        firedAt,
        uuidv7(),
        firedAt + HOUR,
      );
    const lost = uuidv7();
    const stale = uuidv7();
    await insert(lost, now - 10 * MINUTE);
    await insert(stale, now - 2 * HOUR);
    const ctx = await runInDurableObject(stub(), (o: Core) => o.pushContext());
    const offered = ctx.reminders?.map((x) => x.id) ?? [];
    expect(offered).toContain(lost);
    expect(offered).not.toContain(stale);
    await deliver(env);
    await deliver(env);
    expect(await pushesOf(lost)).toBe(1);
    expect(await pushesOf(stale)).toBe(0);
  });
});

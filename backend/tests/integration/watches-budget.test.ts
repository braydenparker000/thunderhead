// The wake budget (RUNTIME.md §11, `mind.wake_budget`): watch wakes in the owner's logical day; a
// watch met past it is refused (`over_budget`) and the briefing counts it; the owner's own wakes
// never count; at Off a met watch is refused too. Quiet hours change nothing (the wake's reason
// marks them); while the night shift runs a met watch waits, and goes once the night ends; one
// met while a wake is already on its way waits for that wake's claim, which takes it.
import { beforeAll, describe, expect, it } from 'vitest';
import type { BriefResponse } from '../../../shared/contract/api';
import { dayStart } from '../../src/areas/mind/watches/pulse';
import { uuidv7 } from '../../src/lib/ids';
import { HOUR } from '../../src/lib/time';
import { apiJson, coreSql } from '../helpers';
import { as, brief, CHAT_SESSION, type Principals, principals } from '../memory-helpers';
import { fires, pulse, setWatch, sleep } from '../watch-helpers';

let p: Principals;
let session = CHAT_SESSION;
const chat = () => as(p.C, session);
const settings = (body: object) => apiJson('PATCH', '/v1/settings', { token: p.D, body });
const state = async (id: string) => (await coreSql<{ state: string }>('SELECT state FROM watches WHERE id = ?', id))[0];
const wakeRow = async (id: string) =>
  (await coreSql<Record<string, unknown>>('SELECT * FROM wakes WHERE id = ?', id))[0];
/** A watch due now, set by the session that holds the lease, which then sleeps. */
async function dueWatch(note?: string): Promise<string> {
  const r = await setWatch(chat(), { kind: 'at', at: Date.now() + HOUR, ...(note ? { note } : {}) });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  await sleep(chat());
  await coreSql('UPDATE watches SET fire_at = ? WHERE id = ?', Date.now() - 1_000, r.body.id);
  return r.body.id;
}
/** Chat wakes as the Worker records them (`reason`), a minute ago (never before today began). */
const wakes = (reason: string, n: number, at = Math.max(Date.now() - 60_000, dayStart(Date.now(), 'UTC') + 1)) =>
  Promise.all(
    Array.from({ length: n }, () =>
      coreSql(
        "INSERT INTO wakes (id, at, task, reason, status) VALUES (?, ?, 'chat', ?, 'ended')",
        uuidv7(),
        at,
        reason,
      ),
    ),
  );
async function claim(id = `cse_watch${fires.length}`): Promise<BriefResponse> {
  session = id;
  const r = await brief(p.C, session, 'chat');
  expect(r.status).toBe(200);
  return r.body as BriefResponse;
}

beforeAll(async () => {
  p = await principals();
  await settings({ 'quiet.start': '06:30', 'quiet.end': '06:30' });
  await coreSql("UPDATE mind_sessions SET ended_at = ? WHERE role = 'night'", Date.now());
});

describe('the wake budget', () => {
  it('a watch past the budget is refused and counted; the owner’s own wakes never count', async () => {
    await settings({ 'mind.wake_budget': 6 });
    await wakes('watch', 6);
    await wakes('message', 5);
    await wakes('prewarm', 3);
    const id = await dueWatch();
    expect(await pulse()).toBeNull();
    expect(await state(id)).toEqual({ state: 'over_budget' });
    const b = await claim('cse_budget_owner');
    expect(b.core).toContain('wakes today: 6 of 6, 0 watches live, 1 refused over the budget');
    const list = (await apiJson<{ used: number; refused: number }>('GET', '/v1/mind/watches', { token: p.D })).body;
    expect(list).toMatchObject({ used: 6, refused: 1 });
    // A larger budget lets the next one through.
    await settings({ 'mind.wake_budget': 12 });
    const next = await dueWatch();
    expect(await pulse()).not.toBeNull();
    expect(await state(next)).toEqual({ state: 'fired' });
    expect((await claim()).core).toContain('wakes today: 7 of 12');
    // The owner's are gone again, so the hour's cap (20) has room for the rest of the file.
    await coreSql("DELETE FROM wakes WHERE reason IN ('message', 'prewarm')");
  });

  it('at Off, a watch already set is refused when met', async () => {
    const id = await dueWatch();
    await settings({ 'mind.wake_budget': 0 });
    expect(await pulse()).toBeNull();
    expect(await state(id)).toEqual({ state: 'over_budget' });
    await settings({ 'mind.wake_budget': 12 });
    expect((await claim('cse_budget_off')).core).toContain('wakes today: 7 of 12, 0 watches live, 2 refused');
  });

  it('the chat’s ceiling holds: no watch wakes the mind past 40 fires in 24 hours', async () => {
    const id = await dueWatch();
    // Two hours ago, outside the hour's cap; within the day's.
    await wakes('message', 40, Date.now() - 2 * HOUR);
    expect(await pulse()).toBeNull();
    expect(await state(id)).toEqual({ state: 'over_budget' });
    await coreSql("DELETE FROM wakes WHERE reason = 'message'");
    await claim('cse_budget_ceiling');
  });
});

describe('quiet hours, the night, a wake on its way', () => {
  it('in quiet hours a watch still wakes the mind; its reason says so', async () => {
    const id = await dueWatch('quiet one');
    await settings({ 'quiet.until': Date.now() + HOUR });
    const w = await pulse();
    expect(w).not.toBeNull();
    expect(JSON.parse((await wakeRow(w as string)).reason_json as string)).toEqual({
      watch: id,
      kind: 'at',
      note: 'quiet one',
      quiet: true,
    });
    await settings({ 'quiet.until': 0 });
    await claim();
  });

  it('while the night runs a met watch waits; once the night ends it fires', async () => {
    await brief(p.N, 'cse_budget_night', 'night');
    const id = await dueWatch();
    expect(await pulse()).toBeNull();
    expect(await state(id)).toEqual({ state: 'queued' });
    // A chat claimed meanwhile does not take it: the night holds it.
    await claim('cse_budget_during_night');
    expect(await state(id)).toEqual({ state: 'queued' });
    await sleep(chat());
    await coreSql("UPDATE mind_sessions SET ended_at = ? WHERE session_id = 'cse_budget_night'", Date.now());
    expect(await pulse()).not.toBeNull();
    expect(await state(id)).toEqual({ state: 'fired' });
    expect((await claim()).core).toContain(`watch ${id} fired`);
  });

  it('met while a wake is on its way, it waits; that wake’s claim takes it, spending nothing', async () => {
    const id = await dueWatch('ride along');
    await coreSql(
      "INSERT INTO wakes (id, at, task, reason, status) VALUES (?, ?, 'chat', 'message', 'fired')",
      uuidv7(),
      Date.now(),
    );
    expect(await pulse()).toBeNull();
    expect(await state(id)).toEqual({ state: 'queued' });
    const b = await claim('cse_budget_ride');
    expect(b.wake?.reason).toBe('message');
    expect(b.core).toContain(`watch ${id} fired (at`);
    expect(b.core).toContain('· note: ride along');
    expect(await state(id)).toEqual({ state: 'fired' });
  });
});

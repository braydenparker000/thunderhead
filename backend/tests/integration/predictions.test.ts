// P9: predictions and their skill (EVALS.md M-18; RUNTIME.md §12 step 7b), synthetic days in UTC:
// only the night shift makes them, about the open day (before the owner's first message of it) or
// the next, with a fixed resolver and checked arguments, at most 12 a day, the same id the same
// answer; the tick resolves each once its day is over, from the owner's messages and cards, with
// the smoothed base rate of the days before; the skill shows only from 30 resolved in a category.
import { runInDurableObject } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CategorySkill, Prediction } from '../../../shared/contract/predictions.ts';
import { logicalDay } from '../../src/areas/conversation/day';
import { DAY, dayBefore, HOUR } from '../../src/lib/time';
import type { Core } from '../../src/objects/core';
import { api, apiJson, core, coreSql } from '../helpers';
import { ownerSays, principals } from '../memory-helpers';

let D = '';
let C = '';
let N = '';
let today = '';
const ID = (n: number) => `0192f0c4-0000-7000-8000-${String(n).padStart(12, '0')}`;
const put = (token: string, n: number, body: object) =>
  apiJson<Prediction>('PUT', `/v1/predictions/${ID(n)}`, { token, body });
const guess = (more: object = {}) => ({
  category: 'chat.any',
  args: {},
  day: today,
  p: 0.8,
  why: 'Writes most mornings.',
  ...more,
});
const tick = () => runInDurableObject(core() as unknown as DurableObjectStub<Core>, (o: Core) => o.tick());
const skillOf = async (category: string) =>
  (await apiJson<{ categories: CategorySkill[] }>('GET', '/v1/predictions/skill', { token: D })).body.categories.find(
    (c) => c.category === category,
  ) as CategorySkill;

/** A daily thread for `day` with owner messages at these UTC hours of that date. */
async function dayWith(day: string, hours: number[]) {
  const id = `thread-${day}`;
  const at = Date.parse(`${day}T00:00:00Z`);
  await coreSql(
    `INSERT INTO threads (id, day, kind, status, started_at, updated_at) VALUES (?, ?, 'daily', 'filed', ?, ?)`,
    id,
    day,
    at,
    at,
  );
  for (const [i, h] of hours.entries())
    await coreSql(
      `INSERT INTO messages (id, thread_id, created_at, author, origin, kind, body) VALUES (?, ?, ?, 'owner', 'owner_device', 'text', 'synthetic')`,
      `m-${day}-${i}`,
      id,
      at + h * HOUR,
    );
}
/** A prediction made earlier, straight into the table. */
const made = (n: number, category: string, args: object, day: string, p: number) =>
  coreSql(
    `INSERT INTO predictions (id, made_at, made_by, category, args_json, day, p, why, req_sha256) VALUES (?, ?, 'mind:night', ?, ?, ?, ?, 'synthetic', 'x')`,
    ID(n),
    Date.now() - 3 * DAY,
    category,
    JSON.stringify(args),
    day,
    p,
  );

beforeAll(async () => {
  ({ D, C, N } = await principals());
  await api('PATCH', '/v1/settings', { token: D, body: { 'owner.tz': 'UTC' } });
  today = logicalDay(Date.now(), 'UTC');
});

describe('predictions', () => {
  it('only the night shift makes them, about the open day or the next, with checked arguments', async () => {
    const first = await put(N, 1, guess());
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ category: 'chat.any', day: today, p: 0.8, outcome: null, base: null });
    expect((await put(N, 1, guess())).body).toEqual(first.body);
    expect(
      (
        await apiJson<{ error: { code: string } }>('PUT', `/v1/predictions/${ID(1)}`, {
          token: N,
          body: guess({ p: 0.7 }),
        })
      ).body.error.code,
    ).toBe('conflict');
    expect((await put(C, 2, guess())).status).toBe(403);
    expect((await put(D, 2, guess())).status).toBe(403);
    for (const bad of [
      { category: 'music.any' },
      { category: 'chat.count', args: { n: 1 } },
      { category: 'chat.before', args: { time: '04:30' } },
      { category: 'chat.any', args: { x: 1 } },
      { p: 0.555 },
      { p: 1 },
      { day: dayBefore(today) },
      { day: dayBefore(today, -2) },
      { why: '' },
      { category: 'decision.answered', args: { id: ID(99) } },
    ])
      expect((await put(N, 3, guess(bad))).status, JSON.stringify(bad)).toBe(422);
    expect(
      (await put(N, 3, guess({ category: 'chat.before', args: { time: '09:30' }, day: dayBefore(today, -1) }))).status,
    ).toBe(200);
    const open = await apiJson<{ items: Prediction[] }>('GET', '/v1/predictions?open=1', { token: C });
    expect(open.body.items.map((p) => p.id)).toEqual([ID(3), ID(1)]);
  });

  it('a chat prediction about the open day only before the owner writes in it; at most 12 a day', async () => {
    await ownerSays(D, 'Good morning');
    const late = await apiJson<{ error: { details: { issue: string }[] } }>('PUT', `/v1/predictions/${ID(4)}`, {
      token: N,
      body: guess({ category: 'chat.count', args: { n: 3 } }),
    });
    expect([late.status, late.body.error.details[0].issue]).toEqual([422, 'the owner has already written that day']);
    const tomorrow = dayBefore(today, -1);
    for (let n = 10; n < 20; n++) expect((await put(N, n, guess({ day: tomorrow, p: 0.5 }))).status).toBe(200);
    expect((await put(N, 20, guess({ day: tomorrow }))).status).toBe(422);
  });

  it('the tick resolves each once its day is over, with the base rate of the days before', async () => {
    const [d1, d2, d3] = [1, 2, 3].map((n) => dayBefore(today, n));
    await dayWith(d3, [7, 12]);
    await dayWith(d1, [10]);
    await made(30, 'chat.any', {}, d1, 0.9);
    await made(31, 'chat.any', {}, d2, 0.7);
    await made(32, 'chat.count', { n: 2 }, d3, 0.4);
    await made(33, 'chat.before', { time: '08:00' }, d3, 0.6);
    await made(34, 'chat.before', { time: '09:00' }, d1, 0.6);
    await tick();
    const got = await coreSql<{ id: string; outcome: number; base: number | null }>(
      'SELECT id, outcome, base FROM predictions WHERE id >= ? AND id <= ? ORDER BY id',
      ID(30),
      ID(34),
    );
    // Before d1 two days count (d3 wrote, d2 didn't): (1 + 1) / (2 + 2). Before d3, none: 1/2.
    expect(got).toEqual([
      { id: ID(30), outcome: 1, base: 0.5 },
      { id: ID(31), outcome: 0, base: (1 + 1) / (1 + 2) },
      { id: ID(32), outcome: 1, base: 0.5 },
      { id: ID(33), outcome: 1, base: 0.5 },
      { id: ID(34), outcome: 0, base: (1 + 1) / (2 + 2) },
    ]);
    expect(
      (await coreSql('SELECT count(*) AS n FROM predictions WHERE resolved_at IS NULL AND day < ?', today))[0],
    ).toEqual({ n: 0 });
    const any = await skillOf('chat.any');
    expect(any).toMatchObject({ resolved: 2, brier: 0.25, brier_base: expect.any(Number), skill: null });
    expect(any.bins.map((b) => b.n)).toEqual([0, 0, 0, 1, 1]);
  });

  it('a decision card answered before its day ends came true; one left waiting did not', async () => {
    const card = (id: string, showFrom: number, decidedAt: number | null) =>
      coreSql(
        `INSERT INTO proposals (id, created_at, created_by, class, question, why, if_ignored, options_json, spec_json, spec_hash, op, status, expires_at, visible_from, show_from, decided_at, decided_via)
         VALUES (?, ?, 'mind:night', 'delete', 'Forget it?', 'synthetic', 'Nothing.', '[]', '{}', 'h', 'memory.forget', ?, ?, ?, ?, ?, ?)`,
        id,
        showFrom,
        decidedAt === null ? 'expired' : 'approved',
        showFrom + 7 * DAY,
        showFrom,
        showFrom,
        decidedAt,
        decidedAt === null ? null : 'tap',
      );
    const d2 = dayBefore(today, 2);
    const morning = Date.parse(`${d2}T08:00:00Z`);
    await card(ID(40), morning, morning + HOUR);
    await card(ID(41), morning, null);
    await made(42, 'decision.answered', { id: ID(40) }, d2, 0.7);
    await made(43, 'decision.answered', { id: ID(41) }, d2, 0.7);
    await tick();
    const got = await coreSql<{ outcome: number }>(
      'SELECT outcome FROM predictions WHERE id IN (?, ?) ORDER BY id',
      ID(42),
      ID(43),
    );
    expect(got.map((r) => r.outcome)).toEqual([1, 0]);
  });

  it('the skill shows from 30 resolved: 1 − Brier ÷ the base rate’s Brier', async () => {
    for (let n = 0; n < 30; n++)
      await coreSql(
        `INSERT INTO predictions (id, made_at, made_by, category, args_json, day, p, why, outcome, base, resolved_at, req_sha256)
         VALUES (?, 0, 'mind:night', 'chat.count', '{"n":5}', '2026-01-01', 0.8, 's', 1, 0.5, 1, 'x')`,
        ID(100 + n),
      );
    const s = await skillOf('chat.count');
    // 30 at p 0.8 that came true (Brier 0.04) and the one from the tick above (0.4, true: 0.36).
    expect(s.resolved).toBe(31);
    expect(s.brier).toBeCloseTo((30 * 0.04 + 0.36) / 31, 3);
    expect(s.skill).toBeCloseTo(1 - (30 * 0.04 + 0.36) / 31 / 0.25, 2);
  });
});

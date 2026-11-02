// B1: routines as observed facts (the `routines` query, MEMORY.md §4 rule M5), on an invented
// fixture of five weeks in New York: Guitar practice on weekday evenings between 21:00 and 21:59,
// Study on Saturday mornings in only two weeks, a podcast on Sunday mornings spread over three hours,
// and older practice outside the 28-day window. Only the patterns with 10+ events in 3+ weeks come
// back, in the owner's hours, with a ref the Senses object counts again; weekdays, hours and counts
// only.
import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Routine, SenseQueryResponse } from '../../../shared/contract/senses.ts';
import { logicalDay } from '../../src/areas/conversation/day';
import { forgetOwner } from '../../src/areas/senses/routes';
import { uuidv7 } from '../../src/lib/ids';
import { dayBefore, zonedMinute } from '../../src/lib/time';
import type { Senses } from '../../src/objects/senses';
import { api, apiJson } from '../helpers';
import { type Principals, principals } from '../memory-helpers';

const TZ = 'America/New_York';
let p: Principals;
let TO = '';
const senses = () => env.SENSES.get(env.SENSES.idFromName('owner')) as unknown as DurableObjectStub<Senses>;
const insert = (type: string, at: number) =>
  runInDurableObject(senses(), (_o, s) => {
    s.storage.sql.exec(
      `INSERT INTO events (id, at, day, app, type, device_id, origin, sensitivity) VALUES (?, ?, ?, ?, ?, 'd', 'device', 0)`,
      uuidv7(at),
      at,
      logicalDay(at, TZ),
      type.split('.')[0],
      type,
    );
  });
const ask = (params: object, token = p.N) =>
  apiJson<SenseQueryResponse & { error?: { details: { path: string }[] } }>('POST', '/v1/senses/query', {
    token,
    body: { name: 'routines', params },
  });
const weekday = (day: string) => (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7;

beforeAll(async () => {
  p = await principals();
  await api('PATCH', '/v1/settings', { token: p.D, body: { 'owner.tz': TZ } });
  forgetOwner();
  // The window ends on a fixed day: yesterday in New York, as the night reads it.
  TO = dayBefore(logicalDay(Date.now(), TZ));
  for (let k = 0; k < 35; k++) {
    const day = dayBefore(TO, k);
    const wd = weekday(day);
    // Practice on weekday evenings, 21:05 to 21:50 local, every week of the five.
    if (wd < 5) await insert('guitar.session', zonedMinute(day, 21 * 60 + 5 + ((k * 7) % 45), TZ));
    // Study on Saturday mornings, in the first two weeks only: too few.
    if (wd === 5 && k < 14) for (const m of [0, 20, 40]) await insert('study.read', zonedMinute(day, 9 * 60 + m, TZ));
    // A podcast on Sunday mornings at 08:00, 09:00 and 10:00, in the last four weeks.
    if (wd === 6 && k < 28) for (const h of [8, 9, 10]) await insert('podcast.play', zonedMinute(day, h * 60 + 15, TZ));
  }
  // A one-off at 03:00 on a weekday: noise.
  await insert('guitar.session', zonedMinute(dayBefore(TO, 2), 3 * 60, TZ));
});
afterAll(() => forgetOwner());

describe('the routines query', () => {
  it('finds the weekday evenings, in the owner’s hours, from the last 28 days only', async () => {
    const r = await ask({ type: 'guitar.session', to: TO });
    expect(r.status).toBe(200);
    const rows = r.body.rows as Routine[];
    expect(rows).toEqual([
      {
        type: 'guitar.session',
        weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'],
        hour_from: 21,
        hour_to: 22,
        n: 20,
        weeks: 4,
        ref: `rollup:routines/guitar.session/mon.tue.wed.thu.fri/21-22/${TO}`,
      },
    ]);
    expect(r.body.rows_read).toBeGreaterThan(0);
  });

  it('every type, or one app’s: a band over the hours where no one hour holds 10; never a pattern in two weeks', async () => {
    const all = (await ask({ to: TO })).body.rows as Routine[];
    expect(all.map((x) => [x.type, x.weekdays.join(' '), x.hour_from, x.hour_to, x.n, x.weeks])).toEqual([
      ['guitar.session', 'mon tue wed thu fri', 21, 22, 20, 4],
      ['podcast.play', 'sun', 8, 11, 12, 4],
    ]);
    expect(((await ask({ app: 'podcasts', to: TO })).body.rows as Routine[]).map((x) => x.type)).toEqual([
      'podcast.play',
    ]);
    expect((await ask({ app: 'study', to: TO })).body.rows).toEqual([]);
    // Nothing but counts, weekdays, hours and the ref.
    for (const row of all)
      expect(Object.keys(row).sort()).toEqual(['hour_from', 'hour_to', 'n', 'ref', 'type', 'weekdays', 'weeks']);
  });

  it('counts a routine’s ref again; a ref it doesn’t hold is null', async () => {
    const ref = `rollup:routines/guitar.session/mon.tue.wed.thu.fri/21-22/${TO}`;
    expect(await senses().routineRef(ref, TZ)).toMatchObject({ n: 20, weeks: 4, ref });
    expect(await senses().routineRef(ref.replace('21-22', '20-21'), TZ)).toBeNull();
    expect(await senses().routineRef('rollup:routines/guitar.session/mon/21-30/2026-11-01', TZ)).toBeNull();
  });

  it('checks its parameters: a type or an app, not both; an app of the list; a day', async () => {
    const both = await ask({ type: 'guitar.session', app: 'guitar' });
    expect([both.status, both.body.error?.details[0].path]).toEqual([422, 'params.app']);
    expect((await ask({ app: 'calendar' })).status).toBe(422);
    expect((await ask({ to: 'yesterday' })).status).toBe(422);
    expect((await ask({ type: 'guitar.session' }, p.D)).status).toBe(403);
  });
});

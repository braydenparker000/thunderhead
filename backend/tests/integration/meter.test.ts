// The row meter (DATA.md §3): each object keeps its UTC day's rows read and written in its own
// meter_days row, written every 5 minutes while it is used, at once for a burst (10,000 rows read or
// 25 written, one write a run), and at a fresh instance's first query when its last write is
// older, so its counts survive the object's restart and keep adding; a busy day costs it under 300
// writes; and the meter's own queries never change a caller's numbers. Core's tick gathers every object's day into its own meter_days, which GET /v1/ops/meter
// reads (a row per class and day, and today's use against the day's budget) and deep health sums.
// The Senses object stands in for any object; everything is synthetic.
import { evictDurableObject, runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DeepHealthResponse, MeterResponse } from '../../../shared/contract/api';
import { DAY_BUDGET } from '../../../shared/contract/meter.ts';
import { DAY, MINUTE, SECOND, utcDay } from '../../src/lib/time';
import type { Db } from '../../src/objects/base';
import type { Core } from '../../src/objects/core';
import { type Senses, sensesObject } from '../../src/objects/senses';
import { apiJson, core, coreSql } from '../helpers';
import { principals } from '../memory-helpers';

const senses = () => sensesObject(env) as DurableObjectStub<Senses>;
type Row = { day: string; class: string; rows_read: number; rows_written: number; updated_at: number };
/** The object's own meter row for a day, read past its meter. */
const stored = async (day: string) =>
  (
    await runInDurableObject(
      senses(),
      (_o, s) => s.storage.sql.exec('SELECT * FROM meter_days WHERE day = ?', day).toArray() as Row[],
    )
  )[0];
/** A query through the object's own Db, as its handlers make them (it reads its two schema steps),
 * and the rows it added to the caller's numbers. */
const query = () =>
  runInDurableObject(senses(), (o) => {
    const before = o.meter.rowsRead;
    (o as unknown as { db: Db }).db.all('SELECT version FROM _migrations');
    return o.meter.rowsRead - before;
  });

/** 10:00 UTC on a Tuesday. */
const T = Date.UTC(2026, 10, 3, 10, 0);
const DAY_T = utcDay(T);
const at = (ms: number) => vi.setSystemTime(T + ms);

afterEach(() => {
  vi.useRealTimers();
});

describe("an object's own meter", () => {
  it('writes every 5 minutes while it is used, and nothing while it is not', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    at(0);
    await query(); // the meter turns to this day (writing the day that closed)
    const writes = new Set<number>();
    for (let s = 0; s <= 15 * 60; s += 30) {
      at(s * SECOND);
      // A query in which the meter writes still adds only its own rows to the caller's numbers.
      expect(await query()).toBe(2);
      const row = await stored(DAY_T);
      if (row) writes.add(row.updated_at);
    }
    // A fresh instance with nothing stored for the day writes at its first query, then every 5 minutes.
    expect([...writes].sort((a, b) => a - b)).toEqual([T, T + 5 * MINUTE, T + 10 * MINUTE, T + 15 * MINUTE]);
    // Twenty quiet minutes write nothing; the first query after them writes at once.
    at(35 * MINUTE);
    expect((await stored(DAY_T))?.updated_at).toBe(T + 15 * MINUTE);
    await query();
    expect((await stored(DAY_T))?.updated_at).toBe(T + 35 * MINUTE);
  });

  it('writes a burst at once (10,000 rows read or 25 written), even when it is the last query', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    await runInDurableObject(senses(), (_o, s) => {
      s.storage.sql.exec('CREATE TABLE t_meter (k INTEGER PRIMARY KEY, v TEXT) ');
      s.storage.sql.exec(
        `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 10500)
         INSERT INTO t_meter (k, v) SELECT i, 'x' FROM n`,
      );
    });
    at(36 * MINUTE); // a minute after the last write: not due by time
    const before = await stored(DAY_T);
    await runInDurableObject(senses(), (o) => {
      (o as unknown as { db: Db }).db.all('SELECT k FROM t_meter');
    });
    await evictDurableObject(senses());
    const scanned = await stored(DAY_T);
    expect(scanned.rows_read).toBeGreaterThanOrEqual(before.rows_read + 10_500);
    expect(scanned.updated_at).toBe(T + 36 * MINUTE);
    // Five writes of 30 rows in one run: each passes 25, and the run costs the meter one write.
    at(37 * MINUTE);
    const counted = await runInDurableObject(senses(), (o) => {
      const db = (o as unknown as { db: Db }).db;
      const was = o.meter.writes;
      for (let i = 0; i < 5; i++)
        db.run(
          'INSERT INTO t_meter (v) SELECT value FROM json_each(?)',
          JSON.stringify(Array.from({ length: 30 }, () => 'y')),
        );
      return { was, meter: o.meter };
    });
    expect(counted.meter.writes - counted.was).toBe(1);
    await evictDurableObject(senses());
    expect((await stored(DAY_T)).rows_written).toBeGreaterThanOrEqual(scanned.rows_written + 150);
  });

  it('a fresh instance starts from its stored day, and writes at its first query once 5 minutes have passed', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    at(38 * MINUTE);
    await query();
    const last = await stored(DAY_T);
    await evictDurableObject(senses());
    const restarted = await senses().health();
    expect(restarted.rows_read).toBeGreaterThanOrEqual(last.rows_read);
    expect(restarted.rows_read).toBeLessThan(last.rows_read + 20);
    at(39 * MINUTE); // under 5 minutes since the stored write: nothing yet
    await query();
    expect((await stored(DAY_T)).updated_at).toBe(last.updated_at);
    await evictDurableObject(senses());
    at(last.updated_at - T + 6 * MINUTE); // past 5 minutes: the first query writes
    await query();
    const now = await stored(DAY_T);
    expect(now.updated_at).toBe(last.updated_at + 6 * MINUTE);
    expect(now.rows_read).toBeGreaterThan(last.rows_read);
  });

  it('a busy day costs it under 300 writes, and its row ends equal to what it counted', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const start = Date.parse(`${utcDay(T + 2 * DAY)}T00:00:00Z`); // a whole UTC day
    const out = await runInDurableObject(senses(), async (o) => {
      const db = (o as unknown as { db: Db }).db;
      vi.setSystemTime(start);
      db.all('SELECT version FROM _migrations');
      await null;
      const was = o.meter.writes;
      // Every minute a small read, every 10 minutes 30 rows written, for 24 hours.
      for (let m = 1; m < 24 * 60; m++) {
        vi.setSystemTime(start + m * MINUTE);
        db.all('SELECT version FROM _migrations');
        if (m % 10 === 0)
          db.run(
            'INSERT INTO t_meter (v) SELECT value FROM json_each(?)',
            JSON.stringify(Array.from({ length: 30 }, () => 'z')),
          );
        await null; // the end of a request: the meter's write, if due, goes now
      }
      vi.setSystemTime(start + DAY + MINUTE);
      db.all('SELECT version FROM _migrations'); // the next day: the day that closed is written
      await null;
      return { writes: o.meter.writes - was, day: utcDay(start) };
    });
    expect(out.writes).toBeLessThanOrEqual(300);
    expect(out.writes).toBeGreaterThanOrEqual(144);
    const row = await stored(out.day);
    // 1,440 small reads of 2 rows, 143 bursts of 30 rows: the row holds at least that.
    expect(row.rows_read).toBeGreaterThanOrEqual(2 * 1440);
    expect(row.rows_written).toBeGreaterThanOrEqual(30 * 143);
  });

  it('closes the day at its first query after midnight and starts the next from zero', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    at(4 * DAY + 30 * MINUTE);
    await query();
    const open = (await senses().health()).rows_read;
    at(5 * DAY + 5 * SECOND); // 00:00:05 the next day
    await query();
    expect((await stored(utcDay(T + 4 * DAY))).rows_read).toBeGreaterThanOrEqual(open);
    const next = await senses().health();
    expect(next.rows_read).toBeLessThan(20);
    // The tick's question: today, and the day that closed.
    const days = await senses().meterFlush();
    expect(days.map((d) => d.day)).toEqual([utcDay(T + 5 * DAY), utcDay(T + 4 * DAY)]);
  });
});

describe("Core's meter", () => {
  let D = '';
  beforeAll(async () => {
    D = (await principals()).D;
  });

  it("each tick gathers every object's day; GET /v1/ops/meter reads them, a row per class and day", async () => {
    const today = utcDay(Date.now());
    await runInDurableObject(core() as unknown as DurableObjectStub<Core>, (o: Core) => o.tick());
    const classes = await coreSql<{ class: string }>(
      'SELECT class FROM meter_days WHERE day = ? ORDER BY class',
      today,
    );
    expect(classes.map((c) => c.class)).toEqual(['auth', 'core', 'library', 'music', 'senses']);
    const yesterday = utcDay(Date.now() - DAY);
    await coreSql(
      "INSERT INTO meter_days (day, class, rows_read, rows_written, updated_at) VALUES (?, 'music', 1200, 30, 0)",
      yesterday,
    );
    const one = await apiJson<MeterResponse>('GET', '/v1/ops/meter', { token: D });
    expect(one.status).toBe(200);
    expect(new Set(one.body.items.map((i) => i.day))).toEqual(new Set([today]));
    const two = (await apiJson<MeterResponse>('GET', '/v1/ops/meter?days=2', { token: D })).body;
    expect(two.items.find((i) => i.day === yesterday)).toEqual({
      day: yesterday,
      class: 'music',
      rows_read: 1200,
      rows_written: 30,
      bulk_rows_written: 0,
    });
    const sum = (k: 'rows_read' | 'rows_written') =>
      two.items.filter((i) => i.day === today).reduce((n, i) => n + i[k], 0);
    expect(two.today).toEqual({
      day: today,
      rows_read: sum('rows_read'),
      rows_written: sum('rows_written'),
      read_pct: Math.floor((sum('rows_read') * 100) / DAY_BUDGET.rows_read),
      written_pct: Math.floor((sum('rows_written') * 100) / DAY_BUDGET.rows_written),
      pct: expect.any(Number),
      hold_until: null,
    });
  });

  it('GET /v1/ops/meter asks the other objects at most once a minute, else reads what is stored', async () => {
    const gathered = () =>
      runInDurableObject(
        core() as unknown as DurableObjectStub<Core>,
        (o: Core) => (o as unknown as { gatheredAt: number }).gatheredAt,
      );
    await apiJson('GET', '/v1/ops/meter', { token: D });
    const first = await gathered();
    expect(first).toBeGreaterThan(0);
    await apiJson('GET', '/v1/ops/meter', { token: D });
    expect(await gathered()).toBe(first);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(first + MINUTE + SECOND);
    expect((await apiJson('GET', '/v1/ops/meter', { token: D })).status).toBe(200);
    expect(await gathered()).toBe(first + MINUTE + SECOND);
  });

  it("deep health's meter_today is the five objects' days, at least what Core has stored", async () => {
    const today = utcDay(Date.now());
    const [stored] = await coreSql<{ r: number; w: number }>(
      'SELECT sum(rows_read) AS r, sum(rows_written) AS w FROM meter_days WHERE day = ?',
      today,
    );
    const deep = (await apiJson<DeepHealthResponse>('GET', '/v1/ops/health/deep', { token: D })).body;
    expect(deep.meter_today.rows_read).toBeGreaterThanOrEqual(stored.r);
    expect(deep.meter_today.rows_written).toBeGreaterThanOrEqual(stored.w);
  });
});

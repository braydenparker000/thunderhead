// The row meter (DATA.md §3): each object keeps its UTC day's rows read and written in its own
// meter_days row, written at most once a minute and only in minutes it is used, so its counts
// survive the object's restart and keep adding, and the meter's own queries never change a caller's
// numbers. Core's tick gathers every object's day into its own meter_days, which GET /v1/ops/meter
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
  it('writes its day at most once a minute, and only in minutes it is used', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    at(0);
    await query(); // the meter turns to this day
    const writes = new Set<number>();
    for (let s = 0; s <= 180; s += 10) {
      at(s * SECOND);
      // A query in which the meter writes still adds only its own rows to the caller's numbers.
      expect(await query()).toBe(2);
      const row = await stored(DAY_T);
      if (row) writes.add(row.updated_at);
    }
    const times = [...writes].sort((a, b) => a - b);
    expect(times).toEqual([T + MINUTE, T + 2 * MINUTE, T + 3 * MINUTE]);
    // Ten quiet minutes write nothing; the next query after them writes once.
    at(13 * MINUTE);
    expect((await stored(DAY_T))?.updated_at).toBe(T + 3 * MINUTE);
    await query();
    at(13 * MINUTE + 20 * SECOND);
    await query();
    expect((await stored(DAY_T))?.updated_at).toBe(T + 13 * MINUTE);
  });

  it('keeps its counts across a restart, and goes on adding to them', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    at(20 * MINUTE);
    await query(); // a minute and more since the last write: written now
    const before = await stored(DAY_T);
    expect(before.rows_read).toBeGreaterThan(0);
    expect((await senses().health()).rows_read).toBeGreaterThanOrEqual(before.rows_read);
    // Queries after the last write are lost with an eviction: at most about a minute of use.
    at(20 * MINUTE + 30 * SECOND);
    await query();
    await evictDurableObject(senses());
    const restarted = await senses().health();
    expect(restarted.rows_read).toBeGreaterThanOrEqual(before.rows_read);
    expect(restarted.rows_read).toBeLessThan(before.rows_read + 20);
    at(22 * MINUTE);
    for (let i = 0; i < 5; i++) await query();
    at(23 * MINUTE);
    await query();
    const after = await stored(DAY_T);
    expect(after.rows_read).toBeGreaterThanOrEqual(before.rows_read + 12);
    expect(after.updated_at).toBe(T + 23 * MINUTE);
  });

  it('closes the day at its first query after midnight and starts the next from zero', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    at(30 * MINUTE);
    await query();
    const open = (await senses().health()).rows_read;
    at(DAY + 5 * SECOND); // 00:00:05 the next day, under a minute after nothing
    await query();
    expect((await stored(DAY_T)).rows_read).toBeGreaterThanOrEqual(open);
    const next = await senses().health();
    expect(next.rows_read).toBeLessThan(20);
    // The tick's question: today, and the day that closed.
    const days = await senses().meterFlush();
    expect(days.map((d) => d.day)).toEqual([utcDay(T + DAY), DAY_T]);
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

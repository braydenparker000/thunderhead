// P5: the Senses object exists on its own (DATA.md §6.1): it migrates to its schema once, reports
// its health like the other objects, and holds its four tables, empty, with its two events indexes,
// beside the row meter's `meter_days`. A type's newest event reads the same few rows however many
// events the table holds.

import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { lastEvent } from '../../src/areas/senses/store';
import { Db, Meter } from '../../src/objects/base';
import type { Senses } from '../../src/objects/senses';

const senses = () => env.SENSES.get(env.SENSES.idFromName('owner')) as unknown as DurableObjectStub<Senses>;

describe('the Senses object', () => {
  it('migrates once to its schema and reports its health', async () => {
    expect(await senses().health()).toMatchObject({ schema: 3, expected: 3 });
    const names = (type: string) =>
      runInDurableObject(senses(), (_o, state) =>
        state.storage.sql
          .exec(
            "SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE '\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite_%' ORDER BY name",
            type,
          )
          .toArray()
          .map((r) => r.name),
      );
    expect(await names('table')).toEqual(['batches', 'events', 'exports', 'meter_days', 'rollups']);
    expect(await names('index')).toEqual(['events_day_type', 'events_type_seq']);
  });

  it("reads a type's newest event without walking the table", async () => {
    const stub = env.SENSES.getByName('last-event') as unknown as DurableObjectStub<Senses>;
    const read = () =>
      runInDurableObject(stub, (_o, state) => {
        const meter = new Meter();
        const e = lastEvent(new Db(state.storage.sql, meter), 'app.open');
        return { seq: e?.seq, rows: meter.today().rows_read };
      });
    // Synthetic rows: one old event of the type, then many of another type after it.
    const add = (n: number, type: string) =>
      runInDurableObject(stub, (_o, state) =>
        state.storage.sql.exec(
          `WITH RECURSIVE k(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM k WHERE i < ?)
           INSERT INTO events (id, at, day, app, type, device_id, origin) SELECT 'e' || i, i, '2026-10-01', 'home', ?, 'd', 'phone' FROM k`,
          n,
          type,
        ),
      );
    await add(1, 'app.open');
    await add(2_000, 'music.play');
    const small = await read();
    await add(20_000, 'music.play');
    const big = await read();
    expect(small.seq).toBe(1);
    expect(big.seq).toBe(1);
    expect(big.rows).toBe(small.rows);
    expect(big.rows).toBeLessThanOrEqual(2);
  });
});

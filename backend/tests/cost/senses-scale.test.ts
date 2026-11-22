// The Senses object's cost does not grow with its table (DATA.md §6.1, OPERATIONS.md §8): a sealed
// batch, and the tick's daily pass once the day is archived (Core's tick asks every 15 minutes), read
// the same rows with 1,000 events kept as with 50,000 (one batch record per 10 events, all inside the
// 30 days they are kept). Live, 8–21 Nov 2026, the pass's batch prune read the whole batch table on
// every tick. Synthetic events only.
import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { expect, it } from 'vitest';
import { uuidv7 } from '../../src/lib/ids';
import type { Senses } from '../../src/objects/senses';

const NOW = Date.parse('2026-11-21T12:00:00Z');

async function costAt(n: number) {
  const stub = env.SENSES.getByName(`scale-${n}`) as unknown as DurableObjectStub<Senses>;
  await runInDurableObject(stub, (_o, state) => {
    const sql = state.storage.sql;
    sql.exec(
      `WITH RECURSIVE k(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM k WHERE i < ?)
       INSERT INTO events (id, at, day, app, type, ref, data_json, device_id, origin)
       SELECT 'e' || i, ?2 - (1 + i % 28) * 86400000, date((?2 - (1 + i % 28) * 86400000) / 1000, 'unixepoch'), 'music',
         CASE i % 3 WHEN 0 THEN 'music.play' WHEN 1 THEN 'music.skip' ELSE 'app.open' END,
         'music:s' || (i % 500), '{"at_ms":1000}', 'd', 'device' FROM k`,
      n,
      NOW,
    );
    sql.exec(
      'INSERT INTO rollups (day, type, ref, n, sum_ms) SELECT day, type, ref, count(*), 0 FROM events GROUP BY day, type, ref',
    );
    sql.exec(
      `WITH RECURSIVE k(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM k WHERE i < ?)
       INSERT INTO batches (batch_id, device_id, received_at, n, sha256) SELECT 'b' || i, 'd', ?2 - (1 + i % 28) * 86400000, 10, 's' FROM k`,
      n / 10,
      NOW,
    );
  });
  const rows = (fn: (o: Senses) => unknown) =>
    runInDurableObject(stub, async (o: Senses) => {
      const before = o.meter.rowsRead;
      await fn(o);
      return o.meter.rowsRead - before;
    });
  // The first pass archives the 28 days owed; the next ones (every tick after) are what grows or not.
  await rows((o) => o.daily(NOW, '2026-11-21'));
  const tick = await rows((o) => o.daily(NOW + 15 * 60_000, '2026-11-21'));
  const events = Array.from({ length: 50 }, (_, i) => ({
    id: uuidv7(),
    at: NOW - 1_000 * i,
    type: i % 2 ? 'music.skip' : 'music.play',
    ref: 'music:s1' as const,
    data: i % 2 ? { at_ms: 1_000 } : {},
  }));
  const batch = await rows((o) => {
    const r = o.putBatch(uuidv7(), 'sha', 'd', events, 'UTC', NOW);
    expect(r).toMatchObject({ accepted: 50 });
  });
  return { tick, batch };
}

it("a batch and the tick's daily pass read no more with 50,000 events than with 1,000", async () => {
  const small = await costAt(1_000);
  const big = await costAt(50_000);
  expect(big.batch).toBe(small.batch);
  expect(big.tick).toBe(small.tick);
  // Two seeks a day for the 31 days a late event may land on, and the prunes' index seeks.
  expect(big.tick).toBeLessThanOrEqual(80);
}, 120_000);

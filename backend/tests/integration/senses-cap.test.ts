// The senses' daily cap (SENSE_LIMITS.day_events, OPERATIONS.md §8): a new batch that would take the
// UTC day past it answers 429 `budget_exhausted` with `retry_after` (seconds to 00:00 UTC) and
// stores nothing, while a batch already taken still answers 200 when the phone sends it again.
import { evictDurableObject, runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeAll, expect, it } from 'vitest';
import { SENSE_LIMITS } from '../../../shared/contract/senses.ts';
import { uuidv7 } from '../../src/lib/ids';
import type { Senses } from '../../src/objects/senses';
import { api } from '../helpers';
import { type Principals, principals } from '../memory-helpers';

let p: Principals;
const senses = () => env.SENSES.getByName('owner') as unknown as DurableObjectStub<Senses>;
const sql = <T>(q: string, ...b: unknown[]) =>
  runInDurableObject(senses(), (_o, s) => s.storage.sql.exec(q, ...(b as SqlStorageValue[])).toArray() as T[]);
const ev = (n: number) =>
  Array.from({ length: n }, () => ({ id: uuidv7(), at: Date.now() - 60_000, type: 'app.open', ref: 'app:music' }));
const put = (id: string, events: unknown[]) => api('PUT', `/v1/senses/batches/${id}`, { token: p.D, body: { events } });

beforeAll(async () => {
  p = await principals();
});

it('refuses a batch past the day’s cap with retry_after to 00:00 UTC, and keeps answering one taken', async () => {
  const taken = uuidv7();
  const first = ev(5);
  expect((await put(taken, first)).status).toBe(200);
  // The day's earlier batches, as their records stand, leave room for 5 more events.
  await sql(
    'INSERT INTO batches (batch_id, device_id, received_at, n, sha256) VALUES (?, ?, ?, ?, ?)',
    'earlier',
    'd',
    Date.now(),
    SENSE_LIMITS.day_events - 10,
    's',
  );
  await evictDurableObject(senses());
  const before = (await sql<{ n: number }>('SELECT count(*) AS n FROM events'))[0].n;
  const res = await put(uuidv7(), ev(6));
  expect(res.status).toBe(429);
  const body = (await res.json()) as { error: { code: string; retry_after: number; scope: string } };
  expect(body.error.code).toBe('budget_exhausted');
  const midnight = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`) + 86_400_000;
  expect(Math.abs(body.error.retry_after - (midnight - Date.now()) / 1000)).toBeLessThan(5);
  expect(res.headers.get('Retry-After')).toBe(String(body.error.retry_after));
  expect((await sql<{ n: number }>('SELECT count(*) AS n FROM events'))[0].n).toBe(before);
  // Exactly up to the cap still fits; the same batch again is answered from its record.
  expect((await put(uuidv7(), ev(5))).status).toBe(200);
  expect((await put(taken, first)).status).toBe(200);
  expect((await put(uuidv7(), ev(1))).status).toBe(429);
});

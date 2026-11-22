// A spent day (http/errors.ts): the platform's refusal once the account's daily free rows are used
// answers 429 `budget_exhausted` with `retry_after` to 00:00 UTC, not 500 `internal`; a CPU, memory,
// storage-full or overload error stays what it was. The refusal's words are not documented
// (Durable Objects pricing, Free plan: "further operations of that type will fail with an error"),
// so these are the shapes such a refusal takes.
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { onError, spentDay } from '../../src/http/errors';

const app = (message: string) =>
  new Hono()
    .get('/x', () => {
      throw new Error(message);
    })
    .onError(onError);

describe("the platform's likely wording", () => {
  it('is a spent day whichever way round it names the limit and the tier', () => {
    expect(spentDay(new Error('Exceeded allowed rows written in Durable Objects free tier.'))).toBe(true);
    expect(spentDay(new Error('Exceeded allowed rows read in Durable Objects free tier.'))).toBe(true);
    expect(spentDay(new Error('Worker exceeded CPU time limit.'))).toBe(false);
  });
});

describe('a spent day', () => {
  it('answers 429 budget_exhausted until 00:00 UTC', async () => {
    const res = await app('Exceeded the daily free tier limit for rows written.').request('/x');
    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: { code: string; retry_after: number; scope: string } };
    const midnight = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`) + 86_400_000;
    expect(body.error).toMatchObject({ code: 'budget_exhausted', scope: 'account' });
    expect(Math.abs(body.error.retry_after - (midnight - Date.now()) / 1000)).toBeLessThan(5);
    expect(res.headers.get('Retry-After')).toBe(String(body.error.retry_after));
  });

  it('knows the shapes of a limit refusal, and nothing else', () => {
    for (const m of [
      'Exceeded the daily free tier limit for rows written.',
      'Your account has exceeded its daily limit for Durable Objects rows read',
      'rows written limit exceeded for this account',
      'D1 DB exceeded daily limit',
      'free plan daily quota reached',
    ])
      expect(spentDay(new Error(m)), m).toBe(true);
    for (const m of [
      'Worker exceeded resource limits',
      'exceeded CPU time limit',
      'Memory limit would be exceeded before EOF',
      'database or disk is full: SQLITE_FULL',
      'Durable Object is overloaded. Too many requests queued.',
      "Exceeded the account's spending cap for Durable Objects",
      'no such table: events',
    ])
      expect(spentDay(new Error(m)), m).toBe(false);
    expect(spentDay(null)).toBe(false);
  });

  it('leaves any other error a 500 internal', async () => {
    expect((await app('no such table: events').request('/x')).status).toBe(500);
  });
});

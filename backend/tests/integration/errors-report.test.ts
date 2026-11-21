// A route that throws something unexpected answers the fixed 500 and is recorded in Core's error
// inbox as a `worker` error the errors.spike watchdog counts (by route and error name, never the
// message), at most 5 an isolate in a minute; with nowhere to record it, the answer is the same.
import { createExecutionContext, runInDurableObject, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import { errorCounts } from '../../src/areas/ops/store';
import { onError } from '../../src/http/errors';
import { forgetReports } from '../../src/http/report';
import type { Db } from '../../src/objects/base';
import type { Core } from '../../src/objects/core';
import { core, coreSql } from '../helpers';

class BrokenThing extends Error {
  override name = 'BrokenThing';
}
const app = new Hono<{ Bindings: Env }>()
  .get('/v1/boom/:id', () => {
    throw new BrokenThing('a message with request data in it');
  })
  .onError(onError);

const hit = async (bindings: Env = env) => {
  const ctx = createExecutionContext();
  const res = await app.request('/v1/boom/1', {}, bindings, ctx);
  await waitOnExecutionContext(ctx);
  return res;
};
/** What errors.spike reads: the server sources' counts (areas/watchdogs/checks.ts). */
const counted = () =>
  runInDurableObject(core() as unknown as DurableObjectStub<Core>, (o: Core) =>
    errorCounts((o as unknown as { db: Db }).db, ['worker', 'do']),
  );

beforeEach(() => forgetReports());

describe('server errors reach the error inbox', () => {
  it('records a route that throws as one worker error, by route and name, at most 5 a minute', async () => {
    const res = await hit();
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('internal');
    expect(await counted()).toEqual([{ fingerprint: expect.any(String), count: 1 }]);
    const [row] = await coreSql<Record<string, unknown>>('SELECT source, route, code, message FROM errors');
    expect(row).toEqual({ source: 'worker', route: '/v1/boom/:id', code: 'BrokenThing', message: 'BrokenThing' });
    for (let i = 0; i < 6; i++) expect((await hit()).status).toBe(500);
    expect((await counted())[0].count).toBe(5);
  });

  it('answers the same 500 when the record cannot be made', async () => {
    const res = await hit({ ...env, CORE: undefined } as unknown as Env);
    expect(res.status).toBe(500);
  });
});

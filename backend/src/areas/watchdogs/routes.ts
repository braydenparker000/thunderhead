// /v1/ops/watchdogs (OPERATIONS.md §8.2): every watchdog of the registry with its state, and the
// report a mind session (normally the reflex) makes on a trip. The sandbox has no watchdogs.
import { Hono } from 'hono';
import * as z from 'zod/mini';
import {
  WATCHDOG_NAMES,
  type WatchdogHandledRequest,
  type WatchdogItem,
  type WatchdogName,
  type WatchdogsResponse,
} from '../../../../shared/contract/watchdogs.ts';
import { type AppEnv, guard } from '../../http/auth';
import { callerOf } from '../../http/caller';
import { ApiError } from '../../http/errors';
import { inSandbox } from '../../http/sandbox';
import { json } from '../../http/validate';
import { value } from '../../lib/result';
import { coreObject } from '../../objects/core';
import { fresh } from '../../objects/rpc';

const handledBody = z.strictObject({
  outcome: z.enum(['fixed', 'reported', 'nothing']),
  note: z.string().check(z.minLength(8), z.maxLength(200)),
}) satisfies z.ZodMiniType<WatchdogHandledRequest>;

const nameOf = (raw: string): WatchdogName => {
  if (!(WATCHDOG_NAMES as string[]).includes(raw)) throw new ApiError('not_found');
  return raw as WatchdogName;
};

export const watchdogsRoutes = new Hono<AppEnv>()
  .get('/ops/watchdogs', guard('GET /v1/ops/watchdogs'), async (c) => {
    if (inSandbox()) throw new ApiError('validation', [{ path: 'TH-Sandbox', issue: 'the sandbox has no watchdogs' }]);
    const items = (await fresh(coreObject(c.env).watchdogs())) as WatchdogItem[];
    return c.json({ items } satisfies WatchdogsResponse);
  })
  .post('/ops/watchdogs/:name/handled', guard('POST /v1/ops/watchdogs/:name/handled'), async (c) => {
    if (inSandbox()) throw new ApiError('validation', [{ path: 'TH-Sandbox', issue: 'the sandbox has no watchdogs' }]);
    const name = nameOf(c.req.param('name'));
    const body = await json(c, handledBody);
    return c.json(value(await fresh(coreObject(c.env).watchdogHandled(callerOf(c), name, body))) as WatchdogItem);
  });

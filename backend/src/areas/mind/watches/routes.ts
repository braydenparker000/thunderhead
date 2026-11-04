// /v1/mind/watches and /v1/mind/usage (API.md §11.8): the day pulse's watches with the wake budget,
// and the usage meter Settings › The mind shows. For the device and the mind roles; a mind session
// that read no outside text gets an outside watch's words kept back (brief.ts).
import { Hono } from 'hono';
import type { UsageResponse, WatchesResponse } from '../../../../../shared/contract/watches.ts';
import { type AppEnv, guard } from '../../../http/auth';
import { callerOf } from '../../../http/caller';
import { coreObject } from '../../../objects/core';
import { fresh } from '../../../objects/rpc';

export const watchesRoutes = new Hono<AppEnv>()
  .get('/mind/watches', guard('GET /v1/mind/watches'), async (c) =>
    c.json((await fresh(coreObject(c.env).watchList(callerOf(c)))) satisfies WatchesResponse),
  )
  .get('/mind/usage', guard('GET /v1/mind/usage'), async (c) =>
    c.json((await fresh(coreObject(c.env).usage())) satisfies UsageResponse),
  );

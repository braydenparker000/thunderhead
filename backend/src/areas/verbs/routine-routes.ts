// /v1/routines (API.md §11.11 "Routines"): the approved routines, for Settings › The mind › Routines
// and `th routine list`; the switch (the owner's on or off, the mind's off only); and the owner's
// Remove of one that is off. A routine is proposed as a decision card (`routine.propose`, /v1/proposals)
// and stored by the owner's yes; there is no route that stores one directly.
import { Hono } from 'hono';
import * as z from 'zod/mini';
import type { Routine, RoutinesResponse } from '../../../../shared/contract/routines.ts';
import { type AppEnv, guard } from '../../http/auth';
import { callerOf, idParam } from '../../http/caller';
import { json } from '../../http/validate';
import { value } from '../../lib/result';
import { coreObject } from '../../objects/core';
import { fresh } from '../../objects/rpc';

export const routineRoutes = new Hono<AppEnv>()
  .get('/routines', guard('GET /v1/routines'), async (c) => {
    return c.json((await fresh(coreObject(c.env).routines())) satisfies RoutinesResponse);
  })
  .post('/routines/:id/switch', guard('POST /v1/routines/:id/switch'), async (c) => {
    const id = idParam(c);
    const body = await json(c, z.strictObject({ on: z.boolean() }));
    return c.json(value(await fresh(coreObject(c.env).routineSwitch(callerOf(c), id, body.on))) satisfies Routine);
  })
  .delete('/routines/:id', guard('DELETE /v1/routines/:id'), async (c) => {
    return c.json(value(await fresh(coreObject(c.env).routineRemove(callerOf(c), idParam(c)))));
  });

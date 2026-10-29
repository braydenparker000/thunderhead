// /v1/briefing and the Board's editions (BRIEFING.md §2–§5): what the Briefing page shows now, and
// one day's Board for the reader, which the page renders as outside content labelled "from Muse".
import { Hono } from 'hono';
import type { BriefingResponse } from '../../../../shared/contract/briefing.ts';
import { type AppEnv, guard } from '../../http/auth';
import { ApiError } from '../../http/errors';
import { inSandbox } from '../../http/sandbox';
import { coreObject } from '../../objects/core';
import { fresh } from '../../objects/rpc';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const briefingRoutes = new Hono<AppEnv>()
  .get('/briefing', guard('GET /v1/briefing'), async (c) => {
    if (inSandbox()) throw new ApiError('validation', [{ path: 'TH-Sandbox', issue: 'the sandbox has no briefing' }]);
    return c.json((await fresh(coreObject(c.env).briefingNow())) as BriefingResponse);
  })
  .get('/board/editions/:day', guard('GET /v1/board/editions/:day'), async (c) => {
    const day = c.req.param('day');
    if (!DAY.test(day)) throw new ApiError('not_found');
    const e = (await fresh(coreObject(c.env).boardEdition(day))) as {
      day: string;
      edition: unknown;
      finished_at: number;
    } | null;
    if (!e) throw new ApiError('not_found');
    return c.json({ ...e, origin: 'muse' });
  });

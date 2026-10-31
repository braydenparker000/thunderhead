// /v1/ops/reports (API.md §11.16): batches the phone sends about how the apps run (NEXT-BATCH.md
// part 1; Music's playback log first), and the list the owner's devices, the mind and CI read
// back, newest first. A batch is one row, kept 30 days.
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import * as z from 'zod/mini';
import type { Page } from '../../../../shared/contract/api';
import {
  REPORT_KINDS,
  REPORT_LIMITS,
  type Report,
  type ReportCreated,
  type ReportRequest,
} from '../../../../shared/contract/reports.ts';
import { type AppEnv, guard } from '../../http/auth';
import { callerOf } from '../../http/caller';
import { ApiError } from '../../http/errors';
import { json, parse } from '../../http/validate';
import { decodeCursor, encodeCursor } from '../../lib/cursor';
import { value } from '../../lib/result';
import { coreObject } from '../../objects/core';
import { fresh } from '../../objects/rpc';

const tooLarge = (): never => {
  throw new ApiError('too_large');
};

// The body's own size (32 KB as JSON) is checked once it is cleaned (ops.ts); this bounds the read.
const postBody = z.strictObject({
  kind: z.enum(REPORT_KINDS),
  body: z.record(z.string(), z.json()),
}) satisfies z.ZodMiniType<ReportRequest>;

const listQuery = z.object({
  kind: z.optional(z.enum(REPORT_KINDS)),
  since: z.optional(z.coerce.number().check(z.int(), z.gte(0))),
  limit: z.optional(z.coerce.number().check(z.int(), z.gte(1), z.lte(REPORT_LIMITS.page_max))),
  cursor: z.optional(z.string().check(z.maxLength(200))),
});

const ROUTE = 'ops/reports';

/** A cursor this route wrote: the last row's `[at, id]`. */
function cursorOf(raw: string | undefined): [number, string] | null {
  const k = decodeCursor(ROUTE, raw);
  if (k === null) return null;
  if (k.length !== 2 || !Number.isSafeInteger(k[0]) || typeof k[1] !== 'string') throw new ApiError('bad_request');
  return [k[0] as number, k[1]];
}

export const reportsRoutes = new Hono<AppEnv>()
  .post(
    '/ops/reports',
    guard('POST /v1/ops/reports'),
    bodyLimit({ maxSize: REPORT_LIMITS.body_bytes + 1024, onError: tooLarge }),
    async (c) => {
      const r = await json(c, postBody);
      const out = value(await fresh(coreObject(c.env).putReport(callerOf(c), r)));
      return c.json(out satisfies ReportCreated, 201);
    },
  )
  .get('/ops/reports', guard('GET /v1/ops/reports'), async (c) => {
    const q = parse(listQuery, c.req.query());
    const limit = q.limit ?? 50;
    const items = await fresh(coreObject(c.env).reports(q.kind ?? null, q.since ?? 0, limit, cursorOf(q.cursor)));
    const last = items.at(-1);
    const next = items.length === limit && last ? encodeCursor(ROUTE, [last.at, last.id]) : null;
    return c.json({ items, next } satisfies Page<Report>);
  });

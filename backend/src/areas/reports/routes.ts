// /v1/ops/reports (API.md §11.16): batches the phone sends about how the apps run (NEXT-BATCH.md
// part 1; Music's playback log first), and the list the owner's devices and the mind read back,
// newest first (never CI: a batch is listening history, and CI's logs are public). A batch is one
// row, kept 30 days. The list passes each batch's stored JSON on as it is, never parsed again.
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import * as z from 'zod/mini';
import {
  REPORT_KINDS,
  REPORT_LIMITS,
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

// The body's own size (32 KB as JSON) is checked once it is kept to its known fields (ops.ts); this
// bounds the read.
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
      const out = await fresh(coreObject(c.env).putReport(callerOf(c), r));
      if (!out.ok && 'retry_after' in out)
        throw new ApiError('rate_limited', undefined, { retry_after: out.retry_after });
      return c.json(value(out) satisfies ReportCreated, 201);
    },
  )
  .get('/ops/reports', guard('GET /v1/ops/reports'), async (c) => {
    const q = parse(listQuery, c.req.query());
    const limit = q.limit ?? 50;
    const page = await fresh(coreObject(c.env).reports(q.kind ?? null, q.since ?? 0, limit, cursorOf(q.cursor)));
    const last = page.rows.at(-1);
    const next = page.more && last ? encodeCursor(ROUTE, [last.at, last.id]) : null;
    // `Page<Report>`, written here so each batch's JSON goes out as it was kept.
    const items = page.rows.map(
      (r) =>
        `{"id":${JSON.stringify(r.id)},"kind":${JSON.stringify(r.kind)},"device_id":${JSON.stringify(r.device_id)},"at":${r.at},"body":${r.body_json}}`,
    );
    return c.body(`{"items":[${items.join(',')}],"next":${JSON.stringify(next)}}`, 200, {
      'Content-Type': 'application/json',
    });
  });

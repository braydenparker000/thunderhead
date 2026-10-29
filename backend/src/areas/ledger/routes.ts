// /v1/ledger (API.md §11.9): read the ledger, record outside actions, undo by stored inverse.
import { Hono } from 'hono';
import * as z from 'zod/mini';
import type { LedgerEntry, Page, PutLedgerRequest, UndoResponse } from '../../../../shared/contract/api';
import { type AppEnv, guard } from '../../http/auth';
import { callerOf, idParam, reqHash } from '../../http/caller';
import { json, parse } from '../../http/validate';
import { value } from '../../lib/result';
import { coreObject } from '../../objects/core';

const REF = /^[a-z][a-z0-9]{1,15}:[A-Za-z0-9._:/-]{1,160}(#[A-Za-z0-9._:-]{1,64})?$/;
const putBody = z.strictObject({
  kind: z.enum(['deploy', 'mistake', 'note']),
  what: z.string().check(z.minLength(1), z.maxLength(200)),
  why: z.string().check(z.minLength(8), z.maxLength(500)),
  ref: z.optional(z.string().check(z.regex(REF))),
  topic_key: z.optional(z.string().check(z.regex(/^[a-z0-9][a-z0-9._-]{0,63}$/))),
}) satisfies z.ZodMiniType<PutLedgerRequest>;
const pageQuery = z.object({
  before_seq: z.optional(z.coerce.number().check(z.int(), z.gte(1))),
  limit: z.optional(z.coerce.number().check(z.int(), z.gte(1), z.lte(200))),
  actor: z.optional(z.enum(['owner', 'mind:chat', 'mind:night', 'mind:reflex', 'muse', 'ci', 'worker'])),
  status: z.optional(z.enum(['done', 'undone', 'failed'])),
  since: z.optional(z.coerce.number().check(z.int(), z.gte(0))),
  kind: z.optional(z.enum(['memory', 'arrangement', 'verb', 'deploy', 'proposal', 'mistake', 'undo', 'note'])),
});

export const ledgerRoutes = new Hono<AppEnv>()
  .get('/ledger', guard('GET /v1/ledger'), async (c) => {
    const q = parse(pageQuery, c.req.query());
    const limit = q.limit ?? 50;
    const items = await coreObject(c.env).ledger(q.before_seq ?? null, limit, {
      actor: q.actor ?? null,
      status: q.status ?? null,
      since: q.since ?? null,
      kind: q.kind ?? null,
    });
    const last = items.at(-1);
    return c.json({
      items,
      next: items.length === limit && last ? String(last.seq) : null,
    } satisfies Page<LedgerEntry>);
  })
  .put('/ledger/:id', guard('PUT /v1/ledger/:id'), async (c) => {
    const id = idParam(c);
    const body = await json(c, putBody);
    const out = value(await coreObject(c.env).putLedger(callerOf(c), id, body, reqHash(body)));
    return c.json(out.entry satisfies LedgerEntry, out.created ? 201 : 200);
  })
  .post('/ledger/:id/undo', guard('POST /v1/ledger/:id/undo'), async (c) => {
    return c.json(value(await coreObject(c.env).undo(callerOf(c), idParam(c))) satisfies UndoResponse);
  });

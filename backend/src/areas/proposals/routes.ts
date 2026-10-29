// /v1/proposals (API.md §11.10): agents raise decision cards; the owner decides them by a tap on a
// signed-in device, or in their own words, which mind:chat records with `by_message` and the
// Worker checks. The ops, classes and limits are the contract's (shared/contract/proposals.ts).
import { Hono } from 'hono';
import * as z from 'zod/mini';
import type {
  DecideProposalRequest,
  DecideProposalResponse,
  Proposal,
  ProposalsResponse,
  PutProposalRequest,
} from '../../../../shared/contract/api';
import { PROPOSAL_LIMITS as L, PROPOSAL_CLASS_NAMES } from '../../../../shared/contract/proposals.ts';
import { type AppEnv, guard } from '../../http/auth';
import { callerOf, idParam, reqHash } from '../../http/caller';
import { json, parse } from '../../http/validate';
import { UUIDV7 } from '../../lib/ids';
import { value } from '../../lib/result';
import { coreObject } from '../../objects/core';
import { fresh } from '../../objects/rpc';
import { runAfter } from './after';
import { type ProposalRow, toProposal } from './store';

const text = (max: number) => z.string().check(z.minLength(1), z.maxLength(max));
const option = text(L.option);
const putBody = z.strictObject({
  class: z.enum(PROPOSAL_CLASS_NAMES),
  question: text(L.question),
  why: text(L.why),
  if_ignored: text(L.if_ignored),
  odds: z.optional(z.number().check(z.gte(0), z.lte(1))),
  options: z.tuple([option, option]),
  safe: z.optional(z.enum(['reject', 'snooze'])),
  spec: z.strictObject({
    v: z.literal(1),
    op: z.string().check(z.minLength(1), z.maxLength(60)),
    args: z.record(z.string(), z.json()),
  }),
}) satisfies z.ZodMiniType<PutProposalRequest>;
const decideBody = z.strictObject({
  decision: z.enum(['approve', 'reject', 'snooze']),
  spec_hash: z.string().check(z.regex(/^[0-9a-f]{64}$/)),
  by_message: z.optional(z.string().check(z.regex(UUIDV7))),
}) satisfies z.ZodMiniType<DecideProposalRequest>;
const cancelBody = z.strictObject({ why: z.string().check(z.minLength(8), z.maxLength(200)) });
const listQuery = z.object({
  status: z.optional(z.enum(['waiting', 'all'])),
  cursor: z.optional(z.string().check(z.regex(UUIDV7))),
  limit: z.optional(z.coerce.number().check(z.int(), z.gte(1), z.lte(200))),
});

export const proposalsRoutes = new Hono<AppEnv>()
  .put('/proposals/:id', guard('PUT /v1/proposals/:id'), async (c) => {
    const id = idParam(c);
    const body = await json(c, putBody);
    const out = value(await fresh(coreObject(c.env).putProposal(callerOf(c), id, body, reqHash(body))));
    return c.json(out.proposal satisfies Proposal, out.created ? 201 : 200);
  })
  .get('/proposals', guard('GET /v1/proposals'), async (c) => {
    const q = parse(listQuery, c.req.query());
    const limit = q.limit ?? 50;
    const rows = await fresh(coreObject(c.env).proposals(q.status ?? 'waiting', q.cursor ?? null, limit));
    const items = rows.map((r) => toProposal(r as ProposalRow));
    const page: ProposalsResponse = { items, next: items.length === limit ? (items.at(-1)?.id ?? null) : null };
    // Sent as text: Hono's JSON typing recurses without end through the `Json` fields of a list.
    return c.body(JSON.stringify(page), 200, { 'Content-Type': 'application/json' });
  })
  .post('/proposals/:id/decide', guard('POST /v1/proposals/:id/decide'), async (c) => {
    const id = idParam(c);
    const body = await json(c, decideBody);
    const core = coreObject(c.env);
    const { after, ...out } = value(await fresh(core.decideProposal(callerOf(c), id, body)));
    if (!after) return c.json(out satisfies DecideProposalResponse);
    // An op of the Auth object: run it now; if Auth can't be reached, the card stays `approved`
    // and the cron runs it again.
    const ran = await runAfter(c.env, after);
    if (!ran) return c.json(out satisfies DecideProposalResponse);
    return c.json(value(await core.proposalRan(id, ran)) satisfies DecideProposalResponse);
  })
  .post('/proposals/:id/cancel', guard('POST /v1/proposals/:id/cancel'), async (c) => {
    const id = idParam(c);
    const { why } = await json(c, cancelBody);
    return c.json(value(await fresh(coreObject(c.env).cancelProposal(callerOf(c), id, why))));
  });

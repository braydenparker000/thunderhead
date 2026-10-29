// /v1/proposals (API.md §11.10): agents raise decision cards; the owner decides them by a tap on a
// signed-in device, or in their own words, which mind:chat records with `by_message` and the
// Worker checks. The ops, classes and limits are the contract's (shared/contract/proposals.ts).
// The one-time import key moves history in and nothing else: it raises, decides and cancels no card.
import { type Context, Hono } from 'hono';
import * as z from 'zod/mini';
import type {
  AgentRole,
  DecideProposalRequest,
  DecideProposalResponse,
  Proposal,
  ProposalsResponse,
  PutProposalRequest,
} from '../../../../shared/contract/api';
import { PROPOSAL_LIMITS as L, PROPOSAL_CLASS_NAMES } from '../../../../shared/contract/proposals.ts';
import { IMPORT_KEY } from '../../../../shared/contract/routes.ts';
import { type AppEnv, guard, principalOf } from '../../http/auth';
import { callerOf, idParam, reqHash } from '../../http/caller';
import { ApiError } from '../../http/errors';
import { inSandbox } from '../../http/sandbox';
import { json, parse } from '../../http/validate';
import { UUIDV7 } from '../../lib/ids';
import { value } from '../../lib/result';
import { authObject } from '../../objects/auth';
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

const ROLE_LABEL: Record<AgentRole, string> = {
  'mind:chat': 'Mind · chat',
  'mind:night': 'Mind · night',
  'mind:reflex': 'Mind · reflex',
  muse: 'Muse',
  ci: 'CI',
};

function notImportKey(c: Context<AppEnv>): void {
  const p = principalOf(c);
  if (p.kind === 'agent' && p.name === IMPORT_KEY) throw new ApiError('forbidden');
}

/** The target line of a revoke card: the active key's name and role, from Auth (none: 422). */
async function agentLine(env: Env, id: unknown): Promise<string | null> {
  const a = (await authObject(env).agents()).find((k) => k.id === id);
  return a ? `key ${a.name} (${ROLE_LABEL[a.role]})` : null;
}

/** A card about a fact as reflex sees it: that it waits, never what it says. */
const withoutWords = (r: ProposalRow): ProposalRow =>
  r.ref?.startsWith('fact:')
    ? {
        ...r,
        question: '(a card about a fact)',
        why: '(not shown)',
        if_ignored: '(not shown)',
        options_json: '[]',
        target: null,
      }
    : r;

export const proposalsRoutes = new Hono<AppEnv>()
  .put('/proposals/:id', guard('PUT /v1/proposals/:id'), async (c) => {
    notImportKey(c);
    const id = idParam(c);
    const body = await json(c, putBody);
    // In the eval sandbox nothing reaches Auth: a revoke card names the id it was given.
    const target =
      body.spec.op !== 'agents.revoke'
        ? null
        : inSandbox()
          ? `key ${String(body.spec.args.agent_id).slice(0, 8)}… (not looked up: the eval sandbox)`
          : await agentLine(c.env, body.spec.args.agent_id);
    const core = coreObject(c.env);
    const out = value(await fresh(core.putProposal(callerOf(c), id, body, reqHash(body), target)));
    return c.json(out.proposal satisfies Proposal, out.created ? 201 : 200);
  })
  .get('/proposals', guard('GET /v1/proposals'), async (c) => {
    const q = parse(listQuery, c.req.query());
    const limit = q.limit ?? 50;
    const rows = await fresh(coreObject(c.env).proposals(q.status ?? 'waiting', q.cursor ?? null, limit));
    // Reflex reads no memory (RUNTIME.md §7.1): a card about a fact reaches it without its words.
    const p = principalOf(c);
    const reflex = p.kind === 'agent' && p.role === 'mind:reflex';
    const items = rows.map((r) => toProposal(reflex ? withoutWords(r as ProposalRow) : (r as ProposalRow)));
    const page: ProposalsResponse = { items, next: items.length === limit ? (items.at(-1)?.id ?? null) : null };
    // Sent as text: Hono's JSON typing recurses without end through the `Json` fields of a list.
    return c.body(JSON.stringify(page), 200, { 'Content-Type': 'application/json' });
  })
  .post('/proposals/:id/decide', guard('POST /v1/proposals/:id/decide'), async (c) => {
    notImportKey(c);
    const id = idParam(c);
    const body = await json(c, decideBody);
    const core = coreObject(c.env);
    const { after, ...out } = value(await fresh(core.decideProposal(callerOf(c), id, body)));
    if (!after) return c.json(out satisfies DecideProposalResponse);
    // An op of the Auth object: run it now; if Auth can't be reached, the card stays `approved`
    // and the cron runs it again. In the eval sandbox nothing outside it runs: it is recorded only.
    const ran = inSandbox()
      ? { ok: true as const, result: { sandbox: true }, what: 'nothing was run (the eval sandbox)' }
      : await runAfter(c.env, after);
    if (!ran) return c.json(out satisfies DecideProposalResponse);
    return c.json(value(await fresh(core.proposalRan(id, ran))) satisfies DecideProposalResponse);
  })
  .post('/proposals/:id/cancel', guard('POST /v1/proposals/:id/cancel'), async (c) => {
    notImportKey(c);
    const id = idParam(c);
    const { why } = await json(c, cancelBody);
    return c.json(value(await fresh(coreObject(c.env).cancelProposal(callerOf(c), id, why))));
  });

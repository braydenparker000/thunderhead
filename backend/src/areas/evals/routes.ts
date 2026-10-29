// /v1/evals (EVALS.md §1.1, §8): the eval sandbox's reset and report, answered only inside the
// sandbox (`TH-Sandbox: eval`, http/sandbox.ts), and the eval record, kept only in the owner's Core.
import { Hono } from 'hono';
import * as z from 'zod/mini';
import { EVAL_LIMITS, type EvalRun, type PutEvalRunRequest } from '../../../../shared/contract/evals.ts';
import { type AppEnv, guard } from '../../http/auth';
import { callerOf, idParam, reqHash } from '../../http/caller';
import { ApiError } from '../../http/errors';
import { inSandbox } from '../../http/sandbox';
import { json, parse } from '../../http/validate';
import { value } from '../../lib/result';
import { coreObject } from '../../objects/core';
import { fresh } from '../../objects/rpc';

const text = (max: number) => z.string().check(z.minLength(1), z.maxLength(max));
const ref = z.string().check(z.regex(/^[a-z0-9_-]{1,20}$/));
const seedRow = z.union([
  z.strictObject({ t: z.enum(['say', 'owner']), ref: z.optional(ref), body: text(2_000) }),
  z.strictObject({ t: z.enum(['muse', 'import']), body: text(2_000) }),
  z.strictObject({
    t: z.literal('add'),
    ref,
    kind: text(20),
    subject: text(80),
    text: text(280),
    evidence: z.array(ref).check(z.maxLength(10)),
  }),
  z.strictObject({
    t: z.literal('supersede'),
    of: ref,
    ref,
    text: text(280),
    evidence: z.array(ref).check(z.maxLength(10)),
  }),
  z.strictObject({ t: z.literal('forget'), of: ref }),
]);
const resetBody = z.strictObject({ seed: z.array(seedRow).check(z.maxLength(EVAL_LIMITS.seed_rows)) });
const ids = z.array(z.string().check(z.regex(/^[A-Z]{2,5}(-[A-Z0-9]{1,6})*-?[0-9]{0,4}$/))).check(z.maxLength(200));
const runBody = z.strictObject({
  id: z.string(),
  suite: z.enum(['INJ', 'LAW', 'MP', 'TONE', 'RT', 'META']),
  git_sha: z.string().check(z.regex(/^[0-9a-f]{7,40}$/)),
  n: z.number().check(z.int(), z.gte(0), z.lte(10_000)),
  passed: z.number().check(z.int(), z.gte(0), z.lte(10_000)),
  failures: ids,
  skipped: z.optional(ids),
  judged: z.optional(z.number().check(z.int(), z.gte(0), z.lte(10_000))),
}) satisfies z.ZodMiniType<PutEvalRunRequest>;
const runsQuery = z.object({
  suite: z.optional(z.enum(['INJ', 'LAW', 'MP', 'TONE', 'RT', 'META'])),
  limit: z.optional(z.coerce.number().check(z.int(), z.gte(1), z.lte(100))),
});

const onlyInSandbox = () => {
  if (!inSandbox()) throw new ApiError('validation', [{ path: 'TH-Sandbox', issue: 'only in the eval sandbox' }]);
};

export const evalsRoutes = new Hono<AppEnv>()
  .post('/evals/sandbox', guard('POST /v1/evals/sandbox'), async (c) => {
    onlyInSandbox();
    const { seed } = await json(c, resetBody);
    return c.json(value(await fresh(coreObject(c.env).evalReset(seed))));
  })
  .get('/evals/sandbox', guard('GET /v1/evals/sandbox'), async (c) => {
    onlyInSandbox();
    return c.json(value(await fresh(coreObject(c.env).evalReport())));
  })
  .put('/evals/runs/:id', guard('PUT /v1/evals/runs/:id'), async (c) => {
    if (inSandbox())
      throw new ApiError('validation', [{ path: 'TH-Sandbox', issue: 'the record is kept outside the sandbox' }]);
    const id = idParam(c);
    const body = await json(c, runBody);
    if (body.id !== id) throw new ApiError('validation', [{ path: 'id', issue: 'the path id' }]);
    const out = value(await fresh(coreObject(c.env).putEvalRun(callerOf(c), body, reqHash(body))));
    return c.json(out.run satisfies EvalRun, out.created ? 201 : 200);
  })
  .get('/evals/runs', guard('GET /v1/evals/runs'), async (c) => {
    const q = parse(runsQuery, c.req.query());
    return c.json({
      items: (await fresh(coreObject(c.env).evalRuns(q.suite ?? null, q.limit ?? 20))) satisfies EvalRun[],
    });
  });

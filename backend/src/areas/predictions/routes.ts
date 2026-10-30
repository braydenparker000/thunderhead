// /v1/predictions (P9, EVALS.md M-18): the night shift's predictions, kept under their own id;
// the list; and the skill per category, which the meter shows.
import { Hono } from 'hono';
import * as z from 'zod/mini';
import {
  type CategorySkill,
  PREDICTION_CATEGORIES,
  PREDICTION_LIMITS,
  type Prediction,
  type PutPredictionRequest,
} from '../../../../shared/contract/predictions.ts';
import { type AppEnv, guard } from '../../http/auth';
import { callerOf, idParam, reqHash } from '../../http/caller';
import { json, parse } from '../../http/validate';
import { value } from '../../lib/result';
import { coreObject } from '../../objects/core';
import { fresh } from '../../objects/rpc';

const categories = Object.keys(PREDICTION_CATEGORIES) as [keyof typeof PREDICTION_CATEGORIES];
const putBody = z.strictObject({
  category: z.enum(categories),
  args: z.record(z.string().check(z.maxLength(20)), z.union([z.string().check(z.maxLength(64)), z.number()])),
  day: z.string().check(z.regex(/^\d{4}-\d{2}-\d{2}$/)),
  p: z.number().check(
    z.gte(0.01),
    z.lte(0.99),
    z.refine((p) => Math.abs(p * 100 - Math.round(p * 100)) < 1e-9, 'two decimals'),
  ),
  why: z.string().check(z.minLength(1), z.maxLength(PREDICTION_LIMITS.why)),
}) satisfies z.ZodMiniType<PutPredictionRequest>;
const listQuery = z.object({
  open: z.optional(z.enum(['1', '0'])),
  limit: z.optional(z.coerce.number().check(z.int(), z.gte(1), z.lte(200))),
});

export const predictionsRoutes = new Hono<AppEnv>()
  .put('/predictions/:id', guard('PUT /v1/predictions/:id'), async (c) => {
    const id = idParam(c);
    const body = await json(c, putBody);
    return c.json(
      value(await fresh(coreObject(c.env).putPrediction(callerOf(c), id, body, reqHash(body)))) satisfies Prediction,
    );
  })
  .get('/predictions', guard('GET /v1/predictions'), async (c) => {
    const q = parse(listQuery, c.req.query());
    return c.json({
      items: (await fresh(coreObject(c.env).predictions(q.open === '1', q.limit ?? 50))) satisfies Prediction[],
    });
  })
  .get('/predictions/skill', guard('GET /v1/predictions/skill'), async (c) =>
    c.json({ categories: (await fresh(coreObject(c.env).predictionSkill())) satisfies CategorySkill[] }),
  );

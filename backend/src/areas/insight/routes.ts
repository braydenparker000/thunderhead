// /v1/insight (P9; EVALS.md §9): the meter on the Memory page, from Core's rows and the Senses
// object's rollups, counts only; and /v1/insight/topics, what lands per topic (BEHAVIOR.md §3.6),
// which runs the pass that may send a topic to rest.
import { Hono } from 'hono';
import type { TopicsResponse } from '../../../../shared/contract/lands.ts';
import type { InsightResponse } from '../../../../shared/contract/predictions.ts';
import { type AppEnv, guard } from '../../http/auth';
import { DAY } from '../../lib/time';
import { coreObject } from '../../objects/core';
import { fresh } from '../../objects/rpc';
import { sensesObject } from '../../objects/senses';
import { logicalDay } from '../conversation/day';
import { arrangements, corrections, METER_SENSES } from './meter';

export const insightRoutes = new Hono<AppEnv>()
  .get('/insight/topics', guard('GET /v1/insight/topics'), async (c) =>
    c.json((await fresh(coreObject(c.env).landsTopics())) satisfies TopicsResponse),
  )
  .get('/insight', guard('GET /v1/insight'), async (c) => {
    const now = Date.now();
    const m = await fresh(coreObject(c.env).meterInput(now));
    // A day before the oldest arrangement, through today; none when the Senses object can't answer.
    const senses = await sensesObject(c.env)
      .rollupsFor(METER_SENSES, logicalDay(now - 29 * DAY, m.tz), logicalDay(now, m.tz))
      .catch(() => []);
    return c.json({
      corrections: corrections(m.corrections, m.learned, now),
      memory: m.memory,
      arrangements: arrangements(m.arrangements, senses, now, m.tz),
      skill: m.skill,
    } satisfies InsightResponse);
  });

// /v1/briefing (BRIEFING.md §2–§6): what the Briefing page shows now (the weather asked of
// Open-Meteo again when the kept forecast is over 30 minutes old: at once when there is none, else
// while the page shows the kept one) and the weather's place by a town's name.
import { Hono } from 'hono';
import * as z from 'zod/mini';
import type { BriefingResponse } from '../../../../shared/contract/briefing.ts';
import { type AppEnv, deviceOf, guard } from '../../http/auth';
import { ApiError } from '../../http/errors';
import { inSandbox } from '../../http/sandbox';
import { json } from '../../http/validate';
import { coreObject } from '../../objects/core';
import { fresh } from '../../objects/rpc';
import { findPlace, forecastFor } from './weather';

const STALE_MS = 30 * 60_000;
const placeBody = z.object({ name: z.string().check(z.minLength(2), z.maxLength(80)) });

export const briefingRoutes = new Hono<AppEnv>()
  .get('/briefing', guard('GET /v1/briefing'), async (c) => {
    if (inSandbox()) throw new ApiError('validation', [{ path: 'TH-Sandbox', issue: 'the sandbox has no briefing' }]);
    const core = coreObject(c.env);
    const { place, forecast } = await core.weather();
    if (place && (!forecast || Date.now() - forecast.at > STALE_MS)) {
      const ask = forecastFor(place, Date.now())
        .then((f) => core.putForecast(place, f))
        .catch(() => {});
      if (forecast) c.executionCtx.waitUntil(ask);
      else await ask;
    }
    return c.json((await fresh(core.briefingNow())) as BriefingResponse);
  })
  .put('/briefing/place', guard('PUT /v1/briefing/place'), async (c) => {
    const { name } = await json(c, placeBody);
    const place = await findPlace(name.trim()).catch(() => {
      throw new ApiError('upstream');
    });
    if (!place) throw new ApiError('validation', [{ path: 'name', issue: 'No place by that name.' }]);
    const core = coreObject(c.env);
    await core.patchSettings({ 'weather.place': place }, `device:${deviceOf(c).session_id}`);
    await forecastFor(place, Date.now())
      .then((f) => core.putForecast(place, f))
      .catch(() => {});
    return c.json({ place: place.name });
  });

// /v1/briefing (BRIEFING.md §1–§6): what the Briefing page shows now (the weather asked of
// Open-Meteo again when the kept forecast is over 30 minutes old: at once when there is none, else
// while the page shows the kept one; the songs added in the last day from the Music object) and
// the weather's place by a town's name, with its country for the Holidays tile.
import { Hono } from 'hono';
import * as z from 'zod/mini';
import type { BriefingResponse } from '../../../../shared/contract/briefing.ts';
import { type AppEnv, deviceOf, guard } from '../../http/auth';
import { ApiError } from '../../http/errors';
import { inSandbox } from '../../http/sandbox';
import { json } from '../../http/validate';
import { DAY } from '../../lib/time';
import { coreObject } from '../../objects/core';
import { musicObject } from '../../objects/music';
import { fresh } from '../../objects/rpc';
import { findPlace, forecastFor, type Place } from './weather';

const STALE_MS = 30 * 60_000;
const placeBody = z.object({ name: z.string().check(z.minLength(2), z.maxLength(80)) });

/** A place kept before its country was asked (2026-11-02): the geocoder once more, by its name;
 * kept only when the answer is the same place (its rounded coordinates). */
async function countryOf(place: Place): Promise<string | null> {
  const p = await findPlace(place.name);
  return p && p.lat === place.lat && p.lon === place.lon ? p.country : null;
}

export const briefingRoutes = new Hono<AppEnv>()
  .get('/briefing', guard('GET /v1/briefing'), async (c) => {
    if (inSandbox()) throw new ApiError('validation', [{ path: 'TH-Sandbox', issue: 'the sandbox has no briefing' }]);
    const core = coreObject(c.env);
    // The day's songs come from the Music object; a Music that can't answer leaves them out.
    const songs = musicObject(c.env)
      .addedSince(Date.now() - DAY)
      .catch(() => null);
    const { place, forecast } = await core.weather();
    if (place && (!forecast || Date.now() - forecast.at > STALE_MS)) {
      const ask = Promise.all([
        forecastFor(place, Date.now()).then((f) => core.putForecast(place, f)),
        (await core.ownerCountry())
          ? null
          : countryOf(place).then((cc) => (cc ? core.backfillCountry(place, cc) : undefined)),
      ]).catch(() => {});
      if (forecast) c.executionCtx.waitUntil(ask);
      else await ask;
    }
    return c.json((await fresh(core.briefingNow(await songs))) as BriefingResponse);
  })
  .put('/briefing/place', guard('PUT /v1/briefing/place'), async (c) => {
    const { name } = await json(c, placeBody);
    const found = await findPlace(name.trim()).catch(() => {
      throw new ApiError('upstream');
    });
    if (!found) throw new ApiError('validation', [{ path: 'name', issue: 'No place by that name.' }]);
    const { country, ...place } = found;
    const core = coreObject(c.env);
    await core.setPlace(place, country, `device:${deviceOf(c).session_id}`);
    await forecastFor(place, Date.now())
      .then((f) => core.putForecast(place, f))
      .catch(() => {});
    return c.json({ place: place.name });
  });

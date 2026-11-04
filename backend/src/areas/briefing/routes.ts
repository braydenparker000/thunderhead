// /v1/briefing (BRIEFING.md §1–§6): what the Briefing page shows now (the weather asked of
// Open-Meteo again when the kept forecast is over 30 minutes old: at once when there is none, else
// while the page shows the kept one; the owner's calendar links the same way, at once for a link
// never tried, calendar.ts; the songs added in the last day from the Music object), the weather's
// place by a town's name, with its country for the Holidays tile, and the calendar's events for
// `th get` (each link by its host only); and the night's report, which night step 12 puts
// (report.ts).
import { Hono } from 'hono';
import * as z from 'zod/mini';
import { type BriefingResponse, CALENDAR_LIMITS, type CalendarResponse } from '../../../../shared/contract/briefing.ts';
import { NIGHT_REPORT_KINDS, type NightReport } from '../../../../shared/contract/night-report.ts';
import { type AppEnv, deviceOf, guard } from '../../http/auth';
import { callerOf, reqHash } from '../../http/caller';
import { ApiError } from '../../http/errors';
import { inSandbox } from '../../http/sandbox';
import { json, parse } from '../../http/validate';
import { value } from '../../lib/result';
import { DAY } from '../../lib/time';
import { coreObject } from '../../objects/core';
import { musicObject } from '../../objects/music';
import { fresh } from '../../objects/rpc';
import { refreshCalendars } from './calendar';
import { findPlace, forecastFor, type Place } from './weather';

const STALE_MS = 30 * 60_000;
const placeBody = z.object({ name: z.string().check(z.minLength(2), z.maxLength(80)) });
// The words' own limits are the contract's check (nightReportProblem), so th and the Worker agree.
const reportBody = z.strictObject({
  headline: z.string().check(z.maxLength(200)),
  lines: z
    .array(
      z.strictObject({
        kind: z.enum(NIGHT_REPORT_KINDS),
        text: z.string().check(z.maxLength(400)),
        ref: z.optional(z.nullable(z.string().check(z.maxLength(80)))),
      }),
    )
    .check(z.maxLength(12)),
});
const calendarQuery = z.object({
  days: z.optional(z.coerce.number().check(z.int(), z.gte(1), z.lte(CALENDAR_LIMITS.days))),
});

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
    const [{ place, forecast }, cal] = await Promise.all([core.weather(), core.calendarPlan()]);
    // What the page must wait for (nothing kept yet), and what may finish after it is answered.
    const now: Promise<unknown>[] = [];
    const later: Promise<unknown>[] = [];
    if (place && (!forecast || Date.now() - forecast.at > STALE_MS)) {
      const ask = Promise.all([
        forecastFor(place, Date.now()).then((f) => core.putForecast(place, f)),
        (await core.ownerCountry())
          ? null
          : countryOf(place).then((cc) => (cc ? core.backfillCountry(place, cc) : undefined)),
      ]).catch(() => {});
      (forecast ? later : now).push(ask);
    }
    const due = cal.links.filter((l) => l.due);
    if (due.length) {
      const ask = refreshCalendars(core, due, cal.tz, Date.now()).catch(() => {});
      (due.some((l) => l.fresh) ? now : later).push(ask);
    }
    if (later.length) c.executionCtx.waitUntil(Promise.all(later));
    await Promise.all(now);
    return c.json((await fresh(core.briefingNow(await songs))) as BriefingResponse);
  })
  .get('/briefing/calendar', guard('GET /v1/briefing/calendar'), async (c) => {
    if (inSandbox()) throw new ApiError('validation', [{ path: 'TH-Sandbox', issue: 'the sandbox has no calendar' }]);
    const q = parse(calendarQuery, c.req.query());
    return c.json((await fresh(coreObject(c.env).calendarList(q.days ?? 7))) as CalendarResponse);
  })
  .put('/briefing/report/:day', guard('PUT /v1/briefing/report/:day'), async (c) => {
    if (inSandbox()) throw new ApiError('validation', [{ path: 'TH-Sandbox', issue: 'the sandbox has no briefing' }]);
    const day = c.req.param('day');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || new Date(`${day}T12:00:00Z`).toISOString().slice(0, 10) !== day)
      throw new ApiError('validation', [{ path: 'day', issue: 'a calendar day, YYYY-MM-DD' }]);
    const body = await json(c, reportBody);
    const out = value(await coreObject(c.env).reportPut(callerOf(c), day, body, reqHash(body)));
    return c.json(out satisfies NightReport);
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

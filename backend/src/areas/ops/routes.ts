// /v1/health (public), /v1/ops (API.md §11.1, §11.16) and /v1/settings (§11.20).
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type {
  DeepHealthResponse,
  ErrorRow,
  HealthResponse,
  MeterResponse,
  Page,
  Settings,
  Version,
} from '../../../../shared/contract/api';
import { type AppEnv, guard, principalOf, whoOf } from '../../http/auth';
import { cachedMinClient, rememberMinClient } from '../../http/client-version';
import { ApiError } from '../../http/errors';
import { json, parse } from '../../http/validate';
import { decodeCursor, encodeCursor } from '../../lib/cursor';
import { utcDay } from '../../lib/time';
import { authObject } from '../../objects/auth';
import { coreObject } from '../../objects/core';
import { musicObject } from '../../objects/music';
import { sensesObject } from '../../objects/senses';
import { errorsBody, errorsQuery, meterQuery, perfBody, settingsPatch } from './schema';

export function version(env: Env): Version {
  return { id: env.VERSION.id, tag: env.VERSION.tag || null };
}

const tooLarge = (): never => {
  throw new ApiError('too_large');
};

const ACTOR: Record<string, string> = {
  D: 'owner',
  C: 'mind:chat',
  N: 'mind:night',
  R: 'mind:reflex',
  M: 'muse',
  I: 'ci',
};

export const opsRoutes = new Hono<AppEnv>()
  // Public and cheap: no object is touched. min_client is this isolate's cached value.
  .get('/health', (c) =>
    c.json({
      ok: true,
      version: version(c.env),
      min_client: cachedMinClient(),
      at: Date.now(),
    } satisfies HealthResponse),
  )
  // Counts only, never content (ci keys see the same).
  .get('/ops/health/deep', guard('GET /v1/ops/health/deep'), async (c) => {
    const [core, auth, music, senses, backup] = await Promise.all([
      coreObject(c.env).deepHealth(),
      authObject(c.env).health(),
      musicObject(c.env).health(),
      sensesObject(c.env).health(),
      // A Core still on the release before backups has no lastBackup: none yet.
      coreObject(c.env)
        .lastBackup()
        .catch(() => null),
    ]);
    const lastBackup = backup ? { date: backup.date, age_h: backup.age_h } : null;
    rememberMinClient(core.min_client);
    const objects = Object.fromEntries(
      Object.entries({ core, auth, music, senses }).map(([k, h]) => [
        k,
        {
          ok: h.schema >= h.expected,
          schema: h.schema,
          expected: h.expected,
          db_bytes: h.db_bytes,
          // A Core still on the release before the jobs table reports none.
          jobs_backlog: (h as { jobs_backlog?: number }).jobs_backlog ?? 0,
          last_alarm_at: null,
        },
      ]),
    );
    const body: DeepHealthResponse = {
      // From the first complete backup on, one older than 8 days is not ok (API.md §11.1).
      ok: Object.values(objects).every((o) => o.ok) && (lastBackup === null || lastBackup.age_h <= 8 * 24),
      version: version(c.env),
      schema: { core: core.schema, auth: auth.schema, music: music.schema, senses: senses.schema },
      objects,
      meter_today: {
        rows_written: core.rows_written + auth.rows_written + music.rows_written + senses.rows_written,
        rows_read: core.rows_read + auth.rows_read + music.rows_read + senses.rows_read,
        bulk_rows_written: 0,
        bulk_lane: null,
      },
      last_backup: lastBackup,
      last_events_export: null,
      errors_open: core.errors_open,
      wakes_today: core.wakes_today,
      min_client: core.min_client,
    };
    return c.json(body);
  })
  .post(
    '/ops/errors',
    guard('POST /v1/ops/errors'),
    bodyLimit({ maxSize: 32 * 1024, onError: tooLarge }),
    async (c) => {
      const { items } = await json(c, errorsBody);
      await coreObject(c.env).reportErrors(items);
      return c.body(null, 204);
    },
  )
  .get('/ops/errors', guard('GET /v1/ops/errors'), async (c) => {
    const q = parse(errorsQuery, c.req.query());
    const limit = q.limit ?? 50;
    const after = decodeCursor('ops/errors', q.cursor) as [number, string] | null;
    const items = await coreObject(c.env).listErrors(q.status !== 'resolved', limit, after, q.since ?? null);
    const last = items.at(-1);
    const next = items.length === limit && last ? encodeCursor('ops/errors', [last.last_at, last.fingerprint]) : null;
    return c.json({ items, next } satisfies Page<ErrorRow>);
  })
  .post('/ops/errors/:fp/resolve', guard('POST /v1/ops/errors/:fp/resolve'), async (c) => {
    const fp = c.req.param('fp');
    if (!/^[A-Za-z0-9._:-]{1,64}$/.test(fp) || !(await coreObject(c.env).resolveError(fp)))
      throw new ApiError('not_found');
    return c.body(null, 204);
  })
  .post('/ops/perf', guard('POST /v1/ops/perf'), async (c) => {
    await coreObject(c.env).putPerf(await json(c, perfBody));
    return c.body(null, 204);
  })
  // P1 has no meter table yet: today's in-memory counts per class (DATA.md §3).
  .get('/ops/meter', guard('GET /v1/ops/meter'), async (c) => {
    parse(meterQuery, c.req.query());
    const [core, auth, music, senses] = await Promise.all([
      coreObject(c.env).health(),
      authObject(c.env).health(),
      musicObject(c.env).health(),
      sensesObject(c.env).health(),
    ]);
    const day = utcDay(Date.now());
    const items = Object.entries({ core, auth, music, senses }).map(([cls, h]) => ({
      day,
      class: cls,
      rows_written: h.rows_written,
      rows_read: h.rows_read,
      bulk_rows_written: 0,
    }));
    return c.json({ items } satisfies MeterResponse);
  })
  .get('/settings', guard('GET /v1/settings'), async (c) => {
    return c.json((await coreObject(c.env).settings()) satisfies Settings);
  })
  .patch('/settings', guard('PATCH /v1/settings'), async (c) => {
    const patch = await json(c, settingsPatch);
    const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    if (Object.keys(clean).length === 0) throw new ApiError('validation', [{ path: '', issue: 'no settings given' }]);
    const changed = await coreObject(c.env).patchSettings(clean, ACTOR[whoOf(principalOf(c))]);
    if (typeof clean.min_client === 'number') rememberMinClient(clean.min_client);
    return c.json(changed);
  });

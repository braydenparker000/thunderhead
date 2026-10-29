// Request shapes for /v1/ops and /v1/settings (zod/mini), checked against the shared contract.
import * as z from 'zod/mini';
import type { ErrorReport, ErrorsRequest, PerfRequest, SettingsPatch } from '../../../../shared/contract/api';

const int = (min: number, max: number) => z.number().check(z.int(), z.gte(min), z.lte(max));
const MS = int(0, 8.64e15);

const report = z.object({
  fingerprint: z.optional(z.string().check(z.minLength(1), z.maxLength(64), z.regex(/^[A-Za-z0-9._:-]+$/))),
  source: z.enum(['client', 'csp', 'job']),
  route: z.optional(z.string().check(z.maxLength(200))),
  code: z.string().check(z.minLength(1), z.maxLength(60)),
  message: z.string().check(z.maxLength(300)),
  build: int(0, 1e9),
  at: MS,
  count: z.optional(int(1, 1e6)),
}) satisfies z.ZodMiniType<ErrorReport>;

export const errorsBody = z.object({
  items: z.array(report).check(z.minLength(1), z.maxLength(50)),
}) satisfies z.ZodMiniType<ErrorsRequest>;

export const errorsQuery = z.object({
  status: z.optional(z.enum(['open', 'resolved'])),
  since: z.optional(z.coerce.number().check(z.int(), z.gte(0))),
  limit: z.optional(z.coerce.number().check(z.int(), z.gte(1), z.lte(200))),
  cursor: z.optional(z.string().check(z.maxLength(200))),
});

export const meterQuery = z.object({
  days: z.optional(z.coerce.number().check(z.int(), z.gte(1), z.lte(30))),
});

const stat = z.object({ p50: z.number(), p75: z.number(), p95: z.number(), n: int(0, 1e9) });
const metric = z.optional(stat);

export const perfBody = z.object({
  day: z.string().check(z.regex(/^\d{4}-\d{2}-\d{2}$/)),
  build: int(0, 1e9),
  metrics: z.object({
    inp: metric,
    loaf_gesture: metric,
    start_warm: metric,
    start_cold: metric,
    api_ms: metric,
    heap_mb: metric,
  }),
}) satisfies z.ZodMiniType<PerfRequest>;

/** An IANA zone name this runtime knows. */
export function knownZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Only the keys P1 knows; anything else is 422. */
const hhmm = z.string().check(z.regex(/^([01]\d|2[0-3]):[0-5]\d$/));
export const settingsPatch = z.strictObject({
  'owner.tz': z.optional(z.string().check(z.maxLength(64), z.refine(knownZone, 'unknown time zone'))),
  min_client: z.optional(int(0, 1e9)),
  // Quiet hours (MENU-AND-SETTINGS.md §4.2): nothing that needs the owner before 06:30.
  'quiet.start': z.optional(hhmm),
  'quiet.end': z.optional(hhmm.check(z.refine((v) => v >= '06:30', 'not earlier than 06:30'))),
}) satisfies z.ZodMiniType<SettingsPatch>;

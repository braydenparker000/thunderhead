// /v1/guitar/progress (GUITAR.md §1.1, API.md §11.28): the owner's phone sends the songs whose
// progress it changed, 1–50 at a time (the newer `updated_at` wins), and asks what changed since it
// last asked (`?since=`, then `cursor` while there is more), oldest first. A PUT's items are checked
// one by one: one that can't be taken (malformed, too big, or its `updated_at` more than an hour
// ahead of the Worker's clock) is reported by its place in `refused` and the rest are kept. The
// owner's device only; nothing here writes the change feed.
import { Hono } from 'hono';
import * as z from 'zod/mini';
import {
  GUITAR_KEY,
  type GuitarPage,
  type GuitarProgress,
  type GuitarSyncResponse,
  GUITAR_LIMITS as L,
} from '../../../../shared/contract/guitar.ts';
import { type AppEnv, guard } from '../../http/auth';
import { ApiError } from '../../http/errors';
import { json, parse } from '../../http/validate';
import { decodeCursor, encodeCursor } from '../../lib/cursor';
import { value } from '../../lib/result';
import { coreObject } from '../../objects/core';
import { fresh } from '../../objects/rpc';

const ROUTE = 'guitar/progress';
type GuitarProgressPage = { rows: GuitarPage['items']; more: boolean; last: [number, string] | null; at: number };
const ms = z.number().check(z.int(), z.gte(1), z.lte(Number.MAX_SAFE_INTEGER));
const count = z.number().check(z.int(), z.gte(0), z.lte(1_000_000));
const day = z.string().check(z.regex(/^\d{4}-\d{2}-\d{2}$/));
const fewer = (n: number) => z.refine((o: unknown) => Object.keys(o as object).length <= n, `at most ${n} entries`);
const sectionDay = z.strictObject({ day, passes: count, clean: count, ceiling: count });
const progressItem = z.strictObject({
  key: z.string().check(z.maxLength(L.key_chars), z.regex(GUITAR_KEY)),
  song: z.nullable(z.record(z.string().check(z.maxLength(40)), z.unknown()).check(fewer(L.song_fields))),
  ladder: z
    .record(
      z.string().check(z.regex(/^\d{1,4}-\d{1,4}$/)),
      z.strictObject({ ...sectionDay.shape, best: count, last: z.nullable(sectionDay) }),
    )
    .check(fewer(L.sections_max)),
  days: z.record(day, z.number().check(z.gte(0), z.lte(86_400))).check(fewer(L.days_max)),
  phone_at: ms,
  updated_at: ms,
}) satisfies z.ZodMiniType<GuitarProgress>;

const batchBody = z.strictObject({
  items: z.array(z.unknown()).check(z.minLength(1), z.maxLength(L.batch_items)),
});

/** The items the Worker can take, and the rest by their place with why (the first issue only; never
 * the value). */
function sorted(raw: unknown[], now: number): { ok: GuitarProgress[]; refused: GuitarSyncResponse['refused'] } {
  const ok: GuitarProgress[] = [];
  const refused: GuitarSyncResponse['refused'] = [];
  raw.forEach((x, index) => {
    const r = progressItem.safeParse(x);
    if (!r.success) {
      const i = r.error.issues[0];
      refused.push({ index, issue: `${i?.path.join('.') || 'item'}: ${i?.message ?? 'invalid'}` });
    } else if (JSON.stringify(r.data).length > L.item_chars)
      refused.push({ index, issue: `item: more than ${L.item_chars} characters` });
    else if (r.data.updated_at > now + L.ahead_ms)
      refused.push({ index, issue: "updated_at: more than an hour ahead of the Worker's clock" });
    else ok.push(r.data as GuitarProgress);
  });
  return { ok, refused };
}

const pageQuery = z.object({
  since: z.optional(z.coerce.number().check(z.int(), z.gte(0))),
  limit: z.optional(z.coerce.number().check(z.int(), z.gte(1), z.lte(L.page_max))),
  cursor: z.optional(z.string().check(z.maxLength(4000))),
});

export const guitarSyncRoutes = new Hono<AppEnv>()
  .put('/guitar/progress', guard('PUT /v1/guitar/progress'), async (c) => {
    const { ok, refused } = sorted((await json(c, batchBody)).items, Date.now());
    return c.json(value(await fresh(coreObject(c.env).putGuitarProgress(ok, refused))));
  })
  .get('/guitar/progress', guard('GET /v1/guitar/progress'), async (c) => {
    const q = parse(pageQuery, c.req.query());
    const k = decodeCursor(ROUTE, q.cursor);
    if (k !== null && (k.length !== 2 || !Number.isSafeInteger(k[0]) || typeof k[1] !== 'string'))
      throw new ApiError('bad_request');
    const after: [number, string] = k ? [k[0] as number, k[1] as string] : [q.since ?? 0, ''];
    // (a record's `song` holds `unknown` fields, which the RPC stub's types cannot carry: the page is typed here)
    const p = (await fresh(
      coreObject(c.env).guitarProgress(after, q.limit ?? L.page_max),
    )) as unknown as GuitarProgressPage;
    return c.json({
      items: p.rows,
      next_since: p.at,
      next: p.more && p.last ? encodeCursor(ROUTE, p.last) : null,
    } satisfies GuitarPage);
  });

// /v1/podcasts/progress and /v1/podcasts/follows (NEXT-BATCH.md part 7, API.md §11.25): the phone
// sends the positions and follows it changed, 1–100 at a time (the newer `updated_at` wins), and
// asks what changed since it last asked (`?since=`, then `cursor` while there is more), oldest
// first. A PUT's items are checked one by one: one that can't be taken (malformed, or its
// `updated_at` more than an hour ahead of the Worker's clock) is reported by its place in
// `refused` and the rest are kept. The night reads both (the follows with its last check of each
// show) and records the shows it read; a mind session that reads them is marked tainted first
// (taint.ts: feed addresses and show titles are their publishers' words). Nothing here writes the
// change feed: the phones ask by time when Podcasts opens.
import { Hono } from 'hono';
import * as z from 'zod/mini';
import {
  feedProblem,
  PODCAST_LIMITS as L,
  type PodcastCheckedRequest,
  type PodcastFollow,
  type PodcastPage,
  type PodcastProgress,
  type PodcastSyncResponse,
  progressKeyProblem,
} from '../../../../shared/contract/podcasts.ts';
import { type AppEnv, guard } from '../../http/auth';
import { ApiError } from '../../http/errors';
import { json, parse } from '../../http/validate';
import { decodeCursor, encodeCursor } from '../../lib/cursor';
import { value } from '../../lib/result';
import { coreObject } from '../../objects/core';
import { fresh } from '../../objects/rpc';
import { taintMindReader } from './taint';

const seconds = z.number().check(z.gte(0), z.lte(L.seconds_max));
const ms = z.number().check(z.int(), z.gte(1), z.lte(Number.MAX_SAFE_INTEGER));
const feedUrl = z.string().check(
  z.maxLength(L.url_chars),
  z.refine((u) => feedProblem(u) === null, 'an http(s) feed address'),
);
/** A PUT's body: 1–100 items, each checked on its own (`sorted`). */
const batchBody = z.strictObject({
  items: z.array(z.unknown()).check(z.minLength(1), z.maxLength(L.batch_items)),
});

const progressItem = z.strictObject({
  key: z.string().check(
    z.maxLength(L.url_chars + 1 + L.id_chars),
    z.refine((k) => progressKeyProblem(k) === null, 'a <feed address>#<episode id> key'),
  ),
  position_s: seconds,
  duration_s: seconds,
  played: z.boolean(),
  updated_at: ms,
}) satisfies z.ZodMiniType<PodcastProgress>;

const followItem = z.strictObject({
  feed_url: feedUrl,
  title: z.string().check(z.maxLength(L.title_chars)),
  author: z.string().check(z.maxLength(L.author_chars)),
  artwork: z.union([z.literal(''), feedUrl]),
  followed: z.boolean(),
  updated_at: ms,
}) satisfies z.ZodMiniType<PodcastFollow>;

/** The items the Worker can take, and the rest by their place with why (the first issue only; never
 * the value). */
function sorted<T extends { updated_at: number }>(
  raw: unknown[],
  item: z.ZodMiniType<T>,
  now: number,
): { ok: T[]; refused: PodcastSyncResponse['refused'] } {
  const ok: T[] = [];
  const refused: PodcastSyncResponse['refused'] = [];
  raw.forEach((x, index) => {
    const r = item.safeParse(x);
    if (!r.success) {
      const i = r.error.issues[0];
      refused.push({ index, issue: `${i?.path.join('.') || 'item'}: ${i?.message ?? 'invalid'}` });
    } else if (r.data.updated_at > now + L.ahead_ms)
      refused.push({ index, issue: "updated_at: more than an hour ahead of the Worker's clock" });
    else ok.push(r.data);
  });
  return { ok, refused };
}

const checkedBody = z.strictObject({
  items: z
    .array(
      z.strictObject({
        feed_url: feedUrl,
        latest_at: z.nullable(ms),
        new_n: z.number().check(z.int(), z.gte(0), z.lte(200)),
        failed: z.optional(z.boolean()),
      }),
    )
    .check(z.minLength(1), z.maxLength(L.night_feeds)),
}) satisfies z.ZodMiniType<PodcastCheckedRequest>;

const pageQuery = z.object({
  since: z.optional(z.coerce.number().check(z.int(), z.gte(0))),
  limit: z.optional(z.coerce.number().check(z.int(), z.gte(1), z.lte(L.page_max))),
  cursor: z.optional(z.string().check(z.maxLength(4000))),
});

/** Where a page starts: the cursor this route wrote (the last row's `[synced_at, key]`), else
 * `since` (every row taken at or after it: keys are never empty). */
function startOf(route: string, raw: Record<string, string>): { after: [number, string]; limit: number } {
  const q = parse(pageQuery, raw);
  const k = decodeCursor(route, q.cursor);
  if (k !== null && (k.length !== 2 || !Number.isSafeInteger(k[0]) || typeof k[1] !== 'string'))
    throw new ApiError('bad_request');
  return { after: k ? [k[0] as number, k[1] as string] : [q.since ?? 0, ''], limit: q.limit ?? L.page_max };
}

// (Through RPC the last row's `[synced_at, key]` arrives as a plain array.)
function pageOut<T>(route: string, p: { rows: T[]; more: boolean; last: (number | string)[] | null; at: number }) {
  return {
    items: p.rows,
    next_since: p.at,
    next: p.more && p.last ? encodeCursor(route, p.last) : null,
  } satisfies PodcastPage<T>;
}

export const podcastSyncRoutes = new Hono<AppEnv>()
  .put('/podcasts/progress', guard('PUT /v1/podcasts/progress'), async (c) => {
    const { ok, refused } = sorted((await json(c, batchBody)).items, progressItem, Date.now());
    return c.json(value(await fresh(coreObject(c.env).putPodcastProgress(ok, refused))));
  })
  .get('/podcasts/progress', guard('GET /v1/podcasts/progress'), async (c) => {
    const { after, limit } = startOf('podcasts/progress', c.req.query());
    await taintMindReader(c);
    return c.json(pageOut('podcasts/progress', await fresh(coreObject(c.env).podcastProgress(after, limit))));
  })
  .put('/podcasts/follows', guard('PUT /v1/podcasts/follows'), async (c) => {
    const { ok, refused } = sorted((await json(c, batchBody)).items, followItem, Date.now());
    return c.json(value(await fresh(coreObject(c.env).putPodcastFollows(ok, refused))));
  })
  .get('/podcasts/follows', guard('GET /v1/podcasts/follows'), async (c) => {
    const { after, limit } = startOf('podcasts/follows', c.req.query());
    await taintMindReader(c);
    return c.json(pageOut('podcasts/follows', await fresh(coreObject(c.env).podcastFollows(after, limit))));
  })
  .post('/podcasts/follows/checked', guard('POST /v1/podcasts/follows/checked'), async (c) => {
    const r = await json(c, checkedBody);
    return c.json(value(await fresh(coreObject(c.env).podcastsChecked(r.items))));
  });

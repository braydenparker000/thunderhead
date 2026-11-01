// /v1/podcasts/progress and /v1/podcasts/follows (NEXT-BATCH.md part 7, API.md §11.25): the phone
// sends the positions and follows it changed, 1–100 at a time (the newer `updated_at` wins), and
// asks what changed since it last asked (`?since=`, then `cursor` while there is more), oldest
// first. The night reads both (the follows with its last check of each show) and records the shows
// it read. Nothing here writes the change feed: the phones ask by time when Podcasts opens.
import { Hono } from 'hono';
import * as z from 'zod/mini';
import {
  feedProblem,
  PODCAST_LIMITS as L,
  type PodcastCheckedRequest,
  type PodcastFollowsRequest,
  type PodcastPage,
  type PodcastProgressRequest,
  progressKeyProblem,
} from '../../../../shared/contract/podcasts.ts';
import { type AppEnv, guard } from '../../http/auth';
import { ApiError } from '../../http/errors';
import { json, parse } from '../../http/validate';
import { decodeCursor, encodeCursor } from '../../lib/cursor';
import { value } from '../../lib/result';
import { coreObject } from '../../objects/core';
import { fresh } from '../../objects/rpc';

const seconds = z.number().check(z.gte(0), z.lte(L.seconds_max));
const ms = z.number().check(z.int(), z.gte(1), z.lte(Number.MAX_SAFE_INTEGER));
const feedUrl = z.string().check(
  z.maxLength(L.url_chars),
  z.refine((u) => feedProblem(u) === null, 'an http(s) feed address'),
);
const items = <T extends z.ZodMiniType>(item: T) =>
  z.strictObject({ items: z.array(item).check(z.minLength(1), z.maxLength(L.batch_items)) });

const progressBody = items(
  z.strictObject({
    key: z.string().check(
      z.maxLength(L.url_chars + 1 + L.id_chars),
      z.refine((k) => progressKeyProblem(k) === null, 'a <feed address>#<episode id> key'),
    ),
    position_s: seconds,
    duration_s: seconds,
    played: z.boolean(),
    updated_at: ms,
  }),
) satisfies z.ZodMiniType<PodcastProgressRequest>;

const followsBody = items(
  z.strictObject({
    feed_url: feedUrl,
    title: z.string().check(z.maxLength(L.title_chars)),
    author: z.string().check(z.maxLength(L.author_chars)),
    artwork: z.union([z.literal(''), feedUrl]),
    followed: z.boolean(),
    updated_at: ms,
  }),
) satisfies z.ZodMiniType<PodcastFollowsRequest>;

const checkedBody = z.strictObject({
  items: z
    .array(
      z.strictObject({
        feed_url: feedUrl,
        latest_at: z.nullable(ms),
        new_n: z.number().check(z.int(), z.gte(0), z.lte(200)),
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
    const r = await json(c, progressBody);
    return c.json(value(await fresh(coreObject(c.env).putPodcastProgress(r.items))));
  })
  .get('/podcasts/progress', guard('GET /v1/podcasts/progress'), async (c) => {
    const { after, limit } = startOf('podcasts/progress', c.req.query());
    return c.json(pageOut('podcasts/progress', await fresh(coreObject(c.env).podcastProgress(after, limit))));
  })
  .put('/podcasts/follows', guard('PUT /v1/podcasts/follows'), async (c) => {
    const r = await json(c, followsBody);
    return c.json(value(await fresh(coreObject(c.env).putPodcastFollows(r.items))));
  })
  .get('/podcasts/follows', guard('GET /v1/podcasts/follows'), async (c) => {
    const { after, limit } = startOf('podcasts/follows', c.req.query());
    return c.json(pageOut('podcasts/follows', await fresh(coreObject(c.env).podcastFollows(after, limit))));
  })
  .post('/podcasts/follows/checked', guard('POST /v1/podcasts/follows/checked'), async (c) => {
    const r = await json(c, checkedBody);
    return c.json(value(await fresh(coreObject(c.env).podcastsChecked(r.items))));
  });

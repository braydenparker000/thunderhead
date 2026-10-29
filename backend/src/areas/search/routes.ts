// GET /v1/search (API.md §11.7): `sources` names the stores to ask (default: every built source the
// caller may read); `kind` is kept as an alias for a single source. Items carry their `source`.
// The semantic seam (sources.ts `SEMANTIC`) adds its ranked list when one is plugged in.
import { Hono } from 'hono';
import * as z from 'zod/mini';
import type { SearchResponse } from '../../../../shared/contract/api';
import type { SearchSource } from '../../../../shared/contract/feed.ts';
import { type AppEnv, guard, principalOf, whoOf } from '../../http/auth';
import { ApiError } from '../../http/errors';
import { parse } from '../../http/validate';
import { ftsMatch, fuse, plain, SEMANTIC, SOURCE_NAMES, SOURCES } from './sources';

const ms = z.optional(z.coerce.number().check(z.int(), z.gte(0)));
const query = z.object({
  q: z.string().check(z.minLength(1), z.maxLength(200)),
  sources: z.optional(z.string().check(z.maxLength(200))),
  kind: z.optional(z.string().check(z.maxLength(40))),
  since: ms,
  until: ms,
  thread: z.optional(z.string().check(z.regex(/^[0-9a-f-]{36}$/))),
  limit: z.optional(z.coerce.number().check(z.int(), z.gte(1), z.lte(50))),
});

export const searchRoutes = new Hono<AppEnv>().get('/search', guard('GET /v1/search'), async (c) => {
  const q = parse(query, c.req.query());
  const asked = (q.sources ?? q.kind ?? '').split(',').filter(Boolean) as SearchSource[];
  for (const s of asked)
    if (!SOURCE_NAMES.includes(s))
      throw new ApiError('validation', [{ path: 'sources', issue: `unknown source ${s}` }]);
  const match = ftsMatch(q.q);
  if (!match) throw new ApiError('validation', [{ path: 'q', issue: 'no search terms' }]);
  const who = whoOf(principalOf(c));
  const names = (asked.length ? asked : SOURCE_NAMES).filter((s) => SOURCES[s]?.who.includes(who));
  const limit = q.limit ?? 20;
  const sq = {
    match,
    text: plain(q.q),
    since: q.since ?? null,
    until: q.until ?? null,
    thread: q.thread ?? null,
    limit,
  };
  const lists = await Promise.all([
    ...names.map((s) => SOURCES[s]?.run(c.env, sq) ?? Promise.resolve([])),
    // Semantic recall (P8) is one more ranked list over the same sources, fused like the rest.
    ...(SEMANTIC.recall && names.length ? [SEMANTIC.recall.run(c.env, sq, names)] : []),
  ]);
  return c.json({ items: fuse(lists, limit) } satisfies SearchResponse);
});

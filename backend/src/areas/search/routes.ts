// GET /v1/search (API.md §11.7): `sources` names the stores to ask (default: every built source the
// caller may read); `kind` is kept as an alias for a single source. Items carry their `source`.
// Recall by meaning (sources.ts `SEMANTIC`, semantic.ts) adds its ranked list, Study's pages among
// its sources (`library`); it fails open, so FTS alone answers when it can't. A mind
// session gets a memory hit labelled `outside` kept back unless it asks (`outside=1`, which marks
// it: MEMORY.md §6 M11f, memory/outside-read.ts).
import { Hono } from 'hono';
import * as z from 'zod/mini';
import type { SearchResponse } from '../../../../shared/contract/api';
import type { SearchSource } from '../../../../shared/contract/feed.ts';
import { type AppEnv, guard, principalOf, whoOf } from '../../http/auth';
import { ApiError } from '../../http/errors';
import { parse } from '../../http/validate';
import { keptHit, outsideHit } from '../memory/kept';
import { served } from '../memory/outside-read';
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
  outside: z.optional(z.enum(['true', 'false', '1', '0'])),
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
  // By meaning, Study's pages too (they have no FTS source here yet: GET /v1/library/search).
  const meant = (asked.length ? asked : SOURCE_NAMES).filter((s) => names.includes(s) || s === 'library');
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
    ...(SEMANTIC.recall && meant.length ? [SEMANTIC.recall.run(c.env, sq, meant)] : []),
  ]);
  return c.json({ items: await served(c, fuse(lists, limit), keptHit, outsideHit) } satisfies SearchResponse);
});

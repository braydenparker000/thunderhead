// Federated search (MEMORY.md §10, API.md §11.7): one query shape, many sources. P2 has one
// source, the conversation's FTS5 index in Core; facts, day notes, the library and semantic
// recall register here in their phases, each with its own store (and object, if it has one).
// Hits are merged by reciprocal-rank fusion (k = 60), so scores are comparable across sources
// whatever each store's native ranking is.
import type { SearchHit } from '../../../../shared/contract/api';
import { SEARCH_SOURCES, type SearchSource } from '../../../../shared/contract/feed.ts';
import type { Who } from '../../../../shared/contract/routes.ts';
import { coreObject } from '../../objects/core';

export interface SourceQuery {
  match: string;
  since: number | null;
  until: number | null;
  thread: string | null;
  limit: number;
}

export interface Source {
  who: Who[];
  run(env: Env, q: SourceQuery): Promise<Omit<SearchHit, 'score'>[]>;
}

/** The built sources; a name in SEARCH_SOURCES without an entry here returns nothing yet. */
export const SOURCES: Partial<Record<SearchSource, Source>> = {
  messages: {
    who: ['D', 'C', 'N'],
    async run(env, q) {
      const rows = await coreObject(env).searchMessages(q.match, q.since, q.until, q.thread, q.limit);
      return rows.map((r) => ({
        source: 'messages',
        ref: `msg:${r.id}`,
        snippet: r.snippet,
        at: r.created_at,
        thread_id: r.thread_id,
      }));
    },
  },
};

export const SOURCE_NAMES = Object.keys(SEARCH_SOURCES) as SearchSource[];

/** Every user term quoted and joined, so FTS operators in the input are inert (≤ 12 terms). */
export function ftsMatch(q: string): string | null {
  const terms = q
    .slice(0, 200)
    .split(/\s+/)
    .map((t) => t.replace(/"/g, ''))
    .filter(Boolean)
    .slice(0, 12);
  return terms.length ? terms.map((t) => `"${t}"`).join(' ') : null;
}

const K = 60;

/** Reciprocal-rank fusion over each source's ranked list; ties by recency. */
export function fuse(lists: Omit<SearchHit, 'score'>[][], limit: number): SearchHit[] {
  const scored = new Map<string, SearchHit>();
  for (const list of lists)
    list.forEach((hit, rank) => {
      const prev = scored.get(hit.ref);
      const score = (prev?.score ?? 0) + 1 / (K + rank + 1);
      scored.set(hit.ref, { ...hit, score: Math.round(score * 1e6) / 1e6 });
    });
  return [...scored.values()].sort((a, b) => b.score - a.score || b.at - a.at).slice(0, limit);
}

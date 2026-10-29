// Federated search (MEMORY.md §10, API.md §11.7): one query shape, many sources. Messages (P2),
// facts and day notes (P3) are FTS5 indexes in Core; the library registers here in its phase,
// each source with its own store (and object, if it has one). Semantic recall (P8, embeddings)
// plugs in behind the same route as `SEMANTIC`: it gets the plain query text and returns ranked
// hits like any source. Hits are merged by reciprocal-rank fusion (k = 60), so scores are
// comparable across sources whatever each store's native ranking is.
import type { SearchHit } from '../../../../shared/contract/api';
import { SEARCH_SOURCES, type SearchSource } from '../../../../shared/contract/feed.ts';
import type { Who } from '../../../../shared/contract/routes.ts';
import { coreObject } from '../../objects/core';
import { fresh } from '../../objects/rpc';

export interface SourceQuery {
  /** The FTS5 expression (`ftsMatch`): every term quoted. */
  match: string;
  /** The query as typed, control characters removed: what a semantic source embeds. */
  text: string;
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
  facts: {
    who: ['D', 'C', 'N'],
    async run(env, q) {
      // Facts belong to no thread: a thread facet asks for messages only.
      if (q.thread) return [];
      const rows = await fresh(coreObject(env).searchFacts(q.match, q.since, q.until, q.limit));
      return rows.map((r) => ({ source: 'facts', ref: `fact:${r.id}`, snippet: r.snippet, at: r.recorded_at }));
    },
  },
  day_notes: {
    who: ['D', 'C', 'N'],
    async run(env, q) {
      if (q.thread) return [];
      const rows = await fresh(coreObject(env).searchDayNotes(q.match, q.since, q.until, q.limit));
      return rows.map((r) => ({ source: 'day_notes', ref: `day:${r.day}`, snippet: r.snippet, at: r.written_at }));
    },
  },
};

/** The semantic-recall seam (MEMORY.md §10.6, P8): one ranked list over the asked sources, fused
 * with the FTS lists. Null until embeddings pass their eval (EVALS.md §3.4); a test plugs in a
 * fake to prove the fusion. */
export interface SemanticRecall {
  run(env: Env, q: SourceQuery, sources: SearchSource[]): Promise<Omit<SearchHit, 'score'>[]>;
}
export const SEMANTIC: { recall: SemanticRecall | null } = { recall: null };

export const SOURCE_NAMES = Object.keys(SEARCH_SOURCES) as SearchSource[];

/** The query without control characters (NUL among them): FTS5 refuses them. ≤ 200 chars. */
export function plain(q: string): string {
  return (
    q
      .slice(0, 200)
      // biome-ignore lint/suspicious/noControlCharactersInRegex: removing them is the point
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .trim()
  );
}

/** Every user term quoted and joined, so FTS operators in the input are inert (≤ 12 terms).
 * Control characters (NUL among them) are dropped first: FTS5 refuses them. */
export function ftsMatch(q: string): string | null {
  const terms = plain(q)
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

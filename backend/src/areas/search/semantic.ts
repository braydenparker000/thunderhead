// Recall by meaning (MEMORY.md §10.6, P8): the `SEMANTIC` seam of the federated search, plugged in.
// The query is embedded (one model call, a few seconds at most), the Library object answers the
// nearest indexed rows of the asked sources (brute-force cosine), and Core says which of them still
// stand, so a forgotten fact, a deleted or held conversation or a superseded version never comes
// back by meaning. Facets apply as they do to FTS (`since`, `until`; a thread facet keeps that
// thread's messages). Its list is fused with the FTS lists by rank (routes.ts). No binding, a
// failure, a refusal, the deadline or a day over the free tier's quota: no list, and FTS answers
// alone, never an error to the caller.
import type { SearchHit } from '../../../../shared/contract/api';
import { coreObject } from '../../objects/core';
import { libraryObject } from '../../objects/library';
import { fresh } from '../../objects/rpc';
import { aiOf } from '../files/transcribe';
import { embed, QUERY_MS } from './embed';
import type { SemanticRecall } from './sources';

/** Hits the recall returns, and candidates it asks the Library for (some may no longer stand). */
export const RECALL_HITS = 20;
const CANDIDATES = 30;

export const semanticRecall: SemanticRecall = {
  async run(env, q, sources) {
    const ai = aiOf(env);
    if (!ai || !q.text) return [];
    try {
      const [query] = await embed(ai, [q.text], QUERY_MS);
      const near = (await fresh(libraryObject(env).recall(query, sources, CANDIDATES))).filter(
        (h) => (q.since === null || h.at >= q.since) && (q.until === null || h.at < q.until),
      );
      const core = near.filter((h) => h.source !== 'library').map((h) => h.ref);
      const live: Record<string, string | null> = core.length ? await fresh(coreObject(env).recallLive(core)) : {};
      const hits: Omit<SearchHit, 'score'>[] = [];
      for (const h of near) {
        if (h.source !== 'library' && !Object.hasOwn(live, h.ref)) continue;
        const thread = live[h.ref] ?? null;
        if (q.thread && thread !== q.thread) continue;
        hits.push({
          source: h.source as SearchHit['source'],
          ref: h.ref,
          snippet: h.snippet,
          at: h.at,
          ...(thread ? { thread_id: thread } : {}),
          ...(h.provenance ? { provenance: h.provenance as SearchHit['provenance'] } : {}),
        });
      }
      return hits.slice(0, RECALL_HITS);
    } catch {
      return [];
    }
  },
};

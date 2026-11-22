// The memories that come with an owner message (mind-brief.ts RECALL_LIMITS): which search hits may
// go with it. Both the handout of GET /v1/live/wait (handout.ts) and the briefing's waiting messages
// (mind/brief-recall.ts) pick with this. Never the message's own conversation (today's messages are
// in front of the session already), never a memory labelled outside (a session's rules keep those
// back unless it asks), never a message off the record (they have no search entry: held.ts). Pure.
import type { RecallItem, SearchHit } from '../../../../shared/contract/api';
import { RECALL_LIMITS } from '../../../../shared/contract/mind-brief';

type Hit = Omit<SearchHit, 'score'>;

/** Whether a message gets a search at all: long enough, and not off the record. */
export const wantsRecall = (body: string, threadId: string, offRecord: readonly string[]) =>
  body.trim().length >= RECALL_LIMITS.min_chars && !offRecord.includes(threadId);

/** A memory labelled outside: a fact or a day note written after outside text (memory/kept.ts). */
const outside = (h: Hit) => h.provenance === 'outside' && (h.source === 'facts' || h.source === 'day_notes');

/** The hits (already ranked) as recall items: at most `limit`, each text ≤ 200 characters. */
export function pickRecall(hits: Hit[], ownThread: string, limit: number = RECALL_LIMITS.items): RecallItem[] {
  const out: RecallItem[] = [];
  const seen = new Set<string>();
  for (const h of hits) {
    if (out.length >= limit) break;
    if (seen.has(h.ref) || outside(h)) continue;
    if (h.source === 'messages' && (h.thread_id ?? null) === ownThread) continue;
    seen.add(h.ref);
    const text = h.snippet.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    out.push({ ref: h.ref, kind: h.source, text: [...text].slice(0, RECALL_LIMITS.text).join('') });
  }
  return out;
}

// The memories beside each waiting message in the briefing's part 1 (brief-parts.ts): up to 3 per
// message, picked as the handout picks them (feed/recall.ts), from the words' half of the search `th
// recall` runs (FTS over messages, facts and day notes, read here in Core: the meaning search runs in
// the Worker and is not in the briefing). The newest 10 waiting messages at most, so a long queue
// costs a bounded number of reads. None for reflex, off the record, or a message under 12 characters.
import type { Message, MindRole, RecallItem, SearchHit } from '../../../../shared/contract/api';
import { BRIEF_PARTS } from '../../../../shared/contract/mind-brief';
import type { Db } from '../../objects/base';
import { searchMessages } from '../conversation/search';
import { pickRecall, wantsRecall } from '../feed/recall';
import { searchDayNotes } from '../memory/notes';
import { searchFacts } from '../memory/store';
import { ftsMatch, fuse } from '../search/sources';

const NEWEST = 10;
const HITS = 6;

/** Each waiting message's id → its recall lines (none when it gets none). */
export function waitingRecall(
  db: Db,
  role: MindRole,
  waiting: Message[],
  offRecord: string[],
): Record<string, RecallItem[]> {
  const out: Record<string, RecallItem[]> = {};
  if (role !== 'chat') return out;
  for (const m of waiting.slice(-NEWEST)) {
    if (!wantsRecall(m.body, m.thread_id, offRecord)) continue;
    const match = ftsMatch(m.body);
    if (!match) continue;
    try {
      const lists: Omit<SearchHit, 'score'>[][] = [
        searchMessages(db, match, null, null, null, HITS).map((r) => ({
          source: 'messages',
          ref: `msg:${r.id}`,
          snippet: r.snippet,
          at: r.created_at,
          thread_id: r.thread_id,
        })),
        searchFacts(db, match, null, null, HITS).map((r) => ({
          source: 'facts',
          ref: `fact:${r.id}`,
          snippet: r.snippet,
          at: r.recorded_at,
          provenance: r.provenance,
        })),
        searchDayNotes(db, match, null, null, HITS).map((r) => ({
          source: 'day_notes',
          ref: `day:${r.day}`,
          snippet: r.snippet,
          at: r.written_at,
          provenance: r.provenance,
        })),
      ];
      const items = pickRecall(fuse(lists, 12), m.thread_id, BRIEF_PARTS.waiting_recall);
      if (items.length) out[m.id] = items;
    } catch {
      // A search that fails leaves the message without memories; the briefing still comes.
    }
  }
  return out;
}

/** A recall item as one briefing line under its message. */
export const recallLine = (r: RecallItem) => `  recall [${r.ref}] ${r.text}`;

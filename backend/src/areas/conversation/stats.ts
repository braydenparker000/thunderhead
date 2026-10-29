// Deterministic counts of a day's conversation (MEMORY.md §2 `day_notes.stats_json`, RUNTIME.md
// §12 step 1): messages of the day's thread by author, read through `messages_thread_seq`.
import type { Db } from '../../objects/base';
import { dailyThread } from './store';

export function dayCounts(db: Db, day: string): Record<string, number> {
  const t = dailyThread(db, day);
  const out: Record<string, number> = { messages: 0, owner: 0, mind: 0, system: 0, muse: 0 };
  if (!t) return out;
  for (const r of db.all<{ author: string; n: number }>(
    'SELECT author, count(*) AS n FROM messages WHERE thread_id = ? GROUP BY author',
    t.id,
  )) {
    out.messages += r.n;
    if (Object.hasOwn(out, r.author)) out[r.author] = r.n;
  }
  return out;
}

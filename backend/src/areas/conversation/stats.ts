// Deterministic counts of a day's conversation (MEMORY.md §2 `day_notes.stats_json`, RUNTIME.md
// §12 step 1): messages of the day's thread by author, read through `messages_thread_seq`; and
// when a logical day was open, which bounds the night's read of that day's ledger and notes.
import { dayBefore, zonedInstant } from '../../lib/time';
import type { Db } from '../../objects/base';
import { DAY_STARTS_HOUR } from './day';
import { dailyThread } from './store';

/** From the roll that opened `day` to the one that closed it (each day's thread is filed at its
 * roll); a roll not recorded falls back to 04:00 owner-local, and an open day ends `now`. */
export function dayOpen(db: Db, day: string, tz: string, now: number, current: string): { from: number; to: number } {
  const before = db.one<{ filed_at: number | null }>(
    "SELECT filed_at FROM threads WHERE kind = 'daily' AND day < ? ORDER BY day DESC LIMIT 1",
    day,
  );
  const own = dailyThread(db, day);
  const from = before?.filed_at ?? zonedInstant(day, DAY_STARTS_HOUR, tz);
  const next = dayBefore(day, -1);
  const to = own?.filed_at ?? (day >= current ? now : zonedInstant(next, DAY_STARTS_HOUR, tz));
  return { from, to: Math.max(from, to) };
}

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

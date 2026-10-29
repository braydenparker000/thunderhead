// Deterministic counts of a day's conversation (MEMORY.md §2 `day_notes.stats_json`, RUNTIME.md
// §12 step 1): messages of the day's thread by author, read through `messages_thread_seq`; and
// when a logical day was open, which bounds the night's read of that day's ledger and notes; and
// when the open day's thread last spoke, for the roll's quiet hour.
import { dayBefore, zonedInstant } from '../../lib/time';
import type { Db } from '../../objects/base';
import { DAY_STARTS_HOUR } from './day';
import { dailyThread } from './store';

/** When a thread last had a message, by seq on `messages_thread_seq` (one row). The day roll's
 * quiet hour asks it of the open daily thread only: imported messages come later by seq with their
 * old times, and must not make a live conversation look quiet. */
export function lastMessageAt(db: Db, threadId: string | null): number | null {
  const q = 'SELECT created_at AS at FROM messages WHERE thread_id = ? ORDER BY seq DESC LIMIT 1';
  return threadId === null ? null : (db.one<{ at: number }>(q, threadId)?.at ?? null);
}

/** From the roll that opened `day` to the one that closed it (each day's thread is filed at its
 * roll); a roll not recorded falls back to 04:00 owner-local, and an open day ends `now`. */
export function dayOpen(db: Db, day: string, tz: string, now: number, current: string): { from: number; to: number } {
  const before = db.one<{ filed_at: number | null }>(
    "SELECT filed_at FROM threads WHERE kind = 'daily' AND day < ? ORDER BY day DESC LIMIT 1",
    day,
  );
  const own = dailyThread(db, day);
  // Not before the day's own start: with no thread the day before, the last filed one is older,
  // and two nights would read the same rows.
  const from = Math.max(before?.filed_at ?? 0, zonedInstant(day, DAY_STARTS_HOUR, tz));
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

/** The owner's newest message in a thread (DEC-2: the words that decide a card must be it), walked
 * back along the thread's seq index. */
export function latestOwnerMessage(db: Db, threadId: string): { id: string; created_at: number } | null {
  return db.one(
    "SELECT id, created_at FROM messages WHERE thread_id = ? AND author = 'owner' ORDER BY seq DESC LIMIT 1",
    threadId,
  );
}

/** The mind's messages: in the given thread (newest last, at most `limit`), and how many elsewhere
 * (the eval sandbox's report, where the thread is the eval's own). */
export function mindMessages(db: Db, threadId: string | null, limit: number): { replies: string[]; outside: number } {
  const inThread = threadId
    ? db.all<{ body: string }>(
        "SELECT body FROM messages WHERE thread_id = ? AND author = 'mind' ORDER BY seq DESC LIMIT ?",
        threadId,
        limit,
      )
    : [];
  const outside =
    db.one<{ n: number }>(
      "SELECT count(*) AS n FROM messages WHERE author = 'mind' AND (? IS NULL OR thread_id != ?)",
      threadId,
      threadId,
    )?.n ?? 0;
  return { replies: inThread.map((m) => m.body).reverse(), outside };
}

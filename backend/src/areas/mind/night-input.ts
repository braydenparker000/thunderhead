// The night's input (RUNTIME.md §12 step 1, API.md §11.8 `GET /v1/mind/day/:day`): a closed day's
// deterministic counts, then its messages, ledger rows and session notes in pages of at most 200,
// oldest first, each page after the last row of the one before. Reads only, each on an index: the
// day's thread by seq, the ledger by time (`ledger_at`) and the notes by time (`session_notes_at`),
// between the rolls that opened and closed the day (conversation/stats.ts `dayOpen`).
import type { DayStats, LedgerEntry, Message, SessionNote } from '../../../../shared/contract/api';
import { NIGHT_PAGE_MAX, type NightDayPart } from '../../../../shared/contract/night.ts';
import { invalid } from '../../lib/result';
import type { Db } from '../../objects/base';
import { dayCounts, dayOpen } from '../conversation/stats';
import { dailyThread, messagesPage } from '../conversation/store';
import { between, countBetween } from '../ledger/store';
import { countNotes, notesBetween } from './notes';

/** A page and the key of its last row, which the route turns into the next cursor (null: the end). */
export interface DayRows<T> {
  items: T[];
  last: (number | string)[] | null;
}
export type DayPart = DayStats | DayRows<Message> | DayRows<LedgerEntry> | DayRows<SessionNote>;

/** `after` is the decoded cursor: `[seq]` for messages, `[at, seq]` for the ledger and
 * `[created_at, id]` for notes (the route checks its shape). */
export function dayPart(
  db: Db,
  q: { day: string; part: NightDayPart; after: (number | string)[] | null; limit: number },
  tz: string,
  now: number,
  today: string,
): DayPart {
  if (q.day >= today) throw invalid('day', 'a day that has closed');
  const { from, to } = dayOpen(db, q.day, tz, now, today);
  const n = Math.min(Math.max(1, q.limit), NIGHT_PAGE_MAX);
  const more = <T>(items: T[], key: (last: T) => (number | string)[]): DayRows<T> => {
    const last = items.at(-1);
    return { items, last: items.length === n && last !== undefined ? key(last) : null };
  };
  if (q.part === 'messages') {
    const thread = dailyThread(db, q.day);
    const items = thread ? messagesPage(db, thread.id, null, Number(q.after?.[0] ?? 0), n) : [];
    return more(items, (m) => [m.seq]);
  }
  if (q.part === 'ledger') {
    const after = q.after ? ([Number(q.after[0]), Number(q.after[1])] as [number, number]) : null;
    const items = between(db, from, to, after, n);
    return more(items, (l) => [l.at, l.seq]);
  }
  if (q.part === 'notes') {
    const after = q.after ? ([Number(q.after[0]), String(q.after[1])] as [number, string]) : null;
    const items = notesBetween(db, from, to, after, n).map(
      (r): SessionNote => ({
        id: r.id,
        role: r.role,
        thread_id: r.thread_id,
        created_at: r.created_at,
        body: r.body,
        open_items: JSON.parse(r.open_items_json) as SessionNote['open_items'],
      }),
    );
    return more(items, (s) => [s.created_at, s.id]);
  }
  const c = dayCounts(db, q.day);
  return {
    day: q.day,
    from,
    to,
    messages: c.messages,
    owner: c.owner,
    mind: c.mind,
    system: c.system,
    muse: c.muse,
    ledger: countBetween(db, from, to),
    notes: countNotes(db, from, to),
  };
}

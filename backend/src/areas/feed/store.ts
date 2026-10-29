// SQL for the change feed and the live tickets inside Core (DATA.md §4.1). `addChange` is
// called only by objects/commit.ts (the one write path); everything else reads.
import type { Change } from '../../../../shared/contract/api';
import type { ChangeKind } from '../../../../shared/contract/feed.ts';
import { HOUR } from '../../lib/time';
import type { Db } from '../../objects/base';

/** Writes one feed row and returns its seq. Only objects/commit.ts calls this. The seq comes from
 * last_insert_rowid(), which reads no rows; `RETURNING` would bill one read per write. */
export function addChange(db: Db, kind: ChangeKind, ref: string | null, at: number): number {
  db.run('INSERT INTO changes (kind, ref, at) VALUES (?, ?, ?)', kind, ref, at);
  return db.one<{ seq: number }>('SELECT last_insert_rowid() AS seq')?.seq ?? 0;
}

/** The feed after `after`, oldest first. */
export function changesAfter(db: Db, after: number, limit: number): Change[] {
  return db.all<Change>('SELECT seq, kind, ref, at FROM changes WHERE seq > ? ORDER BY seq LIMIT ?', after, limit);
}

export function lastSeq(db: Db): number {
  return db.one<{ s: number | null }>('SELECT max(seq) AS s FROM changes')?.s ?? 0;
}

export function oldestSeq(db: Db): number {
  return db.one<{ s: number | null }>('SELECT min(seq) AS s FROM changes')?.s ?? 0;
}

/** Keeps the newest `keep` rows (DATA.md §10), oldest first, at most `max` a call. */
export function pruneChanges(db: Db, keep: number, max: number): number {
  return db.all(
    `DELETE FROM changes WHERE seq IN
       (SELECT seq FROM changes WHERE seq <= (SELECT max(seq) FROM changes) - ? ORDER BY seq LIMIT ?) RETURNING seq`,
    keep,
    max,
  ).length;
}

// --- live tickets (30 s, single use, only the hash is stored) ----------------------------------

export function putTicket(db: Db, hash: string, sessionId: string, expiresAt: number): void {
  db.run('INSERT INTO live_tickets (hash, session_id, expires_at) VALUES (?, ?, ?)', hash, sessionId, expiresAt);
}

/** Marks a ticket used and returns its session, or null if unknown, used or expired. */
export function consumeTicket(db: Db, hash: string, now: number): string | null {
  return (
    db.one<{ session_id: string }>(
      'UPDATE live_tickets SET used_at = ? WHERE hash = ? AND used_at IS NULL AND expires_at > ? RETURNING session_id',
      now,
      hash,
      now,
    )?.session_id ?? null
  );
}

/** Tickets are kept an hour past expiry (DATA.md §10). */
export function pruneTickets(db: Db, now: number, max: number): number {
  return db.all(
    'DELETE FROM live_tickets WHERE hash IN (SELECT hash FROM live_tickets WHERE expires_at < ? LIMIT ?) RETURNING hash',
    now - HOUR,
    max,
  ).length;
}

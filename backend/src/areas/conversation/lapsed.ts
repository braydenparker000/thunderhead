// Owner messages a chat session took and never answered (RUNTIME.md §4.5, §9 F3). Any status or
// post acknowledges what was handed out, so a session that dies after its first acknowledgement
// leaves messages the requeue never touches; once its lease has lapsed they are handed out again,
// at most REFIRES_PER_MESSAGE times each. Both read only the `messages_waiting` index's rows.
import type { Db } from '../../objects/base';

export const REFIRES_PER_MESSAGE = 2;

/** Undoes the hand-out and acknowledgement of acknowledged, unanswered owner messages, one refire
 * counted each, so the next wait or session gets them again. Returns the rows written (0: none). */
export function releaseAcked(db: Db): number {
  return db.run(
    `UPDATE messages SET delivered_at = NULL, acked_at = NULL, refires = refires + 1 WHERE author = 'owner'
       AND answered_at IS NULL AND acked_at IS NOT NULL AND refires < ?`,
    REFIRES_PER_MESSAGE,
  );
}

/** When the oldest owner message still waiting for a reply was sent, or null. */
export function oldestUnanswered(db: Db): number | null {
  return (
    db.one<{ at: number }>(
      `SELECT created_at AS at FROM messages WHERE author = 'owner' AND answered_at IS NULL ORDER BY seq LIMIT 1`,
    )?.at ?? null
  );
}

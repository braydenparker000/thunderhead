// Held conversations (NEXT-BATCH.md part 8, decisions.md 2026-11-01): a conversation off the
// record (answered, never remembered, purged 7 days after its last message) and a deleted one
// (hidden at once, restorable for 30 days, then purged). Both carry `purge_at`, and the cron's
// prune pass purges each once it is due, in steps, held by the rows guard. Plain data and types,
// importable by Node without a build.
import type { Day, Id, Ms } from './api';
import type { ThreadKind } from './conversation';

const DAY_MS = 86_400_000;

export const HELD_LIMITS = {
  /** An off-the-record conversation goes this long after its last message (or its start). */
  off_record_ms: 7 * DAY_MS,
  /** A deleted conversation stays in Recently deleted this long, then goes. */
  deleted_ms: 30 * DAY_MS,
  /** Messages the prune pass purges per tick at most (each with its files and evidence links). */
  purge_messages: 500,
  /** Keys per R2 delete call (the platform's limit is 1,000). */
  vault_keys: 1_000,
  /** Recently deleted lists at most this many (30 days of deletes). */
  deleted_list: 200,
} as const;

/** One conversation in Settings › Recently deleted: what it was, when it went, when it goes for good. */
export interface DeletedThread {
  id: Id;
  day: Day;
  /** The kind it had and gets back on Restore. */
  kind: ThreadKind;
  title: string | null;
  summary: string | null;
  message_count: number;
  deleted_at: Ms;
  /** When the prune pass purges it (deleted_at + 30 days, sooner for one that was off the record). */
  purge_at: Ms;
}

export interface DeletedThreadsResponse {
  items: DeletedThread[];
}

/** `DELETE /v1/threads/:id`: gone from every view now, purged at `purge_at` unless restored. */
export interface ThreadDeleted {
  id: Id;
  purge_at: Ms;
}

/** `POST /v1/threads/:id/restore`: the thread as it is again, and whether it came back beside a
 * newer conversation of its day (kind `restored`) because deleting today started a fresh one. */
export interface RestoredThread {
  id: Id;
  kind: ThreadKind;
  beside: boolean;
}

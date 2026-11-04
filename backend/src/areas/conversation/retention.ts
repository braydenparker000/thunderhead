// Keep conversations (`privacy.retention`, Settings › Privacy and data; DATA.md §10): a conversation
// unchanged for longer than the owner's window is purged the way a deleted one is (purge.ts). Once
// a logical day the prune pass (objects/core-held.ts pruneDaily) marks at most RETENTION_STEP of
// them due now, which takes them out of every read at once (held.ts `stateOf`: due is gone); the
// purge then takes their messages, files and FTS entries in its own steps, from the next tick, and
// writes a ledger row without words for each. A conversation filed under a topic is kept (the owner
// deletes one by hand), one already held keeps its own purge, and Forever, the default, reads nothing.
import type { Db } from '../../objects/base';
import { getSetting } from '../settings/store';
import * as hs from './held-store';

const DAY_MS = 86_400_000;
/** Each choice's window in days; Forever has none. */
export const RETENTION_DAYS: Record<string, number> = { '1y': 365, '90d': 90 };
/** Conversations marked a pass at most: a backlog goes on at the next tick (the day stays open). */
export const RETENTION_STEP = 200;

/** Marks the conversations past the owner's window due now. Returns how many it marked. */
export function expirePastKeep(db: Db, now: number, max: number = RETENTION_STEP): number {
  const days = RETENTION_DAYS[String(getSetting(db, 'privacy.retention'))];
  if (!days) return 0;
  let n = 0;
  for (const id of hs.pastKeep(db, now - days * DAY_MS, max)) n += hs.markPastKeep(db, id, now);
  return n;
}

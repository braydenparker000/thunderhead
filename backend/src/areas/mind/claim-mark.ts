// A mark and the next claim (RUNTIME.md §4.3, MEMORY.md §7). A mark ends with its session: the
// session the Worker itself starts afterwards begins clean. But the Worker can't tell a session id
// a marked session made up from a new cloud session, so any other claim takes over the mark of the
// role's latest session marked in the last 24 hours. A claim is clean only when it is the very
// session the Worker fired after that mark (an exact id match on a wake still open), or, for the
// night, a claim on a later day's fired wake once every session holding the mark has ended (a
// marked session still live could be the claimant under a new id). A loose match can't prove
// more, so it inherits too. The mark keeps its event's time and is no event of its own, so a wake
// fired after it still starts clean however many claims inherited it in between.
import type { MindRole } from '../../../../shared/contract/conversation';
import { HOUR } from '../../lib/time';
import type { Db } from '../../objects/base';
import { logicalDay } from '../conversation/day';
import * as store from './store';

/** How long a mark is taken over by claims the Worker did not start, counted from the mark itself. */
export const TAINT_HOLDS_MS = 24 * HOUR;

type Prior = NonNullable<ReturnType<typeof store.taintedSince>>;

/** The mark this claim takes over, or null: read before the claim's own session row is written. */
export function markToCarry(
  db: Db,
  role: MindRole,
  at: number,
  tz: string,
  open: { fired_at: number | null; at: number } | null,
  exact: boolean,
): Prior | null {
  const prior = store.taintedSince(db, role, at - TAINT_HOLDS_MS);
  if (!prior) return null;
  const firedAt = open ? (open.fired_at ?? open.at) : null;
  if (firedAt !== null && exact && firedAt > prior.event_at) return null;
  const nextNight =
    role === 'night' &&
    firedAt !== null &&
    logicalDay(firedAt, tz) > logicalDay(prior.event_at, tz) &&
    !store.taintLive(db, role, at - TAINT_HOLDS_MS);
  return nextNight ? null : prior;
}

/** Writes the mark a claim takes over onto its session. */
export function carryMark(db: Db, sessionId: string, role: MindRole, day: string, prior: Prior): void {
  store.taintSession(db, {
    id: sessionId,
    role,
    day,
    source: `inherited:${prior.taint_source}`,
    at: prior.event_at,
    event: false,
  });
}

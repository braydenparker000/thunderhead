// The mind's retention (DATA.md §10): wakes, sessions, notes and leases, a bounded batch at a time.
import { DAY } from '../../lib/time';
import type { Db } from '../../objects/base';

export function pruneWakes(db: Db, now: number, max: number): number {
  return db.all(
    'DELETE FROM wakes WHERE id IN (SELECT id FROM wakes WHERE at < ? LIMIT ?) RETURNING 1',
    now - 30 * DAY,
    max,
  ).length;
}

/** Sessions go 90 days after they ended (or were claimed, if they never said so). */
export function pruneSessions(db: Db, now: number, max: number): number {
  return db.all(
    `DELETE FROM mind_sessions WHERE session_id IN
       (SELECT session_id FROM mind_sessions WHERE coalesce(ended_at, claimed_at) < ? LIMIT ?) RETURNING 1`,
    now - 90 * DAY,
    max,
  ).length;
}

export function pruneNotes(db: Db, now: number, max: number): number {
  return db.all(
    'DELETE FROM session_notes WHERE id IN (SELECT id FROM session_notes WHERE created_at < ? LIMIT ?) RETURNING 1',
    now - 180 * DAY,
    max,
  ).length;
}

/** A lease left by a session that stopped renewing a day ago (live only). */
export function pruneLeases(db: Db, now: number, max: number): number {
  return db.all(
    'DELETE FROM leases WHERE task IN (SELECT task FROM leases WHERE renewed_at < ? LIMIT ?) RETURNING 1',
    now - DAY,
    max,
  ).length;
}

// SQL for the mind's bookkeeping inside Core (DATA.md §4.1, RUNTIME.md §4): wakes, the chat
// lease, per-session state and session notes. Stores never write the change feed.
import type { MindRole, WakeItem } from '../../../../shared/contract/api';
import { DAY } from '../../lib/time';
import type { Db } from '../../objects/base';

export interface WakeRow {
  id: string;
  at: number;
  task: MindRole;
  reason: string;
  status: WakeItem['status'];
  fired_at: number | null;
  fire_status: number | null;
  fire_error: string | null;
  session_id: string | null;
  claimed_at: number | null;
  claim_match: string | null;
  retry_of: string | null;
  first_reply_at: number | null;
  ended_at: number | null;
  end_reason: string | null;
}

export function insertWake(
  db: Db,
  w: { id: string; at: number; task: MindRole; reason: string; retry_of?: string | null },
) {
  db.run(
    `INSERT INTO wakes (id, at, task, reason, status, fired_at, retry_of) VALUES (?, ?, ?, ?, 'fired', ?, ?)`,
    w.id,
    w.at,
    w.task,
    w.reason,
    w.at,
    w.retry_of ?? null,
  );
}

export function wake(db: Db, id: string): WakeRow | null {
  return db.one<WakeRow>('SELECT * FROM wakes WHERE id = ?', id);
}

export function recordFire(db: Db, id: string, status: number, sessionId: string | null, error: string | null) {
  db.run(
    'UPDATE wakes SET fire_status = ?, session_id = coalesce(?, session_id), fire_error = ? WHERE id = ?',
    status,
    sessionId,
    error,
    id,
  );
}

/** Open wakes of a task (fired or unclaimed), newest first. */
export function openWakes(db: Db, task: MindRole): WakeRow[] {
  return db.all<WakeRow>(
    `SELECT * FROM wakes WHERE task = ? AND status IN ('fired', 'unclaimed') ORDER BY at DESC LIMIT 10`,
    task,
  );
}

export function setWakeStatus(db: Db, id: string, status: WakeItem['status'], extra: Partial<WakeRow> = {}): void {
  db.run(
    `UPDATE wakes SET status = ?, claimed_at = coalesce(?, claimed_at), claim_match = coalesce(?, claim_match),
       session_id = coalesce(?, session_id), ended_at = coalesce(?, ended_at), end_reason = coalesce(?, end_reason),
       first_reply_at = coalesce(first_reply_at, ?) WHERE id = ?`,
    status,
    extra.claimed_at ?? null,
    extra.claim_match ?? null,
    extra.session_id ?? null,
    extra.ended_at ?? null,
    extra.end_reason ?? null,
    extra.first_reply_at ?? null,
    id,
  );
}

/** Counts for the fire conditions (RUNTIME.md §3): fires of a task since `since`, by reason. */
export function fireCount(db: Db, task: MindRole, since: number, reason?: string): number {
  return (
    db.one<{ n: number }>(
      'SELECT count(*) AS n FROM wakes WHERE task = ? AND at >= ? AND (? IS NULL OR reason = ?)',
      task,
      since,
      reason ?? null,
      reason ?? null,
    )?.n ?? 0
  );
}

/** The newest wake of a task (only those still `fired` when `unclaimedOnly`), newest first on
 * the `wakes_at` index so one or two rows are read. */
export function lastFireAt(db: Db, task: MindRole, unclaimedOnly: boolean): number | null {
  return (
    db.one<{ at: number }>(
      `SELECT at FROM wakes WHERE task = ? AND (? = 0 OR status = 'fired') ORDER BY at DESC LIMIT 1`,
      task,
      unclaimedOnly ? 1 : 0,
    )?.at ?? null
  );
}

export function wakesPage(db: Db, limit: number, before: number | null): WakeItem[] {
  return db.all<WakeItem>(
    `SELECT id, at, task AS role, reason, status, fired_at, claimed_at FROM wakes WHERE (? IS NULL OR at < ?)
     ORDER BY at DESC LIMIT ?`,
    before,
    before,
    limit,
  );
}

export function wakesToday(db: Db, since: number): number {
  return db.one<{ n: number }>('SELECT count(*) AS n FROM wakes WHERE at >= ?', since)?.n ?? 0;
}

// --- the chat lease ---------------------------------------------------------------------------

export interface Lease {
  task: string;
  session_id: string;
  acquired_at: number;
  renewed_at: number;
}

export function lease(db: Db, task: MindRole): Lease | null {
  return db.one<Lease>('SELECT * FROM leases WHERE task = ?', task);
}

export function putLease(db: Db, task: MindRole, sessionId: string, at: number): void {
  db.run(
    `INSERT INTO leases (task, session_id, acquired_at, renewed_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (task) DO UPDATE SET session_id = excluded.session_id, acquired_at = excluded.acquired_at,
       renewed_at = excluded.renewed_at`,
    task,
    sessionId,
    at,
    at,
  );
}

export function renewLease(db: Db, task: MindRole, at: number): void {
  db.run('UPDATE leases SET renewed_at = ? WHERE task = ?', at, task);
}

export function dropLease(db: Db, task: MindRole, sessionId: string): void {
  db.run('DELETE FROM leases WHERE task = ? AND session_id = ?', task, sessionId);
}

// --- sessions and notes -----------------------------------------------------------------------

export interface SessionRow {
  session_id: string;
  role: MindRole;
  wake_id: string | null;
  claimed_at: number;
  tainted_at: number | null;
  ended_at: number | null;
  day: string;
  last_owner_at: number | null;
}

export function session(db: Db, id: string): SessionRow | null {
  return db.one<SessionRow>(
    'SELECT session_id, role, wake_id, claimed_at, tainted_at, ended_at, day, last_owner_at FROM mind_sessions WHERE session_id = ?',
    id,
  );
}

export function putSession(
  db: Db,
  s: {
    session_id: string;
    role: MindRole;
    wake_id: string | null;
    at: number;
    th_version: string;
    sha: string;
    day: string;
  },
): void {
  db.run(
    `INSERT INTO mind_sessions (session_id, role, wake_id, claimed_at, th_version, constitution_sha256, day)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (session_id) DO UPDATE SET wake_id = excluded.wake_id, th_version = excluded.th_version,
       constitution_sha256 = excluded.constitution_sha256, day = excluded.day, ended_at = NULL`,
    s.session_id,
    s.role,
    s.wake_id,
    s.at,
    s.th_version,
    s.sha,
    s.day,
  );
}

export function sessionSeenOwner(db: Db, id: string, at: number): void {
  db.run('UPDATE mind_sessions SET last_owner_at = max(coalesce(last_owner_at, 0), ?) WHERE session_id = ?', at, id);
}

/** Marks a session tainted, making its row if it never claimed (taint must never be dropped). */
export function taintSession(db: Db, s: { id: string; role: MindRole; day: string; source: string; at: number }): void {
  db.run(
    `INSERT INTO mind_sessions (session_id, role, claimed_at, day, tainted_at, taint_source) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (session_id) DO UPDATE SET tainted_at = coalesce(tainted_at, excluded.tainted_at),
       taint_source = coalesce(taint_source, excluded.taint_source)`,
    s.id,
    s.role,
    s.at,
    s.day,
    s.at,
    s.source.slice(0, 40),
  );
}

export function endSession(db: Db, id: string, at: number): void {
  db.run('UPDATE mind_sessions SET ended_at = coalesce(ended_at, ?) WHERE session_id = ?', at, id);
}

export function note(db: Db, id: string): { body: string; open_items_json: string; session_id: string | null } | null {
  return db.one('SELECT body, open_items_json, session_id FROM session_notes WHERE id = ?', id);
}

export function putNote(
  db: Db,
  n: {
    id: string;
    session_id: string | null;
    wake_id: string | null;
    role: MindRole;
    thread_id: string | null;
    at: number;
    body: string;
    open: string;
  },
): void {
  db.run(
    `INSERT INTO session_notes (id, session_id, wake_id, role, thread_id, created_at, body, open_items_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    n.id,
    n.session_id,
    n.wake_id,
    n.role,
    n.thread_id,
    n.at,
    n.body,
    n.open,
  );
}

export function latestNote(db: Db): { body: string; created_at: number } | null {
  return db.one('SELECT body, created_at FROM session_notes ORDER BY created_at DESC LIMIT 1');
}

// --- retention (DATA.md §10) -------------------------------------------------------------------

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

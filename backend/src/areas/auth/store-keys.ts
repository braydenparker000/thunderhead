// SQL for notices, setup/reset tickets and agent keys, run inside the Auth object (DATA.md §5).
import type { AgentRole, NoticeKind } from '../../../../shared/contract/api';
import type { Db } from '../../objects/base';

// --- notices -----------------------------------------------------------------------------------

export interface NoticeRow {
  id: string;
  kind: NoticeKind;
  session_id: string | null;
  args_json: string;
  created_at: number;
  expires_at: number | null;
}

export function insertNotice(db: Db, n: NoticeRow): void {
  db.run(
    'INSERT INTO notices (id, kind, session_id, args_json, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
    n.id,
    n.kind,
    n.session_id,
    n.args_json,
    n.created_at,
    n.expires_at,
  );
}

/** Unacknowledged, unexpired notices, newest first; the caller filters by audience. */
export function openNotices(db: Db, now: number): NoticeRow[] {
  return db.all<NoticeRow>(
    `SELECT id, kind, session_id, args_json, created_at, expires_at FROM notices
     WHERE acked_at IS NULL AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at DESC`,
    now,
  );
}

export function ackNotice(db: Db, id: string, answer: string, now: number): void {
  db.run('UPDATE notices SET acked_at = ?, answer = ? WHERE id = ?', now, answer, id);
}

/** Ends the open `reset_pending` notices of a ticket (cancelled or used). */
export function ackTicketNotices(db: Db, ticketId: string, now: number): void {
  db.run(
    "UPDATE notices SET acked_at = ?, answer = 'ok' WHERE kind = 'reset_pending' AND acked_at IS NULL AND json_extract(args_json, '$.ticket_id') = ?",
    now,
    ticketId,
  );
}

export function deleteOldNotices(db: Db, before: number): number {
  return db.all(
    'DELETE FROM notices WHERE (acked_at IS NOT NULL AND acked_at < ?) OR (expires_at IS NOT NULL AND expires_at < ?) RETURNING id',
    before,
    before,
  ).length;
}

// --- tickets -----------------------------------------------------------------------------------

export interface TicketRow {
  id: string;
  kind: 'setup' | 'reset';
  fingerprint: string;
  source: 'mind' | 'github' | 'dashboard';
  requested_at: number;
  usable_after: number | null;
  expires_at: number | null;
  used_at: number | null;
  cancelled_at: number | null;
}

const TICKET_COLS = 'id, kind, fingerprint, source, requested_at, usable_after, expires_at, used_at, cancelled_at';

export function insertTicket(db: Db, t: TicketRow): void {
  db.run(
    `INSERT INTO tickets (${TICKET_COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    t.id,
    t.kind,
    t.fingerprint,
    t.source,
    t.requested_at,
    t.usable_after,
    t.expires_at,
    t.used_at,
    t.cancelled_at,
  );
}

/** Every ticket ever made with this fingerprint (a used or cancelled one blocks it for good). */
export function ticketByFingerprint(db: Db, fp: string): TicketRow | null {
  return db.one<TicketRow>(`SELECT ${TICKET_COLS} FROM tickets WHERE fingerprint = ? ORDER BY requested_at DESC`, fp);
}

export function ticketById(db: Db, id: string): TicketRow | null {
  return db.one<TicketRow>(`SELECT ${TICKET_COLS} FROM tickets WHERE id = ?`, id);
}

/** The reset ticket still waiting or ready (neither used, cancelled nor expired), if any. */
export function openResetTicket(db: Db, now: number): TicketRow | null {
  return db.one<TicketRow>(
    `SELECT ${TICKET_COLS} FROM tickets WHERE kind = 'reset' AND used_at IS NULL AND cancelled_at IS NULL
       AND expires_at > ? ORDER BY requested_at DESC`,
    now,
  );
}

export function useTicket(db: Db, id: string, now: number): void {
  db.run('UPDATE tickets SET used_at = ? WHERE id = ?', now, id);
}

export function cancelTicket(db: Db, id: string, now: number): void {
  db.run('UPDATE tickets SET cancelled_at = ? WHERE id = ?', now, id);
}

// --- agent keys --------------------------------------------------------------------------------

export interface AgentRow {
  id: string;
  name: string;
  role: AgentRole;
  created_at: number;
  created_on: string;
  last_used_at: number | null;
  last_country: string | null;
}

const AGENT_COLS = 'id, name, role, created_at, created_on, last_used_at, last_country';

export function insertAgent(db: Db, a: AgentRow, tokenHash: Uint8Array): void {
  db.run(
    `INSERT INTO agents (${AGENT_COLS}, token_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    a.id,
    a.name,
    a.role,
    a.created_at,
    a.created_on,
    a.last_used_at,
    a.last_country,
    tokenHash,
  );
}

export function activeAgents(db: Db): AgentRow[] {
  return db.all<AgentRow>(`SELECT ${AGENT_COLS} FROM agents WHERE revoked_at IS NULL ORDER BY created_at DESC`);
}

export function agentByTokenHash(db: Db, tokenHash: Uint8Array): AgentRow | null {
  return db.one<AgentRow>(`SELECT ${AGENT_COLS} FROM agents WHERE token_hash = ? AND revoked_at IS NULL`, tokenHash);
}

export function touchAgent(db: Db, id: string, hour: number, country: string | null): void {
  db.run(
    'UPDATE agents SET last_used_at = ?, last_country = coalesce(?, last_country) WHERE id = ?',
    hour,
    country,
    id,
  );
}

export function revokeAgent(db: Db, id: string, now: number): number {
  return db.all('UPDATE agents SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL RETURNING id', now, id).length;
}

// SQL for the credential, the recovery code, sessions and back-off counters, run inside the
// Auth object (DATA.md §5). Notices, tickets and agent keys are in store-keys.ts.

import type { Db } from '../../objects/base';
import { deleteSubscriptions } from '../push/store';
import type { KdfParams } from './crypto';
import type { Counter } from './throttle';

// --- credential and recovery -------------------------------------------------------------------

export interface CredentialRow extends KdfParams {
  username: string;
  salt: ArrayBuffer;
  hash: ArrayBuffer;
  version: number;
}

export function getCredential(db: Db): CredentialRow | null {
  return db.one<CredentialRow>('SELECT username, n, r, p, salt, hash, version FROM credential WHERE id = 1');
}

export function hasCredential(db: Db): boolean {
  return db.one('SELECT 1 AS x FROM credential WHERE id = 1') !== null;
}

export interface NewHash extends KdfParams {
  salt: Uint8Array;
  hash: Uint8Array;
  at: number;
}

export function insertCredential(db: Db, username: string, h: NewHash): void {
  db.run(
    `INSERT INTO credential (id, username, algo, n, r, p, salt, hash, pepper_v, version, changed_at)
     VALUES (1, ?, 'scrypt', ?, ?, ?, ?, ?, 1, 1, ?)`,
    username,
    h.n,
    h.r,
    h.p,
    h.salt,
    h.hash,
    h.at,
  );
}

/** A new hash; bumps the credential version unless this is only a parameter upgrade. */
export function updatePassword(db: Db, h: NewHash, bump: boolean): void {
  db.run(
    'UPDATE credential SET n = ?, r = ?, p = ?, salt = ?, hash = ?, changed_at = ?, version = version + ? WHERE id = 1',
    h.n,
    h.r,
    h.p,
    h.salt,
    h.hash,
    h.at,
    bump ? 1 : 0,
  );
}

export interface RecoveryRow {
  code_hash: ArrayBuffer;
  last5_hash: ArrayBuffer;
  confirmed_at: number | null;
}

export function getRecovery(db: Db): RecoveryRow | null {
  return db.one<RecoveryRow>('SELECT code_hash, last5_hash, confirmed_at FROM recovery WHERE id = 1');
}

/** A new recovery code replaces the old one at once; it starts unconfirmed. */
export function putRecovery(db: Db, codeHash: Uint8Array, last5: Uint8Array, at: number): void {
  db.run(
    `INSERT INTO recovery (id, code_hash, last5_hash, created_at) VALUES (1, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET code_hash = excluded.code_hash, last5_hash = excluded.last5_hash,
       created_at = excluded.created_at, confirmed_at = NULL, used_at = NULL`,
    codeHash,
    last5,
    at,
  );
}

export function confirmRecovery(db: Db, at: number): void {
  db.run('UPDATE recovery SET confirmed_at = ? WHERE id = 1', at);
}

// --- sessions ----------------------------------------------------------------------------------

export interface SessionRow {
  id: string;
  label: string;
  platform: string | null;
  browser: string | null;
  model: string | null;
  standalone: number;
  country: string | null;
  region: string | null;
  last_country: string | null;
  created_at: number;
  last_seen_at: number;
  idle_expires_at: number;
  revoked_at: number | null;
  revoked_reason: string | null;
}

const SESSION_COLS = `id, label, platform, browser, model, standalone, country, region, last_country, created_at,
  last_seen_at, idle_expires_at, revoked_at, revoked_reason`;

export type NewSession = Omit<SessionRow, 'revoked_at' | 'revoked_reason'> & {
  token_hash: string;
  credential_version: number;
};

export function insertSession(db: Db, s: NewSession): void {
  db.run(
    `INSERT INTO sessions (token_hash, id, label, platform, browser, model, standalone, country, region,
       last_country, created_at, last_seen_at, idle_expires_at, credential_version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    s.token_hash,
    s.id,
    s.label,
    s.platform,
    s.browser,
    s.model,
    s.standalone,
    s.country,
    s.region,
    s.last_country,
    s.created_at,
    s.last_seen_at,
    s.idle_expires_at,
    s.credential_version,
  );
}

export function sessionByTokenHash(db: Db, tokenHash: string): SessionRow | null {
  return db.one<SessionRow>(`SELECT ${SESSION_COLS} FROM sessions WHERE token_hash = ?`, tokenHash);
}

export function sessionById(db: Db, id: string): SessionRow | null {
  return db.one<SessionRow>(`SELECT ${SESSION_COLS} FROM sessions WHERE id = ?`, id);
}

export function touchSession(db: Db, tokenHash: string, hour: number, idleExpires: number, country: string | null) {
  db.run(
    'UPDATE sessions SET last_seen_at = ?, idle_expires_at = ?, last_country = coalesce(?, last_country) WHERE token_hash = ?',
    hour,
    idleExpires,
    country,
    tokenHash,
  );
}

/** Signed in, not revoked, not idle for 90 days; newest first. */
export function activeSessions(db: Db, now: number): SessionRow[] {
  return db.all<SessionRow>(
    `SELECT ${SESSION_COLS} FROM sessions WHERE revoked_at IS NULL AND idle_expires_at > ? ORDER BY created_at DESC`,
    now,
  );
}

export function relabelSession(db: Db, id: string, label: string, now: number): number {
  return db.all(
    'UPDATE sessions SET label = ? WHERE id = ? AND revoked_at IS NULL AND idle_expires_at > ? RETURNING id',
    label,
    id,
    now,
  ).length;
}

/** Revokes active sessions: one (`only`), all but one (`except`), or all. `selfId` gets
 * `signed_out_here` when `reason` is a sign-out; every other row gets `reason`. */
export function revokeSessions(
  db: Db,
  now: number,
  reason: string,
  target: { only?: string; except?: string; selfId?: string },
): string[] {
  const here = reason === 'signed_out_elsewhere' ? (target.selfId ?? '') : '';
  const ids = db
    .all<{ id: string }>(
      `UPDATE sessions SET revoked_at = ?, revoked_reason = CASE WHEN id = ? THEN 'signed_out_here' ELSE ? END
       WHERE revoked_at IS NULL AND idle_expires_at > ? AND (? IS NULL OR id = ?) AND (? IS NULL OR id <> ?)
       RETURNING id`,
      now,
      here,
      reason,
      now,
      target.only ?? null,
      target.only ?? null,
      target.except ?? null,
      target.except ?? null,
    )
    .map((r) => r.id);
  // A signed-out session's push subscription goes with it, in the same transaction (SECURITY.md §10).
  deleteSubscriptions(db, ids);
  return ids;
}

/** Rows revoked or expired more than `before` ago are forgotten (SIGN-IN.md §3.2: 30 days). */
export function deleteOldSessions(db: Db, before: number): number {
  return db.all('DELETE FROM sessions WHERE revoked_at < ? OR idle_expires_at < ? RETURNING id', before, before).length;
}

// --- throttle ----------------------------------------------------------------------------------

export function getCounter(db: Db, key: string): Counter | null {
  return db.one<Counter>('SELECT fails, window_start, last_at, next_allowed_at FROM throttle WHERE key = ?', key);
}

export function putCounter(db: Db, key: string, c: Counter): void {
  db.run(
    `INSERT INTO throttle (key, fails, window_start, last_at, next_allowed_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET fails = excluded.fails, window_start = excluded.window_start,
       last_at = excluded.last_at, next_allowed_at = excluded.next_allowed_at`,
    key,
    c.fails,
    c.window_start,
    c.last_at,
    c.next_allowed_at,
  );
}

export function clearCounter(db: Db, key: string): void {
  db.run('DELETE FROM throttle WHERE key = ?', key);
}

/** Counters untouched for two days can no longer delay anything, except the 30-day reset rule. */
export function deleteStaleCounters(db: Db, before: number): number {
  return db.all(
    "DELETE FROM throttle WHERE last_at < ? AND next_allowed_at < ? AND key <> 'reset:acct' RETURNING key",
    before,
    before,
  ).length;
}

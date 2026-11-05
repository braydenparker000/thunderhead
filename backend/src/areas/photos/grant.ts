// The Drive grant inside the Auth object, where the owner's other keys live (PHOTOS.md §3.7): the
// refresh token and the consenting account's address sealed (seal.ts), the app's folder, when it was linked and whether Google has
// since refused it; and the one-use states of a consent in progress (10 minutes each). The access
// token it mints is kept only in the object's memory until it expires.
import type { DriveStatus } from '../../../../shared/contract/photos.ts';
import { MINUTE } from '../../lib/time';
import type { Db } from '../../objects/base';
import { open, seal } from './seal';

export const STATE_MS = 10 * MINUTE;

export const GRANT_SQL = [
  `CREATE TABLE drive_grant (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    sealed TEXT NOT NULL,
    folder_id TEXT NOT NULL,
    folder_name TEXT NOT NULL,
    connected_at INTEGER NOT NULL,
    revoked_at INTEGER,
    account TEXT
  )`,
  `CREATE TABLE drive_states (
    hash TEXT PRIMARY KEY,
    origin TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  ) WITHOUT ROWID`,
];

type Row = {
  sealed: string;
  folder_id: string;
  folder_name: string;
  connected_at: number;
  revoked_at: number | null;
  account: string | null;
};
const row = (db: Db) =>
  db.one<Row>('SELECT sealed, folder_id, folder_name, connected_at, revoked_at, account FROM drive_grant WHERE id = 1');

/** For the owner's phone only (GET /v1/photos/drive is a device route): the account opened. */
export async function status(
  db: Db,
  pepper: string,
  configured: boolean,
): Promise<Omit<DriveStatus, 'picker_key' | 'picker_app'>> {
  const r = row(db);
  return {
    configured,
    connected: r !== null && r.revoked_at === null,
    folder_name: r?.folder_name ?? null,
    revoked: r?.revoked_at != null,
    connected_at: r?.connected_at ?? null,
    account: r?.account ? await open(pepper, r.account) : null,
  };
}

export function newState(db: Db, hash: string, origin: string, now: number): void {
  db.run('DELETE FROM drive_states WHERE expires_at < ?', now);
  db.run('INSERT INTO drive_states (hash, origin, expires_at) VALUES (?, ?, ?)', hash, origin, now + STATE_MS);
}

/** The state's origin, once: a used or late state is null. */
export function takeState(db: Db, hash: string, now: number): string | null {
  const r = db.one<{ origin: string; expires_at: number }>(
    'SELECT origin, expires_at FROM drive_states WHERE hash = ?',
    hash,
  );
  if (!r) return null;
  db.run('DELETE FROM drive_states WHERE hash = ?', hash);
  return r.expires_at >= now ? r.origin : null;
}

export interface NewGrant {
  refresh: string;
  folder_id: string;
  folder_name: string;
  /** The consenting Google account's address, sealed like the token. */
  account: string | null;
}

export async function put(db: Db, pepper: string, g: NewGrant, now: number) {
  const sealed = await seal(pepper, g.refresh);
  const account = g.account ? await seal(pepper, g.account) : null;
  db.run(
    `INSERT INTO drive_grant (id, sealed, folder_id, folder_name, connected_at, revoked_at, account)
     VALUES (1, ?, ?, ?, ?, NULL, ?)
     ON CONFLICT (id) DO UPDATE SET sealed = excluded.sealed, folder_id = excluded.folder_id,
       folder_name = excluded.folder_name, connected_at = excluded.connected_at, revoked_at = NULL,
       account = excluded.account`,
    sealed,
    g.folder_id,
    g.folder_name,
    now,
    account,
  );
}

/** The refresh token and folder of a live grant, or null (none, revoked, or not ours to open). */
export async function live(db: Db, pepper: string): Promise<{ refresh: string; folder_id: string } | null> {
  const r = row(db);
  if (!r || r.revoked_at !== null) return null;
  const refresh = await open(pepper, r.sealed);
  return refresh ? { refresh, folder_id: r.folder_id } : null;
}

export const revoked = (db: Db, now: number) =>
  db.run('UPDATE drive_grant SET revoked_at = ? WHERE id = 1 AND revoked_at IS NULL', now);

export const forget = (db: Db) => db.run('DELETE FROM drive_grant WHERE id = 1');

/** The Auth object's tidy-up: states nobody came back with. */
export const pruneStates = (db: Db, now: number) => db.run('DELETE FROM drive_states WHERE expires_at < ?', now);

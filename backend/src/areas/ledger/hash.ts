// A ledger row found by the canonical hash of the request that wrote it (`req_sha256`), for an area
// whose action is idempotent by its body rather than by an id (photos/paste.ts). The time index
// bounds the read to the window given.
import type { Db } from '../../objects/base';

/** The newest row still done with this hash, written at or after `since`. */
export const liveByHash = (db: Db, hash: string, since: number): string | null =>
  db.one<{ id: string }>(
    `SELECT id FROM ledger WHERE at >= ? AND req_sha256 = ? AND status = 'done' ORDER BY at DESC LIMIT 1`,
    since,
    hash,
  )?.id ?? null;

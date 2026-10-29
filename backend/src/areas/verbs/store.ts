// SQL for verbs queued for a phone (DATA.md §4.3). Stores never write the change feed.
import type { Verb, VerbStatus } from '../../../../shared/contract/api';
import type { Db } from '../../objects/base';

interface Row {
  id: string;
  created_at: number;
  actor: string;
  verb: string;
  schema: number;
  ref: string | null;
  args_json: string;
  device_id: string | null;
  status: VerbStatus;
  proposal_id: string | null;
  ledger_id: string | null;
  expires_at: number;
  claimed_at: number | null;
  claimed_by: string | null;
  claims: number;
  done_at: number | null;
  result_json: string | null;
  undo_json: string | null;
  error_json: string | null;
  req_sha256: string | null;
}

export type VerbRow = Row;

export function toVerb(r: Row): Verb {
  return {
    id: r.id,
    verb: r.verb,
    schema: r.schema,
    ref: r.ref,
    args: JSON.parse(r.args_json),
    device_id: r.device_id,
    status: r.status,
    proposal_id: r.proposal_id,
    created_at: r.created_at,
    expires_at: r.expires_at,
    result: r.result_json ? JSON.parse(r.result_json) : null,
    error: r.error_json ? JSON.parse(r.error_json) : null,
  };
}

export function byId(db: Db, id: string): Row | null {
  return db.one<Row>('SELECT * FROM verbs WHERE id = ?', id);
}

export function statusOf(db: Db, id: string): VerbStatus | null {
  return db.one<{ status: VerbStatus }>('SELECT status FROM verbs WHERE id = ?', id)?.status ?? null;
}

export function insert(
  db: Db,
  v: Pick<
    Row,
    | 'id'
    | 'created_at'
    | 'actor'
    | 'verb'
    | 'schema'
    | 'ref'
    | 'args_json'
    | 'device_id'
    | 'expires_at'
    | 'proposal_id'
    | 'ledger_id'
    | 'req_sha256'
  >,
): void {
  db.run(
    `INSERT INTO verbs (id, created_at, actor, verb, schema, ref, args_json, device_id, status, proposal_id, ledger_id,
       expires_at, req_sha256) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
    v.id,
    v.created_at,
    v.actor,
    v.verb,
    v.schema,
    v.ref,
    v.args_json,
    v.device_id,
    v.proposal_id,
    v.ledger_id,
    v.expires_at,
    v.req_sha256,
  );
}

/** Open verbs for a device (its own or any), oldest first. */
export function open(db: Db, deviceId: string): Row[] {
  return db.all<Row>(
    `SELECT * FROM verbs WHERE status IN ('pending', 'claimed') AND (device_id IS NULL OR device_id = ?)
     ORDER BY created_at LIMIT 50`,
    deviceId,
  );
}

export function claim(db: Db, id: string, by: string, at: number): void {
  db.run(
    "UPDATE verbs SET status = 'claimed', claimed_at = ?, claimed_by = ?, claims = claims + 1 WHERE id = ?",
    at,
    by,
    id,
  );
}

/** A claim older than `ms` goes back to pending (at most `max` claims, then failed). */
export function releaseStale(db: Db, now: number, ms: number, max: number): string[] {
  const stale = db.all<{ id: string; claims: number }>(
    "SELECT id, claims FROM verbs WHERE status = 'claimed' AND claimed_at < ?",
    now - ms,
  );
  for (const s of stale)
    db.run(
      'UPDATE verbs SET status = ?, claimed_by = NULL, error_json = ? WHERE id = ?',
      s.claims >= max ? 'failed' : 'pending',
      s.claims >= max ? JSON.stringify({ code: 'claim_timeout' }) : null,
      s.id,
    );
  return stale.map((s) => s.id);
}

export function expire(db: Db, now: number): string[] {
  return db
    .all<{ id: string }>(
      "UPDATE verbs SET status = 'expired' WHERE status IN ('pending', 'claimed') AND expires_at < ? RETURNING id",
      now,
    )
    .map((r) => r.id);
}

export function finish(
  db: Db,
  id: string,
  ok: boolean,
  at: number,
  result: unknown,
  undo: unknown,
  error: unknown,
): void {
  db.run(
    'UPDATE verbs SET status = ?, done_at = ?, result_json = ?, undo_json = ?, error_json = ? WHERE id = ?',
    ok ? 'done' : 'failed',
    at,
    result === undefined ? null : JSON.stringify(result),
    undo ? JSON.stringify(undo) : null,
    error ? JSON.stringify(error) : null,
    id,
  );
}

/** Finished rows are kept 30 days (DATA.md §10). */
export function prune(db: Db, now: number, max: number): number {
  return db.all(
    `DELETE FROM verbs WHERE id IN (SELECT id FROM verbs WHERE status IN ('done', 'failed', 'expired')
       AND coalesce(done_at, expires_at) < ? LIMIT ?) RETURNING 1`,
    now - 30 * 86_400_000,
    max,
  ).length;
}

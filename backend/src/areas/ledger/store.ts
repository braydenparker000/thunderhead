// SQL for the ledger inside Core (DATA.md §4.3). `insert` is called only by objects/commit.ts.
import type { Actor, LedgerEntry, LedgerKind } from '../../../../shared/contract/api';
import type { Db } from '../../objects/base';

export interface LedgerRow {
  id: string;
  at: number;
  actor: Actor;
  session_id: string | null;
  kind: LedgerKind;
  what: string;
  why: string;
  ref: string | null;
  topic_key: string | null;
  undo_json: string | null;
  undoable: boolean;
  status: 'done' | 'undone' | 'failed';
  tainted: boolean;
  op_json: string | null;
  verb_id: string | null;
  req_sha256: string | null;
}

/** Only objects/commit.ts calls this. */
export function insert(db: Db, r: LedgerRow): void {
  db.run(
    `INSERT INTO ledger (id, at, actor, session_id, kind, what, why, ref, topic_key, undo_json, undoable, status,
       tainted, op_json, verb_id, req_sha256) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    r.id,
    r.at,
    r.actor,
    r.session_id,
    r.kind,
    r.what.slice(0, 200),
    r.why.slice(0, 500),
    r.ref,
    r.topic_key,
    r.undo_json,
    r.undoable ? 1 : 0,
    r.status,
    r.tainted ? 1 : 0,
    r.op_json,
    r.verb_id,
    r.req_sha256,
  );
}

type Raw = Omit<LedgerEntry, 'undoable' | 'tainted'> & { undoable: number; tainted: number };
const COLS = 'seq, id, at, actor, kind, what, why, ref, topic_key, undoable, status, tainted, proposal_id, undone_at';

const toEntry = (r: Raw): LedgerEntry => ({ ...r, undoable: r.undoable === 1, tainted: r.tainted === 1 });

export interface Full extends LedgerEntry {
  undo_json: string | null;
  session_id: string | null;
  verb_id: string | null;
  req_sha256: string | null;
}

export function byId(db: Db, id: string): Full | null {
  const r = db.one<
    Raw & { undo_json: string | null; session_id: string | null; verb_id: string | null; req_sha256: string | null }
  >(`SELECT ${COLS}, undo_json, session_id, verb_id, req_sha256 FROM ledger WHERE id = ?`, id);
  return r
    ? { ...toEntry(r), undo_json: r.undo_json, session_id: r.session_id, verb_id: r.verb_id, req_sha256: r.req_sha256 }
    : null;
}

/** Newest first; `before` is the previous page's last seq. */
export function page(
  db: Db,
  before: number | null,
  limit: number,
  actor: string | null,
  status: string | null,
): LedgerEntry[] {
  return db
    .all<Raw>(
      `SELECT ${COLS} FROM ledger WHERE (? IS NULL OR seq < ?) AND (? IS NULL OR actor = ?) AND (? IS NULL OR status = ?)
       ORDER BY seq DESC LIMIT ?`,
      before,
      before,
      actor,
      actor,
      status,
      status,
      limit,
    )
    .map(toEntry);
}

export function setStatus(db: Db, id: string, status: 'done' | 'undone' | 'failed', at: number | null): void {
  db.run('UPDATE ledger SET status = ?, undone_at = coalesce(?, undone_at) WHERE id = ?', status, at, id);
}

/** Ledger rows of the last `ms`, for the briefing. */
export function since(db: Db, at: number, limit: number): LedgerEntry[] {
  return db
    .all<Raw>(`SELECT ${COLS} FROM ledger WHERE at >= ? ORDER BY at DESC, seq DESC LIMIT ?`, at, limit)
    .map(toEntry);
}

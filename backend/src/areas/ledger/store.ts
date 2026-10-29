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
  proposal_id: string | null;
}

/** Only objects/commit.ts calls this. */
export function insert(db: Db, r: LedgerRow): void {
  db.run(
    `INSERT INTO ledger (id, at, actor, session_id, kind, what, why, ref, topic_key, undo_json, undoable, status,
       tainted, op_json, verb_id, req_sha256, proposal_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    r.proposal_id,
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

export interface LedgerFilter {
  actor: string | null;
  status: string | null;
  /** Rows at or after this time (ms), read through the `ledger_at` index. */
  since: number | null;
  kind: string | null;
}

/** Newest first; `before` is the previous page's last seq. With `since`, the time index bounds the
 * read; without it, the newest rows are read from the end. */
export function page(db: Db, before: number | null, limit: number, f: LedgerFilter): LedgerEntry[] {
  const [range, order] = f.since === null ? ['', 'seq DESC'] : ['at >= ? AND ', 'at DESC, seq DESC'];
  return db
    .all<Raw>(
      `SELECT ${COLS} FROM ledger WHERE ${range}(? IS NULL OR seq < ?) AND (? IS NULL OR actor = ?)
       AND (? IS NULL OR status = ?) AND (? IS NULL OR kind = ?) ORDER BY ${order} LIMIT ?`,
      ...(f.since === null ? [] : [f.since]),
      before,
      before,
      f.actor,
      f.actor,
      f.status,
      f.status,
      f.kind,
      f.kind,
      limit,
    )
    .map(toEntry);
}

/** Rows written in [from, to), oldest first, after (`at`, `seq`) when given: a range on `ledger_at`
 * (which holds seq), starting at the cursor's own time, so a page reads about its own rows. */
export function between(
  db: Db,
  from: number,
  to: number,
  after: [number, number] | null,
  limit: number,
): LedgerEntry[] {
  const lo = after ? Math.max(from, after[0]) : from;
  return db
    .all<Raw>(
      `SELECT ${COLS} FROM ledger WHERE at >= ? AND at < ? AND (at > ? OR seq > ?) ORDER BY at, seq LIMIT ?`,
      lo,
      to,
      lo,
      after ? after[1] : -1,
      limit,
    )
    .map(toEntry);
}

export function countBetween(db: Db, from: number, to: number): number {
  return db.one<{ n: number }>('SELECT count(*) AS n FROM ledger WHERE at >= ? AND at < ?', from, to)?.n ?? 0;
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

/** The undo row written with an inverse verb (same commit, so the same `at`; the time index
 * keeps the read to that instant). For inverses queued before they carried the link. */
export function undoRowFor(db: Db, verbId: string, at: number): string | null {
  return (
    db.one<{ id: string }>("SELECT id FROM ledger WHERE at = ? AND kind = 'undo' AND verb_id = ?", at, verbId)?.id ??
    null
  );
}

/** Forget (MEMORY.md §3): the memory rows that pointed at the forgotten versions keep their time
 * and kind but lose their words and their undo. Rows are read through the time index from the
 * first version's `recorded_at` (no memory row about a fact is older than the fact). */
export function scrubMemory(db: Db, refs: string[], since: number): number {
  if (!refs.length) return 0;
  return db.run(
    `UPDATE ledger SET why = 'the owner forgot this', undo_json = NULL, undoable = 0, op_json = NULL
     WHERE at >= ? AND kind = 'memory' AND ref IN (${refs.map(() => '?').join(', ')})`,
    since,
    ...refs,
  );
}

/** `LIKE` patterns for ids, in groups small enough for one statement each, so a scrub reads the
 * rows in its window once per group instead of once per id. */
function likeGroups(ids: string[]): string[][] {
  const pats = ids.map((id) => `%${id.replace(/[%_]/g, '')}%`);
  const out: string[][] = [];
  for (let i = 0; i < pats.length; i += 40) out.push(pats.slice(i, i + 40));
  return out;
}
const anyLike = (col: string, group: string[]) => `(${group.map(() => `${col} LIKE ?`).join(' OR ')})`;

/** Arrangement rows that drew on forgotten facts keep their time and slot but lose their words
 * and their undo: one row by id, or every row since `since` whose `op_json` lists one of `facts`
 * (a surface put records the facts it cites there), read through the time index. */
export function scrubArrangements(
  db: Db,
  which: { id: string } | { facts: string[]; since: number },
  why: string,
): number {
  const set = 'UPDATE ledger SET why = ?, undo_json = NULL, undoable = 0';
  if ('id' in which) return db.run(`${set} WHERE id = ? AND kind = 'arrangement'`, why, which.id);
  let n = 0;
  for (const g of likeGroups(which.facts))
    n += db.run(`${set} WHERE at >= ? AND kind = 'arrangement' AND ${anyLike('op_json', g)}`, why, which.since, ...g);
  return n;
}

/** Arrangement rows since `since` whose stored undo mentions one of these ids (a surface citing a
 * muted or forgotten fact) lose that undo, so nothing can put the surface back. */
export function scrubUndo(db: Db, ids: string[], since: number): number {
  let n = 0;
  for (const g of likeGroups(ids))
    n += db.run(
      `UPDATE ledger SET undo_json = NULL, undoable = 0 WHERE at >= ? AND kind = 'arrangement' AND ${anyLike('undo_json', g)}`,
      since,
      ...g,
    );
  return n;
}

/** The mind's ledger rows by kind, for the eval sandbox's report (its ledger is one fixture's). */
export function mindKinds(db: Db): Record<string, number> {
  const rows = db.all<{ kind: string; n: number }>(
    "SELECT kind, count(*) AS n FROM ledger WHERE actor LIKE 'mind:%' GROUP BY kind",
  );
  return Object.fromEntries(rows.map((r) => [r.kind, r.n]));
}

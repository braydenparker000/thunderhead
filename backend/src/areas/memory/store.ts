// SQL for facts inside Core (DATA.md §4.4): the bi-temporal rows and their external-content FTS5
// index, written in the same transaction as the row (no triggers). Versions are never edited in
// place except `confirm` (confidence, last_confirmed) and the owner's flags; `forget` deletes a
// whole lineage. Every read is bounded by a LIMIT or a key. Stores never write the change feed or
// the ledger; the caller's commit does (objects/commit.ts).
import {
  decayed,
  type Fact,
  type FactAbout,
  type FactKind,
  type FactSource,
} from '../../../../shared/contract/memory.ts';
import type { Db } from '../../objects/base';

export interface FactRow {
  seq: number;
  id: string;
  kind: FactKind;
  about: FactAbout;
  subject: string | null;
  text: string;
  tags_json: string | null;
  source: FactSource;
  confidence: number;
  evidence_json: string;
  valid_from: number | null;
  valid_to: number | null;
  recorded_at: number;
  superseded_at: number | null;
  superseded_by: string | null;
  last_confirmed: number;
  sensitivity: 0 | 1;
  pinned: number;
  may_raise: number;
  written_by: string;
  ledger_id: string | null;
  /** The first version's id, shared by every version (forget deletes by it). */
  lineage_id: string;
}

const FACT_COLS =
  'seq, id, kind, about, subject, text, tags_json, source, confidence, evidence_json, valid_from, valid_to, recorded_at, superseded_at, superseded_by, last_confirmed, sensitivity, pinned, may_raise, written_by, ledger_id, lineage_id';

/** A JSON array column, read defensively: anything but an array of strings reads as empty. */
export function strings(json: string | null): string[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function toFact(r: FactRow, now: number): Fact {
  return {
    id: r.id,
    kind: r.kind,
    about: r.about,
    subject: r.subject,
    text: r.text,
    tags: strings(r.tags_json),
    source: r.source,
    confidence: r.confidence,
    confidence_now: Math.round(decayed(r, now) * 1000) / 1000,
    evidence: strings(r.evidence_json),
    valid_from: r.valid_from,
    valid_to: r.valid_to,
    recorded_at: r.recorded_at,
    superseded_at: r.superseded_at,
    superseded_by: r.superseded_by,
    last_confirmed: r.last_confirmed,
    sensitivity: r.sensitivity === 1 ? 1 : 0,
    pinned: r.pinned === 1,
    may_raise: r.may_raise === 1,
    written_by: r.written_by,
    ledger_id: r.ledger_id,
  };
}

export function fact(db: Db, id: string): FactRow | null {
  return db.one<FactRow>(`SELECT ${FACT_COLS} FROM facts WHERE id = ?`, id);
}

export type NewFact = Omit<FactRow, 'seq'>;

export function insertFact(db: Db, f: NewFact): void {
  db.run(
    `INSERT INTO facts (id, kind, about, subject, text, tags_json, source, confidence, evidence_json, valid_from, valid_to,
       recorded_at, superseded_at, superseded_by, last_confirmed, sensitivity, pinned, may_raise, written_by, ledger_id,
       lineage_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    f.id,
    f.kind,
    f.about,
    f.subject,
    f.text,
    f.tags_json,
    f.source,
    f.confidence,
    f.evidence_json,
    f.valid_from,
    f.valid_to,
    f.recorded_at,
    f.superseded_at,
    f.superseded_by,
    f.last_confirmed,
    f.sensitivity,
    f.pinned,
    f.may_raise,
    f.written_by,
    f.ledger_id,
    f.lineage_id,
  );
  db.run('INSERT INTO facts_fts (rowid, text, subject) VALUES (last_insert_rowid(), ?, ?)', f.text, f.subject ?? '');
}

/** Closes a version: superseded now (by `by`, or by nothing for an undone add). */
export function closeFact(db: Db, id: string, at: number, by: string | null, validTo: number | null): void {
  db.run(
    'UPDATE facts SET superseded_at = ?, superseded_by = ?, valid_to = coalesce(?, valid_to) WHERE id = ?',
    at,
    by,
    validTo,
    id,
  );
}

/** Undoes a close: the version is current again, with its world time as it was. */
export function reopenFact(db: Db, id: string, validTo: number | null): void {
  db.run('UPDATE facts SET superseded_at = NULL, superseded_by = NULL, valid_to = ? WHERE id = ?', validTo, id);
}

export function confirmFact(db: Db, id: string, confidence: number, at: number): void {
  db.run('UPDATE facts SET confidence = ?, last_confirmed = ? WHERE id = ?', confidence, at, id);
}

export function setFlag(db: Db, id: string, flag: 'pinned' | 'may_raise', on: boolean): void {
  db.run(`UPDATE facts SET ${flag === 'pinned' ? 'pinned' : 'may_raise'} = ? WHERE id = ?`, on ? 1 : 0, id);
}

/** The newest current facts other than rules, read backwards by `seq` (NOT INDEXED: the scan
 * stops at the limit, where the kind index would read every current fact first). */
export function recentCurrent(db: Db, limit: number): FactRow[] {
  return db.all<FactRow>(
    `SELECT ${FACT_COLS} FROM facts NOT INDEXED WHERE superseded_at IS NULL AND kind != 'rule' ORDER BY seq DESC LIMIT ?`,
    limit,
  );
}

/** Current versions of the given kinds (the `facts_current` index), newest first. */
export function currentFacts(db: Db, kinds: readonly string[], limit: number): FactRow[] {
  if (!kinds.length) return [];
  return db.all<FactRow>(
    `SELECT ${FACT_COLS} FROM facts WHERE superseded_at IS NULL AND kind IN (${kinds.map(() => '?').join(', ')})
     ORDER BY seq DESC LIMIT ?`,
    ...kinds,
    limit,
  );
}

export interface FactsFilter {
  kind: string | null;
  subject: string | null;
  includeSuperseded: boolean;
}

/** One page of facts, newest first; `before` is the previous page's last seq. */
export function factsPage(db: Db, f: FactsFilter, before: number | null, limit: number): FactRow[] {
  return db.all<FactRow>(
    `SELECT ${FACT_COLS} FROM facts
     WHERE (? = 1 OR superseded_at IS NULL) AND (? IS NULL OR kind = ?) AND (? IS NULL OR subject = ?)
       AND (? IS NULL OR seq < ?)
     ORDER BY seq DESC LIMIT ?`,
    f.includeSuperseded ? 1 : 0,
    f.kind,
    f.kind,
    f.subject,
    f.subject,
    before,
    before,
    limit,
  );
}

/** Every version of a fact's lineage (the `facts_lineage` index), at most 500. Undo can unlink
 * versions from each other; the lineage id still holds them together. */
export function lineage(db: Db, id: string): FactRow[] {
  return db.all<FactRow>(
    `SELECT ${FACT_COLS} FROM facts WHERE lineage_id = (SELECT lineage_id FROM facts WHERE id = ?) LIMIT 500`,
    id,
  );
}

/** Whether an id was forgotten (it is never used again). */
export function forgotten(db: Db, id: string): boolean {
  return db.one('SELECT 1 AS x FROM fact_tombstones WHERE id = ?', id) !== null;
}

/** Hard delete (forget): the FTS entries first (external content needs the old values), then
 * the rows (each id kept as a tombstone, no text), then an FTS `optimize`, which rewrites the
 * index so the forgotten words leave its segments too (a plain FTS5 delete only marks them;
 * measured in workerd). */
export function deleteFacts(db: Db, rows: FactRow[], at: number): void {
  for (const r of rows) {
    db.run(
      `INSERT INTO facts_fts (facts_fts, rowid, text, subject) VALUES ('delete', ?, ?, ?)`,
      r.seq,
      r.text,
      r.subject ?? '',
    );
    db.run('DELETE FROM facts WHERE seq = ?', r.seq);
    db.run(
      'INSERT OR IGNORE INTO fact_tombstones (id, lineage_id, forgotten_at) VALUES (?, ?, ?)',
      r.id,
      r.lineage_id,
      at,
    );
  }
  if (rows.length) db.run(`INSERT INTO facts_fts (facts_fts) VALUES ('optimize')`);
}

/** The flags surfaces check (muted, sensitive) for the facts a surface cites. */
export function factFlags(db: Db, ids: string[]): { id: string; may_raise: number; sensitivity: number }[] {
  if (!ids.length) return [];
  return db.all(`SELECT id, may_raise, sensitivity FROM facts WHERE id IN (${ids.map(() => '?').join(', ')})`, ...ids);
}

/** The `facts` search source (MEMORY.md §10): current versions only, bm25, a «»-marked snippet. */
export function searchFacts(db: Db, match: string, since: number | null, until: number | null, limit: number) {
  return db.all<{ id: string; recorded_at: number; snippet: string; score: number }>(
    `SELECT f.id, f.recorded_at, snippet(facts_fts, -1, '«', '»', '…', 24) AS snippet, bm25(facts_fts) AS score
     FROM facts_fts JOIN facts f ON f.seq = facts_fts.rowid
     WHERE facts_fts MATCH ? AND f.superseded_at IS NULL
       AND (? IS NULL OR f.recorded_at >= ?) AND (? IS NULL OR f.recorded_at < ?)
     ORDER BY score LIMIT ?`,
    match,
    since,
    since,
    until,
    until,
    limit,
  );
}

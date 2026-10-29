// SQL for day notes, open threads and the batch idempotency window inside Core (DATA.md §4.4,
// API.md §7). Day notes keep an external-content FTS5 index, written in the same transaction as
// the row. Every read is bounded by a LIMIT or a key; stores never write the feed or the ledger.
import type { DayNote, OpenThread, OpenThreadStatus } from '../../../../shared/contract/memory.ts';
import { DAY } from '../../lib/time';
import type { Db } from '../../objects/base';
import { strings } from './store';

// --- day notes ---------------------------------------------------------------------------------

export interface DayNoteRow {
  seq: number;
  day: string;
  summary: string;
  decisions_json: string | null;
  stats_json: string | null;
  importance: number;
  written_by: string;
  version: number;
  written_at: number;
}

const NOTE_COLS = 'seq, day, summary, decisions_json, stats_json, importance, written_by, version, written_at';

function stats(json: string | null): Record<string, number> {
  if (!json) return {};
  try {
    const v = JSON.parse(json) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(v).filter((e): e is [string, number] => typeof e[1] === 'number'));
  } catch {
    return {};
  }
}

export function toDayNote(r: DayNoteRow): DayNote {
  return {
    day: r.day,
    summary: r.summary,
    decisions: strings(r.decisions_json),
    stats: stats(r.stats_json),
    importance: r.importance,
    written_by: r.written_by,
    version: r.version,
    written_at: r.written_at,
  };
}

export function dayNote(db: Db, day: string): DayNoteRow | null {
  return db.one<DayNoteRow>(`SELECT ${NOTE_COLS} FROM day_notes WHERE day = ?`, day);
}

/** Writes a day's note: a new row, or the next version over the old one (its FTS entry swapped). */
export function putDayNote(db: Db, n: Omit<DayNoteRow, 'seq'>, old: DayNoteRow | null): void {
  if (old) {
    db.run(`INSERT INTO day_notes_fts (day_notes_fts, rowid, summary) VALUES ('delete', ?, ?)`, old.seq, old.summary);
    db.run(
      `UPDATE day_notes SET summary = ?, decisions_json = ?, stats_json = ?, importance = ?, written_by = ?, version = ?,
         written_at = ? WHERE seq = ?`,
      n.summary,
      n.decisions_json,
      n.stats_json,
      n.importance,
      n.written_by,
      n.version,
      n.written_at,
      old.seq,
    );
    db.run('INSERT INTO day_notes_fts (rowid, summary) VALUES (?, ?)', old.seq, n.summary);
    return;
  }
  db.run(
    `INSERT INTO day_notes (day, summary, decisions_json, stats_json, importance, written_by, version, written_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    n.day,
    n.summary,
    n.decisions_json,
    n.stats_json,
    n.importance,
    n.written_by,
    n.version,
    n.written_at,
  );
  db.run('INSERT INTO day_notes_fts (rowid, summary) VALUES (last_insert_rowid(), ?)', n.summary);
}

/** Removes a day note (the undo of its first version). */
export function deleteDayNote(db: Db, old: DayNoteRow): void {
  db.run(`INSERT INTO day_notes_fts (day_notes_fts, rowid, summary) VALUES ('delete', ?, ?)`, old.seq, old.summary);
  db.run('DELETE FROM day_notes WHERE seq = ?', old.seq);
}

/** Day notes between two days (inclusive), newest first. */
export function dayNotes(db: Db, from: string | null, to: string | null, limit: number): DayNoteRow[] {
  return db.all<DayNoteRow>(
    `SELECT ${NOTE_COLS} FROM day_notes WHERE (? IS NULL OR day >= ?) AND (? IS NULL OR day <= ?)
     ORDER BY day DESC LIMIT ?`,
    from,
    from,
    to,
    to,
    limit,
  );
}

export function searchDayNotes(db: Db, match: string, since: number | null, until: number | null, limit: number) {
  return db.all<{ day: string; written_at: number; snippet: string; score: number }>(
    `SELECT n.day, n.written_at, snippet(day_notes_fts, 0, '«', '»', '…', 24) AS snippet, bm25(day_notes_fts) AS score
     FROM day_notes_fts JOIN day_notes n ON n.seq = day_notes_fts.rowid
     WHERE day_notes_fts MATCH ? AND (? IS NULL OR n.written_at >= ?) AND (? IS NULL OR n.written_at < ?)
     ORDER BY score LIMIT ?`,
    match,
    since,
    since,
    until,
    until,
    limit,
  );
}

// --- open threads ------------------------------------------------------------------------------

export interface OpenThreadRow {
  id: string;
  text: string;
  owner: 'mind' | 'owner';
  due_at: number | null;
  tags_json: string | null;
  status: OpenThreadStatus;
  evidence_json: string;
  opened_at: number;
  last_progress_at: number | null;
  closed_at: number | null;
  closed_why: string | null;
}

const THREAD_COLS =
  'id, text, owner, due_at, tags_json, status, evidence_json, opened_at, last_progress_at, closed_at, closed_why';

export function toOpenThread(r: OpenThreadRow): OpenThread {
  const { tags_json, evidence_json, ...rest } = r;
  return { ...rest, tags: strings(tags_json), evidence: strings(evidence_json) };
}

export function openThread(db: Db, id: string): OpenThreadRow | null {
  return db.one<OpenThreadRow>(`SELECT ${THREAD_COLS} FROM open_threads WHERE id = ?`, id);
}

export function putOpenThread(db: Db, t: OpenThreadRow): void {
  db.run(
    `INSERT INTO open_threads (${THREAD_COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET text = excluded.text, owner = excluded.owner, due_at = excluded.due_at,
       tags_json = excluded.tags_json, status = excluded.status, evidence_json = excluded.evidence_json,
       opened_at = excluded.opened_at, last_progress_at = excluded.last_progress_at, closed_at = excluded.closed_at,
       closed_why = excluded.closed_why`,
    t.id,
    t.text,
    t.owner,
    t.due_at,
    t.tags_json,
    t.status,
    t.evidence_json,
    t.opened_at,
    t.last_progress_at,
    t.closed_at,
    t.closed_why,
  );
}

/** Whether two loose-end rows hold the same values (an undo's newest-state check). */
export function sameThread(a: OpenThreadRow | null, b: OpenThreadRow | null): boolean {
  if (!a || !b) return a === b;
  return THREAD_COLS.split(', ').every((k) => a[k as keyof OpenThreadRow] === b[k as keyof OpenThreadRow]);
}

export function deleteOpenThread(db: Db, id: string): void {
  db.run('DELETE FROM open_threads WHERE id = ?', id);
}

/** Open threads (due soonest first, the `open_threads_due` index), or the newest of all. */
export function openThreads(db: Db, status: 'open' | 'all', limit: number): OpenThreadRow[] {
  if (status === 'open')
    return db.all<OpenThreadRow>(
      `SELECT ${THREAD_COLS} FROM open_threads WHERE status = 'open'
       ORDER BY due_at IS NULL, due_at, opened_at LIMIT ?`,
      limit,
    );
  return db.all<OpenThreadRow>(
    `SELECT ${THREAD_COLS} FROM open_threads ORDER BY status != 'open', coalesce(closed_at, opened_at) DESC LIMIT ?`,
    limit,
  );
}

// --- the batch idempotency window (API.md §7) ---------------------------------------------------

export interface BatchRow {
  key: string;
  route: string;
  req_sha256: string;
  status: number;
  result_json: string;
  at: number;
}

export function batch(db: Db, key: string): BatchRow | null {
  return db.one<BatchRow>('SELECT key, route, req_sha256, status, result_json, at FROM op_batches WHERE key = ?', key);
}

export function putBatch(db: Db, b: BatchRow): void {
  db.run(
    'INSERT INTO op_batches (key, route, req_sha256, status, result_json, at) VALUES (?, ?, ?, ?, ?, ?)',
    b.key,
    b.route,
    b.req_sha256,
    b.status,
    b.result_json,
    b.at,
  );
}

// --- retention (DATA.md §10) -------------------------------------------------------------------

/** Closed open threads go a year after they closed; open ones stay until closed. */
export function pruneThreads(db: Db, now: number, max: number): number {
  return db.all(
    `DELETE FROM open_threads WHERE id IN
       (SELECT id FROM open_threads WHERE status != 'open' AND closed_at < ? LIMIT ?) RETURNING 1`,
    now - 365 * DAY,
    max,
  ).length;
}

export function pruneBatches(db: Db, now: number, max: number): number {
  return db.all(
    'DELETE FROM op_batches WHERE key IN (SELECT key FROM op_batches WHERE at < ? LIMIT ?) RETURNING 1',
    now - 7 * DAY,
    max,
  ).length;
}

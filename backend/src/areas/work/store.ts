// SQL for work orders and Muse's thread (migrations.ts).
import type { MuseNote, WorkKind, WorkOrder, WorkStatus } from '../../../../shared/contract/work.ts';
import { WORK_KINDS, WORK_LIMITS } from '../../../../shared/contract/work.ts';
import { DAY } from '../../lib/time';
import type { Db } from '../../objects/base';

export interface OrderRow {
  id: string;
  kind: WorkKind;
  assignee: 'muse';
  title: string;
  spec_json: string;
  personal: number;
  approval_id: string | null;
  recurrence: string | null;
  day: string | null;
  deadline_at: number;
  status: WorkStatus;
  attempts: number;
  created_by: string;
  created_at: number;
  claimed_at: number | null;
  heartbeat_at: number | null;
  heartbeat_note: string | null;
  result_json: string | null;
  result_valid: number | null;
  result_errors_json: string | null;
  finished_at: number | null;
}

export const OPEN: WorkStatus[] = ['queued', 'claimed'];

export const order = (db: Db, id: string) => db.one<OrderRow>('SELECT * FROM work_orders WHERE id = ?', id);

export function insertOrder(
  db: Db,
  r: {
    id: string;
    kind: WorkKind;
    title: string;
    spec: unknown;
    day: string | null;
    recurrence: string | null;
    deadline_at: number;
    created_by: string;
    at: number;
  },
): void {
  db.run(
    `INSERT INTO work_orders (id, kind, assignee, title, spec_json, personal, recurrence, day, deadline_at, status, created_by, created_at)
     VALUES (?, ?, 'muse', ?, ?, 0, ?, ?, ?, 'queued', ?, ?)`,
    r.id,
    r.kind,
    r.title,
    JSON.stringify(r.spec),
    r.recurrence,
    r.day,
    r.deadline_at,
    r.created_by,
    r.at,
  );
}

export function setStatus(db: Db, id: string, s: Partial<OrderRow> & { status: WorkStatus }): void {
  const cols = Object.keys(s) as (keyof OrderRow)[];
  db.run(
    `UPDATE work_orders SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
    ...cols.map((c) => s[c] as SqlStorageValue),
    id,
  );
}

/** The oldest queued order for Muse whose deadline hasn't passed. */
export const nextQueued = (db: Db, now: number) =>
  db.one<OrderRow>(
    "SELECT * FROM work_orders WHERE status = 'queued' AND assignee = 'muse' AND deadline_at > ? ORDER BY created_at LIMIT 1",
    now,
  );

/** Muse holds one order at a time. */
export const claimed = (db: Db) => db.one<OrderRow>("SELECT * FROM work_orders WHERE status = 'claimed' LIMIT 1");

export const open = (db: Db) =>
  db.all<OrderRow>("SELECT * FROM work_orders WHERE status IN ('queued', 'claimed') ORDER BY created_at LIMIT 100");

export const forDay = (db: Db, kind: WorkKind, day: string) =>
  db.all<OrderRow>('SELECT * FROM work_orders WHERE kind = ? AND day = ? ORDER BY created_at', kind, day);

/** The newest valid result of a kind for one of `days`, newest day first. */
export function latestDone(db: Db, kind: WorkKind, days: string[]): OrderRow | null {
  for (const d of days) {
    const r = db.one<OrderRow>(
      "SELECT * FROM work_orders WHERE kind = ? AND day = ? AND status = 'done' ORDER BY finished_at DESC LIMIT 1",
      kind,
      d,
    );
    if (r) return r;
  }
  return null;
}

export function list(db: Db, limit: number, status?: WorkStatus): OrderRow[] {
  return status
    ? db.all<OrderRow>('SELECT * FROM work_orders WHERE status = ? ORDER BY created_at DESC LIMIT ?', status, limit)
    : db.all<OrderRow>('SELECT * FROM work_orders ORDER BY created_at DESC LIMIT ?', limit);
}

const json = (s: string | null) => (s === null ? null : (JSON.parse(s) as unknown));

export function toOrder(r: OrderRow): WorkOrder {
  return {
    id: r.id,
    kind: r.kind,
    assignee: r.assignee,
    title: r.title,
    spec: json(r.spec_json) as Record<string, unknown>,
    schema: WORK_KINDS[r.kind]?.schema ?? {},
    status: r.status,
    attempts: r.attempts,
    deadline_at: r.deadline_at,
    created_by: r.created_by,
    created_at: r.created_at,
    claimed_at: r.claimed_at,
    heartbeat_at: r.heartbeat_at,
    heartbeat_note: r.heartbeat_note,
    result: json(r.result_json),
    result_valid: r.result_valid === null ? null : r.result_valid === 1,
    result_errors: json(r.result_errors_json) as string[] | null,
    finished_at: r.finished_at,
    origin: 'muse',
  };
}

export function insertNote(db: Db, n: { id: string; author: MuseNote['author']; body: string; at: number }): void {
  db.run(
    'INSERT INTO muse_notes (id, author, body, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (id) DO NOTHING',
    n.id,
    n.author,
    n.body,
    n.at,
  );
}
export const note = (db: Db, id: string) =>
  db.one<MuseNote>('SELECT seq, id, author, body, created_at FROM muse_notes WHERE id = ?', id);
export const notesAfter = (db: Db, after: number, limit: number) =>
  db.all<MuseNote>(
    'SELECT seq, id, author, body, created_at FROM muse_notes WHERE seq > ? ORDER BY seq LIMIT ?',
    after,
    limit,
  );

/** A finished order goes a year after it finished (DATA.md §10). */
export function pruneOrders(db: Db, now: number, max: number): number {
  return db.all(
    "DELETE FROM work_orders WHERE id IN (SELECT id FROM work_orders WHERE status NOT IN ('queued', 'claimed') AND coalesce(finished_at, created_at) < ? LIMIT ?) RETURNING 1",
    now - 365 * DAY,
    max,
  ).length;
}

/** Muse's thread keeps its newest 500 notes. */
export function pruneNotes(db: Db, _now: number, max: number): number {
  return db.all(
    'DELETE FROM muse_notes WHERE seq IN (SELECT seq FROM muse_notes ORDER BY seq DESC LIMIT -1 OFFSET ?) AND seq IN (SELECT seq FROM muse_notes ORDER BY seq LIMIT ?) RETURNING 1',
    WORK_LIMITS.notes_kept,
    max,
  ).length;
}

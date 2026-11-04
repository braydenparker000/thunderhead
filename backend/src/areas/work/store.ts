// SQL for work orders and Muse's thread (migrations.ts).
import type { MuseNote, TaskState, WorkKind, WorkOrder, WorkStatus } from '../../../../shared/contract/work.ts';
import { ASKED_KINDS, WORK_KINDS, WORK_LIMITS } from '../../../../shared/contract/work.ts';
import { DAY } from '../../lib/time';
import type { Db } from '../../objects/base';

export interface OrderRow {
  id: string;
  /** A kind of this build, or a Board-era one (`legacy` on the wire). */
  kind: string;
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
  message_id: string | null;
  said: TaskState | null;
  invalid: number;
}

export const OPEN: WorkStatus[] = ['queued', 'claimed'];
export const known = (kind: string): kind is WorkKind => Object.hasOwn(WORK_KINDS, kind);
/** The kinds Muse claims, as SQL: a legacy row is never handed out again. */
const ASKED = ASKED_KINDS.map((k) => `'${k}'`).join(', ');

export const order = (db: Db, id: string) => db.one<OrderRow>('SELECT * FROM work_orders WHERE id = ?', id);

export function insertOrder(
  db: Db,
  r: {
    id: string;
    kind: WorkKind;
    title: string;
    spec: unknown;
    deadline_at: number;
    created_by: string;
    at: number;
    message_id?: string | null;
    status?: 'queued' | 'claimed';
    /** Its words carry the owner's data (`muse.order_personal`, the reach-people floor). */
    personal?: boolean;
  },
): void {
  const status = r.status ?? 'queued';
  db.run(
    `INSERT INTO work_orders (id, kind, assignee, title, spec_json, personal, deadline_at, status, created_by, created_at, claimed_at, heartbeat_at, message_id)
     VALUES (?, ?, 'muse', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    r.id,
    r.kind,
    r.title,
    JSON.stringify(r.spec),
    r.personal ? 1 : 0,
    r.deadline_at,
    status,
    r.created_by,
    r.at,
    status === 'claimed' ? r.at : null,
    status === 'claimed' ? r.at : null,
    r.message_id ?? null,
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

/** The last state an order's conversation was told (lines.ts). */
export const setSaid = (db: Db, id: string, said: TaskState) =>
  db.run('UPDATE work_orders SET said = ? WHERE id = ?', said, id);

/** The oldest queued order for Muse whose deadline hasn't passed. */
export const nextQueued = (db: Db, now: number) =>
  db.one<OrderRow>(
    `SELECT * FROM work_orders WHERE status = 'queued' AND assignee = 'muse' AND kind IN (${ASKED}) AND deadline_at > ? ORDER BY created_at LIMIT 1`,
    now,
  );

/** Muse holds one order at a time (an upload batch is the Worker's record, not a claim). */
export const claimed = (db: Db) =>
  db.one<OrderRow>(`SELECT * FROM work_orders WHERE status = 'claimed' AND kind IN (${ASKED}) LIMIT 1`);

/** The upload batch still open, if any. */
export const openBatch = (db: Db) =>
  db.one<OrderRow>(
    "SELECT * FROM work_orders WHERE status = 'claimed' AND kind = 'muse.upload_batch' ORDER BY created_at DESC LIMIT 1",
  );

export const open = (db: Db) =>
  db.all<OrderRow>("SELECT * FROM work_orders WHERE status IN ('queued', 'claimed') ORDER BY created_at LIMIT 100");

export function list(db: Db, limit: number, status?: WorkStatus): OrderRow[] {
  return status
    ? db.all<OrderRow>('SELECT * FROM work_orders WHERE status = ? ORDER BY created_at DESC LIMIT ?', status, limit)
    : db.all<OrderRow>('SELECT * FROM work_orders ORDER BY created_at DESC LIMIT ?', limit);
}

const json = (s: string | null) => (s === null ? null : (JSON.parse(s) as unknown));

/** What the owner sees: a claim Muse has said anything on since (a heartbeat or a progress line) is
 * working; a rejected, failed or expired one failed. */
export function stateOf(r: Pick<OrderRow, 'status' | 'claimed_at' | 'heartbeat_at' | 'heartbeat_note'>): TaskState {
  switch (r.status) {
    case 'queued':
      return 'asked';
    case 'claimed':
      return r.heartbeat_note !== null || (r.heartbeat_at ?? 0) > (r.claimed_at ?? 0) ? 'working' : 'picked_up';
    case 'done':
      return 'done';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'failed';
  }
}

export function toOrder(r: OrderRow): WorkOrder {
  return {
    id: r.id,
    kind: known(r.kind) ? r.kind : 'legacy',
    assignee: r.assignee,
    title: r.title,
    spec: json(r.spec_json) as Record<string, unknown>,
    schema: known(r.kind) ? WORK_KINDS[r.kind].schema : {},
    status: r.status,
    state: stateOf(r),
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
    message_id: r.message_id,
    origin: 'muse',
  };
}

const NOTE_COLS = 'seq, id, author, body, order_id, created_at';

export function insertNote(
  db: Db,
  n: { id: string; author: MuseNote['author']; body: string; order_id: string | null; at: number },
): void {
  db.run(
    'INSERT INTO muse_notes (id, author, body, order_id, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING',
    n.id,
    n.author,
    n.body,
    n.order_id,
    n.at,
  );
}
export const note = (db: Db, id: string) => db.one<MuseNote>(`SELECT ${NOTE_COLS} FROM muse_notes WHERE id = ?`, id);
export const notesAfter = (db: Db, after: number, limit: number) =>
  db.all<MuseNote>(`SELECT ${NOTE_COLS} FROM muse_notes WHERE seq > ? ORDER BY seq LIMIT ?`, after, limit);
/** One order's progress lines, oldest first. */
export const notesOf = (db: Db, orderId: string, after: number, limit: number) =>
  db.all<MuseNote>(
    `SELECT ${NOTE_COLS} FROM muse_notes WHERE order_id = ? AND seq > ? ORDER BY seq LIMIT ?`,
    orderId,
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

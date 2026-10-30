// SQL for the owner's reminders inside Core (DATA.md §4.3). A row is `set` until Core's alarm
// delivers it (`done`, with the conversation line it became) or the owner takes it back
// (`cancelled`; the row stays). `push_until` is how long a delivered reminder's push is offered to
// the push outbox, null when it pushes nothing. Stores never write the change feed; the caller's
// commit does (objects/commit.ts).
import type { Reminder } from '../../../../shared/contract/reminders.ts';
import type { Db } from '../../objects/base';

export interface ReminderRow extends Reminder {
  source_message_id: string | null;
  cancelled_at: number | null;
  push_until: number | null;
  req_sha256: string;
}

const COLS =
  'id, text, at, fire_at, state, origin, source_message_id, created_at, fired_at, cancelled_at, message_id, push_until, req_sha256';
const CLOSED = 'coalesce(fired_at, cancelled_at)';

/** The wire shape: the source message, the push window and the request hash stay inside. */
export const shown = (r: ReminderRow): Reminder => ({
  id: r.id,
  text: r.text,
  at: r.at,
  fire_at: r.fire_at,
  state: r.state,
  origin: r.origin,
  created_at: r.created_at,
  fired_at: r.fired_at,
  message_id: r.message_id,
});

export const byId = (db: Db, id: string) => db.one<ReminderRow>(`SELECT ${COLS} FROM reminders WHERE id = ?`, id);

export function insert(db: Db, r: Omit<ReminderRow, 'fired_at' | 'cancelled_at' | 'message_id' | 'push_until'>): void {
  db.run(
    `INSERT INTO reminders (id, text, at, fire_at, state, origin, source_message_id, created_at, req_sha256)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    r.id,
    r.text,
    r.at,
    r.fire_at,
    r.state,
    r.origin,
    r.source_message_id,
    r.created_at,
    r.req_sha256,
  );
}

/** Reminders waiting for their time (at most REMINDER_LIMITS.open rows, through the partial index). */
export const openCount = (db: Db) =>
  db.one<{ n: number }>("SELECT count(*) AS n FROM reminders WHERE state = 'set'")?.n ?? 0;

/** Reminders made from one owner message, in any state. */
export const fromMessage = (db: Db, messageId: string) =>
  db.one<{ n: number }>('SELECT count(*) AS n FROM reminders WHERE source_message_id = ?', messageId)?.n ?? 0;

/** When the soonest set reminder is due, or null. */
export const nextFireAt = (db: Db) =>
  db.one<{ t: number }>("SELECT fire_at AS t FROM reminders WHERE state = 'set' ORDER BY fire_at LIMIT 1")?.t ?? null;

/** Set reminders due by `now`, soonest first. */
export const due = (db: Db, now: number, limit: number) =>
  db.all<ReminderRow>(
    `SELECT ${COLS} FROM reminders WHERE state = 'set' AND fire_at <= ? ORDER BY fire_at, id LIMIT ?`,
    now,
    limit,
  );

/** Set reminders soonest first, then those delivered or taken back since `since`, newest first. */
export function list(db: Db, since: number): ReminderRow[] {
  return [
    ...db.all<ReminderRow>(`SELECT ${COLS} FROM reminders WHERE state = 'set' ORDER BY fire_at, id`),
    ...db.all<ReminderRow>(
      `SELECT ${COLS} FROM reminders WHERE state != 'set' AND ${CLOSED} >= ? ORDER BY ${CLOSED} DESC, id DESC`,
      since,
    ),
  ];
}

/** Marks a set reminder delivered with its line. Returns whether this call did it (once only). */
export function markDone(db: Db, id: string, at: number, messageId: string, pushUntil: number | null): boolean {
  return (
    db.all(
      `UPDATE reminders SET state = 'done', fired_at = ?, message_id = ?, push_until = ?
       WHERE id = ? AND state = 'set' RETURNING id`,
      at,
      messageId,
      pushUntil,
      id,
    ).length > 0
  );
}

export function markCancelled(db: Db, id: string, at: number): void {
  db.run("UPDATE reminders SET state = 'cancelled', cancelled_at = ? WHERE id = ? AND state = 'set'", at, id);
}

/** Reminders the mind set since `since` (its pace limit). */
export const mindSince = (db: Db, since: number) =>
  db.one<{ n: number }>("SELECT count(*) AS n FROM reminders WHERE origin = 'mind' AND created_at >= ?", since)?.n ?? 0;

/** Delivered reminders whose push is still offered to the outbox at `now`, by the id of the line
 * each became: made by the Worker at delivery, so no nudge can have taken it first. */
export const pushesOwed = (db: Db, now: number, windowMs: number) =>
  db.all<{ id: string; fired_at: number; push_until: number }>(
    `SELECT message_id AS id, fired_at, push_until FROM reminders
     WHERE state != 'set' AND ${CLOSED} >= ? AND push_until > ? ORDER BY ${CLOSED}, id`,
    now - windowMs,
    now,
  );

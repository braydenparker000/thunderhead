// SQL for the Senses object (DATA.md §6.1): sealed batches (the dedupe, one row a batch), events with
// their one index, the day's rollups by type and ref, and the record of each day's archive.
import type { Db } from '../../objects/base';
import type { CheckedEvent } from './validate';

export interface EventRow extends Omit<CheckedEvent, 'sensitivity'> {
  seq: number;
  day: string;
  device_id: string;
  origin: string;
  sensitivity: number;
}

export function batch(db: Db, id: string): { sha256: string; n: number } | null {
  return db.one('SELECT sha256, n FROM batches WHERE batch_id = ?', id);
}

export function putBatch(db: Db, id: string, device: string, at: number, n: number, sha: string): void {
  db.run(
    'INSERT INTO batches (batch_id, device_id, received_at, n, sha256) VALUES (?, ?, ?, ?, ?)',
    id,
    device,
    at,
    n,
    sha,
  );
}

export function putEvent(db: Db, e: CheckedEvent, day: string, device: string, origin: string): void {
  db.run(
    `INSERT INTO events (id, at, day, app, type, ref, data_json, device_id, origin, sensitivity)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    e.id,
    e.at,
    day,
    e.app,
    e.type,
    e.ref,
    e.data_json,
    device,
    origin,
    e.sensitivity,
  );
}

export function roll(db: Db, day: string, type: string, ref: string, n: number, ms: number): void {
  db.run(
    `INSERT INTO rollups (day, type, ref, n, sum_ms) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (day, type, ref) DO UPDATE SET n = n + excluded.n, sum_ms = sum_ms + excluded.sum_ms`,
    day,
    type,
    ref,
    n,
    ms,
  );
}

export function countsByDay(db: Db, from: string, to: string, type: string | null) {
  return db.all<{ day: string; type: string; n: number; sum_ms: number }>(
    `SELECT day, type, sum(n) AS n, sum(sum_ms) AS sum_ms FROM rollups
     WHERE day >= ? AND day <= ? AND (? IS NULL OR type = ?) GROUP BY day, type ORDER BY day, type`,
    from,
    to,
    type,
    type,
  );
}

export function topRefs(db: Db, type: string, since: string, limit: number) {
  return db.all<{ ref: string; n: number; sum_ms: number }>(
    `SELECT ref, sum(n) AS n, sum(sum_ms) AS sum_ms FROM rollups
     WHERE type = ? AND day >= ? AND ref <> '' GROUP BY ref ORDER BY n DESC, ref LIMIT ?`,
    type,
    since,
    limit,
  );
}

/** One day's events in order, by the (day, type) index; a type prefix narrows it. */
export function sequence(db: Db, day: string, after: number, prefix: string | null, limit: number): EventRow[] {
  return db.all<EventRow>(
    `SELECT * FROM events WHERE day = ? AND seq > ? AND (? IS NULL OR type >= ? AND type < ?)
     ORDER BY seq LIMIT ?`,
    day,
    after,
    prefix,
    prefix,
    prefix === null ? null : `${prefix}\u{10FFFF}`,
    limit,
  );
}

export function lastEvent(db: Db, type: string): EventRow | null {
  return db.one<EventRow>('SELECT * FROM events WHERE type = ? ORDER BY seq DESC LIMIT 1', type);
}

/** A day's events for its archive, in order, a page at a time. */
export function dayEvents(db: Db, day: string, after: number, limit: number): EventRow[] {
  return db.all<EventRow>('SELECT * FROM events WHERE day = ? AND seq > ? ORDER BY seq LIMIT ?', day, after, limit);
}

export function summary(db: Db, day: string) {
  return db.all<{ type: string; n: number; sum_ms: number }>(
    'SELECT type, sum(n) AS n, sum(sum_ms) AS sum_ms FROM rollups WHERE day = ? GROUP BY type ORDER BY n DESC, type',
    day,
  );
}

export const exported = (db: Db, day: string) =>
  db.one<{ r2_key: string }>('SELECT r2_key FROM exports WHERE day = ?', day);

export function putExport(db: Db, day: string, key: string, n: number, sha: string, at: number): void {
  db.run(
    'INSERT INTO exports (day, r2_key, n, sha256, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (day) DO UPDATE SET r2_key = excluded.r2_key, n = excluded.n, sha256 = excluded.sha256, at = excluded.at',
    day,
    key,
    n,
    sha,
    at,
  );
}

/** The days with events older than `before` whose archive exists (only those may be pruned). */
export function prunableDays(db: Db, before: string): string[] {
  return db
    .all<{ day: string }>(
      'SELECT DISTINCT e.day FROM events e JOIN exports x ON x.day = e.day WHERE e.day < ? ORDER BY e.day LIMIT 10',
      before,
    )
    .map((r) => r.day);
}

export function pruneEvents(db: Db, day: string, max: number): number {
  return db.run('DELETE FROM events WHERE seq IN (SELECT seq FROM events WHERE day = ? LIMIT ?)', day, max);
}

export function pruneBatches(db: Db, before: number, max: number): number {
  return db.run(
    'DELETE FROM batches WHERE batch_id IN (SELECT batch_id FROM batches WHERE received_at < ? LIMIT ?)',
    before,
    max,
  );
}

/** Whether a day has any event (one index seek). */
export const hasEvents = (db: Db, day: string) => !!db.one('SELECT 1 AS x FROM events WHERE day = ? LIMIT 1', day);

/** A day's archive is out of date (an event for it arrived late): it is written again. */
export function unmarkExport(db: Db, day: string): void {
  db.run('DELETE FROM exports WHERE day = ?', day);
}

/** A type's events a day from `from` to `to` (inclusive), and the first day it was ever seen: for the
 * predictions' resolvers (P9), counts only. */
export function typeDays(db: Db, type: string, from: string, to: string) {
  return {
    days: countsByDay(db, from, to, type).map((r) => ({ day: r.day, n: r.n })),
    first: db.one<{ day: string | null }>('SELECT min(day) AS day FROM rollups WHERE type = ?', type)?.day ?? null,
  };
}

/** The rollups of some types from `from` to `to` (inclusive): for the meter's kept arrangements (P9). */
export function rollupsFor(db: Db, types: string[], from: string, to: string) {
  if (!types.length) return [];
  return db.all<{ day: string; type: string; ref: string; n: number }>(
    `SELECT day, type, ref, n FROM rollups WHERE day >= ? AND day <= ? AND type IN (${types.map(() => '?').join(', ')})`,
    from,
    to,
    ...types,
  );
}

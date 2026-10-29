// SQL for surfaces and topics inside Core (DATA.md §4.1, §4.3). Stores never write the feed.
import type { Surface } from '../../../../shared/contract/api';
import type { Db } from '../../objects/base';

interface Row {
  app: string;
  slot: string;
  kind: string;
  schema: number;
  payload_json: string;
  why: string;
  topic_key: string;
  ref: string | null;
  expires_at: number | null;
  written_at: number;
  actor: string;
  ledger_id: string | null;
  seq: number;
}

export type SurfaceRow = Row;

export const toSurface = (r: Row): Surface => ({
  app: r.app,
  slot: r.slot,
  kind: r.kind,
  schema: r.schema,
  payload: JSON.parse(r.payload_json),
  why: r.why,
  topic_key: r.topic_key,
  ref: r.ref,
  expires_at: r.expires_at,
  written_at: r.written_at,
  seq: r.seq,
  ledger_id: r.ledger_id,
});

export function get(db: Db, app: string, slot: string): Row | null {
  return db.one<Row>('SELECT * FROM surfaces WHERE app = ? AND slot = ?', app, slot);
}

/** Non-expired surfaces written after `since`. */
export function list(db: Db, since: number, now: number): Surface[] {
  return db
    .all<Row>(
      'SELECT * FROM surfaces WHERE seq > ? AND (expires_at IS NULL OR expires_at > ?) ORDER BY app, slot',
      since,
      now,
    )
    .map(toSurface);
}

export function put(db: Db, r: Row): void {
  db.run(
    `INSERT INTO surfaces (app, slot, kind, schema, payload_json, why, topic_key, ref, expires_at, written_at, actor, ledger_id, seq)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (app, slot) DO UPDATE SET kind = excluded.kind, schema = excluded.schema, payload_json = excluded.payload_json,
       why = excluded.why, topic_key = excluded.topic_key, ref = excluded.ref, expires_at = excluded.expires_at,
       written_at = excluded.written_at, actor = excluded.actor, ledger_id = excluded.ledger_id, seq = excluded.seq`,
    r.app,
    r.slot,
    r.kind,
    r.schema,
    r.payload_json,
    r.why,
    r.topic_key,
    r.ref,
    r.expires_at,
    r.written_at,
    r.actor,
    r.ledger_id,
    r.seq,
  );
}

export function remove(db: Db, app: string, slot: string): void {
  db.run('DELETE FROM surfaces WHERE app = ? AND slot = ?', app, slot);
}

export function topicIgnoredAt(db: Db, key: string): number | null {
  return (
    db.one<{ ignored_at: number | null }>('SELECT ignored_at FROM topics WHERE topic_key = ?', key)?.ignored_at ?? null
  );
}

export function topicShown(db: Db, key: string, at: number): void {
  db.run(
    `INSERT INTO topics (topic_key, last_shown_at, shown_count) VALUES (?, ?, 1)
     ON CONFLICT (topic_key) DO UPDATE SET last_shown_at = excluded.last_shown_at, shown_count = shown_count + 1`,
    key,
    at,
  );
}

export function topicIgnored(db: Db, key: string, at: number): void {
  db.run(
    `INSERT INTO topics (topic_key, ignored_at, shown_count) VALUES (?, ?, 0)
     ON CONFLICT (topic_key) DO UPDATE SET ignored_at = excluded.ignored_at`,
    key,
    at,
  );
}

/** Expired rows go on the next daily pass, so within 24 h of expiry (DATA.md §10). */
export function prune(db: Db, now: number, max: number): number {
  return db.all(
    `DELETE FROM surfaces WHERE (app, slot) IN
       (SELECT app, slot FROM surfaces WHERE expires_at IS NOT NULL AND expires_at <= ? LIMIT ?) RETURNING 1`,
    now,
    max,
  ).length;
}

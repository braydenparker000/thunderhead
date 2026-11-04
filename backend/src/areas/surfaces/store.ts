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
  /** The fact ids it draws on (P3); absent in rows written before. */
  facts_json?: string | null;
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
    `INSERT INTO surfaces (app, slot, kind, schema, payload_json, why, topic_key, ref, expires_at, written_at, actor, ledger_id, seq,
       facts_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (app, slot) DO UPDATE SET kind = excluded.kind, schema = excluded.schema, payload_json = excluded.payload_json,
       why = excluded.why, topic_key = excluded.topic_key, ref = excluded.ref, expires_at = excluded.expires_at,
       written_at = excluded.written_at, actor = excluded.actor, ledger_id = excluded.ledger_id, seq = excluded.seq,
       facts_json = excluded.facts_json`,
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
    r.facts_json ?? null,
  );
}

/** The surfaces that cite any of these facts. The table holds a few rows (one per slot). */
export function citing(db: Db, factIds: string[]): Row[] {
  const ids = new Set(factIds);
  return db.all<Row>('SELECT * FROM surfaces WHERE facts_json IS NOT NULL LIMIT 200').filter((r) => {
    try {
      const v = JSON.parse(r.facts_json ?? '[]');
      return Array.isArray(v) && v.some((id) => ids.has(id));
    } catch {
      return false;
    }
  });
}

export function remove(db: Db, app: string, slot: string): void {
  db.run('DELETE FROM surfaces WHERE app = ? AND slot = ?', app, slot);
}

export function topicIgnoredAt(db: Db, key: string): number | null {
  return (
    db.one<{ ignored_at: number | null }>('SELECT ignored_at FROM topics WHERE topic_key = ?', key)?.ignored_at ?? null
  );
}

/** A topic's learning state (BEHAVIOR.md §3.6; Core step 35): whether it rests, since when its
 * streak counts, whether the mind said so, and the last pass's counts (`lands_json`). */
export interface TopicState {
  topic_key: string;
  ignored_at: number | null;
  quiet_from: number | null;
  quiet_until: number | null;
  said_at: number | null;
  reopened_at: number | null;
  lands_json: string | null;
}
const STATE = 'topic_key, ignored_at, quiet_from, quiet_until, said_at, reopened_at, lands_json';

/** One topic's state, or null (one read by the key: the put's nudge_repeat and topic_quiet checks). */
export function topicState(db: Db, key: string): TopicState | null {
  return db.one<TopicState>(`SELECT ${STATE} FROM topics WHERE topic_key = ?`, key);
}

/** Every topic the briefing or a pass needs: one with counts from the last pass, or resting now. */
export function topicStates(db: Db, now: number): TopicState[] {
  return db.all<TopicState>(
    `SELECT ${STATE} FROM topics WHERE lands_json IS NOT NULL OR quiet_until > ? LIMIT 500`,
    now,
  );
}

/** The topic rests from `from` to `until`; whether it was said starts again. */
export function topicQuiet(db: Db, key: string, from: number, until: number): void {
  db.run(
    `INSERT INTO topics (topic_key, shown_count, quiet_from, quiet_until) VALUES (?, 0, ?, ?)
     ON CONFLICT (topic_key) DO UPDATE SET quiet_from = excluded.quiet_from, quiet_until = excluded.quiet_until, said_at = NULL`,
    key,
    from,
    until,
  );
}

/** The owner reopened it: it no longer rests, and its streak counts from now. */
export function topicReopened(db: Db, key: string, at: number, lands: string | null): void {
  db.run(
    'UPDATE topics SET quiet_until = NULL, said_at = NULL, reopened_at = ?, lands_json = ? WHERE topic_key = ?',
    at,
    lands,
    key,
  );
}

export function topicSaid(db: Db, key: string, at: number): void {
  db.run('UPDATE topics SET said_at = ? WHERE topic_key = ?', at, key);
}

/** The last pass's counts for a topic (null: nothing in the window). */
export function topicLands(db: Db, key: string, lands: string | null): void {
  db.run(
    `INSERT INTO topics (topic_key, shown_count, lands_json) VALUES (?, 0, ?)
     ON CONFLICT (topic_key) DO UPDATE SET lands_json = excluded.lands_json`,
    key,
    lands,
  );
}

/** When a topic was last shown (or followed up, verbs/follow.ts), or null. One read by the key. */
export function topicShownAt(db: Db, key: string): number | null {
  return (
    db.one<{ last_shown_at: number | null }>('SELECT last_shown_at FROM topics WHERE topic_key = ?', key)
      ?.last_shown_at ?? null
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

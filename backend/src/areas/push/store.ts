// Push rows inside the Auth object (SECURITY.md §10): one subscription per session, deleted with
// the session; the outbox of pushes and their words (kept 30 days). Endpoints are capability URLs:
// they never leave this object except to their own push service.
import type { PushKind } from '../../../../shared/contract/push.ts';
import type { Subscription } from '../../lib/webpush';
import type { Db } from '../../objects/base';
import { REPEAT_MS } from './rules';

export interface PushRow {
  id: string;
  kind: PushKind;
  title: string;
  body: string;
  url: string;
  topic_key: string | null;
  ref: string | null;
  why: string | null;
  hash: string | null;
  session_id: string | null;
  created_at: number;
  deadline: number;
  sent_at: number | null;
  dropped_at: number | null;
}

export function putSubscription(db: Db, sessionId: string, s: Subscription, now: number): void {
  db.run(
    `INSERT INTO push_subscriptions (session_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (session_id) DO UPDATE SET endpoint = excluded.endpoint, p256dh = excluded.p256dh, auth = excluded.auth`,
    sessionId,
    s.endpoint,
    s.p256dh,
    s.auth,
    now,
  );
}

export function deleteSubscriptions(db: Db, sessionIds: string[]): number {
  let n = 0;
  for (const id of sessionIds)
    n += db.all('DELETE FROM push_subscriptions WHERE session_id = ? RETURNING session_id', id).length;
  return n;
}

/** The subscriptions of the signed-in sessions Auth names (one session's, for a test). */
export function liveSubscriptions(
  db: Db,
  live: string[],
  only: string | null,
): (Subscription & { session_id: string })[] {
  const ok = new Set(only ? live.filter((id) => id === only) : live);
  return db
    .all<Subscription & { session_id: string }>('SELECT session_id, endpoint, p256dh, auth FROM push_subscriptions')
    .filter((s) => ok.has(s.session_id));
}

export function insertPush(db: Db, p: Omit<PushRow, 'sent_at' | 'dropped_at'>): void {
  db.run(
    `INSERT INTO pushes (id, kind, title, body, url, topic_key, ref, why, hash, session_id, created_at, deadline)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    p.id,
    p.kind,
    p.title,
    p.body,
    p.url,
    p.topic_key,
    p.ref,
    p.why,
    p.hash,
    p.session_id,
    p.created_at,
    p.deadline,
  );
}

export const getPush = (db: Db, id: string) => db.one<PushRow>('SELECT * FROM pushes WHERE id = ?', id);

export const waiting = (db: Db) =>
  db.all<PushRow>('SELECT * FROM pushes WHERE sent_at IS NULL AND dropped_at IS NULL ORDER BY created_at LIMIT 50');

export function markSent(db: Db, id: string, at: number): void {
  db.run('UPDATE pushes SET sent_at = ? WHERE id = ?', at, id);
}

export function markDropped(db: Db, id: string, at: number): void {
  db.run('UPDATE pushes SET dropped_at = ? WHERE id = ?', at, id);
}

/** The nudges that count against a new one: today's, the newest, and the same topic's in 14 days. */
export function nudgeHistory(db: Db, dayStart: number, topicKey: string, now: number) {
  const r = db.one<{ today: number; last_at: number | null; repeat: number }>(
    `SELECT
       sum(CASE WHEN coalesce(sent_at, created_at) >= ? THEN 1 ELSE 0 END) AS today,
       max(coalesce(sent_at, created_at)) AS last_at,
       sum(CASE WHEN topic_key = ? AND coalesce(sent_at, created_at) >= ? THEN 1 ELSE 0 END) AS repeat
     FROM pushes WHERE kind = 'nudge' AND dropped_at IS NULL`,
    dayStart,
    topicKey,
    now - REPEAT_MS,
  );
  return { today: r?.today ?? 0, last_at: r?.last_at ?? null, repeat: (r?.repeat ?? 0) > 0 };
}

export function pruneOld(db: Db, before: number): number {
  return db.all('DELETE FROM pushes WHERE created_at < ? RETURNING id', before).length;
}

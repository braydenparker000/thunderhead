// Latency (B5): how fast a cold wake is answered, and how long the chat stays awake.
//
// The idle cutoff (RUNTIME.md §4.6, owner 2026-11-22): exactly the owner's `mind.idle` setting
// (45 min unless changed) after their last message, with no growth by message count and no cap;
// a session with no owner message yet (a pre-warm) closes 8 min after its claim (mind/ops.ts).
// `GET /v1/mind/pending` carries it; `th listen`, `th reply` and `th wait` close the session at it.
//
// The first reply: a chat session's first reply to an owner message is kept on the wake it
// claimed (`first_reply_at`, RUNTIME.md §4.2), so every cold wake has three times (fired, claimed,
// first reply) and the usage meter can give the day's medians (watches/usage.ts). An outside read
// begun for the message (the working card's title `Looking that up`) is kept the same way, from
// the title to the reply (`outside_ms`, RUNTIME.md §6.6).
import type { MindPresence } from '../../../../shared/contract/api';
import { LOOKUP_TITLE } from '../../../../shared/contract/feed.ts';
import { settingSpec, validSetting } from '../../../../shared/contract/settings.ts';
import type { Db } from '../../objects/base';
import { getSetting } from '../settings/store';

/** The owner's setting (Settings › The mind), the catalogue's default while unset. */
function idleSetting(db: Db): number {
  const spec = settingSpec('mind.idle');
  if (!spec) return 45;
  const v = getSetting(db, spec.key);
  return validSetting(spec, v) ? (v as number) : (spec.default as number);
}

/** Minutes of idle after the owner's last message before the session closes. The day and zone
 * no longer change it; they stay in the signature for the caller in mind/ops.ts. */
export function idleCutoff(db: Db, _now?: number, _tz?: string): number {
  return idleSetting(db);
}

/** The session's first reply, on the wake it claimed: kept once, so the latency is the first
 * answer's. A manual claim has no wake, and writes nothing. */
export function recordFirstReply(db: Db, sessionId: string, at: number): void {
  db.run(
    `UPDATE wakes SET first_reply_at = ? WHERE first_reply_at IS NULL
       AND id = (SELECT wake_id FROM mind_sessions WHERE session_id = ?)`,
    at,
    sessionId,
  );
}

/** The outside read's time on the wake: the lookup title given at or after the owner's message
 * (`since`) to this reply, kept once. Read before the reply takes the card's chips (mind/using.ts). */
export function recordOutside(db: Db, sessionId: string, since: number, at: number): void {
  const cur = getSetting(db, 'mind.status') as MindPresence | undefined;
  const from = cur?.title_at ?? 0;
  if (cur?.state !== 'working' || !cur.title?.startsWith(LOOKUP_TITLE) || from < since) return;
  db.run(
    `UPDATE wakes SET outside_ms = ? WHERE outside_ms IS NULL
       AND id = (SELECT wake_id FROM mind_sessions WHERE session_id = ?)`,
    Math.max(0, at - from),
    sessionId,
  );
}

/** The first chat wake after the mind last claimed one (none older than `after`), or null: since
 * when it hasn't answered (areas/watchdogs/owner.ts). */
export function firstUnclaimedChat(db: Db, after: number): number | null {
  return (
    db.one<{ at: number | null }>(
      `SELECT min(at) AS at FROM wakes WHERE task = 'chat' AND at > ? AND at > coalesce(
         (SELECT max(claimed_at) FROM wakes WHERE task = 'chat' AND claimed_at IS NOT NULL), 0)`,
      after,
    )?.at ?? null
  );
}

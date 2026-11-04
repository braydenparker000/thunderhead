// Latency (B5): how fast a cold wake is answered, and how long the chat stays awake.
//
// The idle cutoff is adaptive to the day (RUNTIME.md §4.6): the owner's `mind.idle` setting
// (120 min unless changed), plus 15 min for every owner message today after the first, at most
// twice the setting and never past 4 hours. A busy day keeps the session alive for the next
// message (an idle turn on a warm cache costs less than a cold wake and answers at once); a quiet
// day ends at the setting. `GET /v1/mind/pending` carries it; the Stop hook reads it.
//
// The first reply: a chat session's first reply to an owner message is kept on the wake it
// claimed (`first_reply_at`, RUNTIME.md §4.2), so every cold wake has three times (fired, claimed,
// first reply) and the usage meter can give the day's medians (watches/usage.ts).
import { settingSpec, validSetting } from '../../../../shared/contract/settings.ts';
import type { Db } from '../../objects/base';
import { currentDay, ownerCount } from '../conversation/day';
import { dailyThread } from '../conversation/store';
import { getSetting } from '../settings/store';

export const IDLE_PER_MESSAGE_MIN = 15;
export const IDLE_CEILING_MIN = 240;

/** The owner's setting (Settings › The mind), the catalogue's default while unset. */
function idleSetting(db: Db): number {
  const spec = settingSpec('mind.idle');
  if (!spec) return 120;
  const v = getSetting(db, spec.key);
  return validSetting(spec, v) ? (v as number) : (spec.default as number);
}

export function idleCutoff(db: Db, now: number, tz: string): number {
  const base = idleSetting(db);
  const thread = dailyThread(db, currentDay(db, tz, now));
  const n = thread ? ownerCount(db, thread.id) : 0;
  return Math.min(base + IDLE_PER_MESSAGE_MIN * Math.max(0, n - 1), 2 * base, IDLE_CEILING_MIN);
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

// The quota hold at the Worker's edge (DATA.md §8.1): from 80% of the day's database budget the
// upload tools' operations answer 429 with Retry-After until 00:00 UTC. Core decides from its meter,
// with Music's own day brought along (the tools read in Music, whose row in Core is otherwise only
// as fresh as the last tick). This isolate keeps the answer for a minute, so a run of operations
// asks about once a minute. The phone and the mind are never held.
import { ApiError } from '../../http/errors';
import { MINUTE } from '../../lib/time';
import { coreObject } from '../../objects/core';
import { musicObject } from '../../objects/music';
import type { DayRow } from './store';

let kept: { until: number | null; at: number } | null = null;

/** For tests: forget the kept answer. */
export function forgetHold(): void {
  kept = null;
}

/** Music's day as its meter stands now, or none when it can't answer. */
async function musicDay(env: Env): Promise<DayRow[]> {
  try {
    const [today] = await musicObject(env).meterFlush();
    return today
      ? [{ day: today.day, class: 'music', rows_read: today.rows_read, rows_written: today.rows_written }]
      : [];
  } catch {
    return [];
  }
}

/** Throws 429 `rate_limited` (scope `account`) while Core says the heavy work waits. */
export async function refuseWhileHeld(env: Env, now = Date.now()): Promise<void> {
  if (!kept || now - kept.at >= MINUTE || now < kept.at || (kept.until !== null && now >= kept.until)) {
    // A Core that can't answer (on the release before the meter, for a moment of a deploy, say)
    // holds nothing: the guard never stops the tools by itself.
    const live = await musicDay(env);
    const until = await coreObject(env)
      .quotaHold(now, live)
      .catch(() => null);
    kept = { until, at: now };
  }
  if (kept.until !== null && now < kept.until)
    throw new ApiError(
      'rate_limited',
      { reason: 'daily_quota' },
      { retry_after: Math.ceil((kept.until - now) / 1000), scope: 'account' },
    );
}

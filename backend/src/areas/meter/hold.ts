// The quota hold at the Worker's edge (DATA.md §8.1): from 80% of the day's database budget the
// upload tools' operations answer 429 with Retry-After until 00:00 UTC. Core decides from its meter; this
// isolate keeps the answer for a minute, so a run of operations asks Core about once a minute. The
// phone and the mind are never held.
import { ApiError } from '../../http/errors';
import { MINUTE } from '../../lib/time';
import { coreObject } from '../../objects/core';

let kept: { until: number | null; at: number } | null = null;

/** For tests: forget the kept answer. */
export function forgetHold(): void {
  kept = null;
}

/** Throws 429 `rate_limited` (scope `account`) while Core says the heavy work waits. */
export async function refuseWhileHeld(env: Env, now = Date.now()): Promise<void> {
  if (!kept || now - kept.at >= MINUTE || now < kept.at || (kept.until !== null && now >= kept.until)) {
    // A Core that can't answer (on the release before the meter, for a moment of a deploy, say)
    // holds nothing: the guard never stops the tools by itself.
    const until = await coreObject(env)
      .quotaHold(now)
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

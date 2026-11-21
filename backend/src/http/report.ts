// Server errors into Core's error inbox, so the `errors.spike` watchdog (areas/watchdogs/checks.ts,
// OPERATIONS.md §8.2) has its input: onError records each unexpected error as source `worker`,
// fingerprinted by route and error name (the name only: a message can carry request data). After
// the response, through waitUntil; at most 5 an isolate in any minute; a failure is dropped, never
// thrown into the response.
import type { Context } from 'hono';
import type { Core } from '../objects/core';
import { coreInstance } from './sandbox';

export const REPORTS_PER_MINUTE = 5;
const MINUTE_MS = 60_000;
let sent: number[] = [];

/** Records one server error in Core's inbox, unless this isolate already sent 5 in the last minute. */
export function reportServerError(c: Context, name: string, now = Date.now()): void {
  try {
    sent = sent.filter((t) => now - t < MINUTE_MS);
    if (sent.length >= REPORTS_PER_MINUTE) return;
    sent.push(now);
    const route = c.req.routePath;
    const core = (c.env as Env).CORE.getByName(coreInstance()) as unknown as DurableObjectStub<Core>;
    const call = Promise.resolve()
      .then(() => core.reportErrors([{ source: 'worker', route, code: name, message: name, build: 0, at: now }]))
      .catch(() => {});
    c.executionCtx.waitUntil(call);
  } catch {
    // No context or no binding: the log line in onError is all there is.
  }
}

/** Tests: forget what this isolate sent. */
export function forgetReports(): void {
  sent = [];
}

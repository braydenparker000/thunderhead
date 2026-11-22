// The error envelope: {error:{code, message, details?, request_id}}. Messages are fixed per
// code and never echo the request, so nothing a client sent can leak back into logs or pages.
import type { Context } from 'hono';
import type { ErrorBody, ErrorCode, ErrorDetails } from '../../../shared/contract/api';
import { DAY, utcDay } from '../lib/time';
import { CODES } from './codes';
import { reportServerError } from './report';

export interface RateInfo {
  retry_after?: number;
  scope?: 'source' | 'account';
}

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly details?: ErrorDetails,
    readonly rate: RateInfo = {},
  ) {
    super(code);
  }
}

export function statusOf(code: ErrorCode): number {
  return CODES[code][0];
}

export function errorResponse(c: Context, err: ApiError): Response {
  const [status, message] = CODES[err.code];
  const body: ErrorBody = {
    error: {
      code: err.code,
      message,
      ...(err.details ? { details: err.details } : {}),
      request_id: c.get('requestId') ?? 'unknown',
      ...(err.rate.retry_after ? { retry_after: err.rate.retry_after, scope: err.rate.scope ?? 'source' } : {}),
    },
  };
  if (err.rate.retry_after) c.header('Retry-After', String(err.rate.retry_after));
  return c.json(body, status);
}

/** The platform refusing a storage operation once the account's daily free rows are used. Cloudflare's
 * Durable Objects pricing page (developers.cloudflare.com/durable-objects/platform/pricing, read
 * 2026-11-21): on the Workers Free plan, "if you exceed any one of the free tier limits, further
 * operations of that type will fail with an error", and "daily free limits reset at 00:00 UTC". The
 * error's words are not documented, so this matches the ways a limit refusal is worded (D1's says its
 * daily limits "have been exceeded") and never a CPU, memory, storage-full or overload error. */
export function spentDay(err: unknown): boolean {
  const m = String((err as { message?: unknown })?.message ?? '');
  if (/cpu|memory|SQLITE_FULL|disk is full|overloaded|too many requests|spending/i.test(m)) return false;
  // (also the form "Exceeded allowed rows written in Durable Objects free tier.": the limit named before the tier)
  return /(daily|free[- ]?(tier|plan)|rows? (read|written)).{0,40}(limit|quota|exceed)|(limit|quota).{0,40}(daily|free[- ]?(tier|plan))|exceeded .{0,80}(daily|free[- ]?(tier|plan))/i.test(
    m,
  );
}

/** 429 `budget_exhausted` until 00:00 UTC: what a spent day answers, so the phone keeps the write. */
export function spentError(now = Date.now()): ApiError {
  const next = Date.parse(`${utcDay(now)}T00:00:00Z`) + DAY;
  return new ApiError('budget_exhausted', undefined, {
    retry_after: Math.max(1, Math.ceil((next - now) / 1000)),
    scope: 'account',
  });
}

/** Hono onError: known errors keep their code; a spent day answers 429 `budget_exhausted` (nothing
 * is recorded: the error inbox would fail the same way); anything else is logged and recorded by
 * name only. */
export function onError(err: Error, c: Context): Response {
  if (err instanceof ApiError) return errorResponse(c, err);
  if (spentDay(err)) {
    console.error(JSON.stringify({ evt: 'budget_exhausted', route: c.req.routePath, request_id: c.get('requestId') }));
    return errorResponse(c, spentError());
  }
  // The name only: messages can carry request data, and auth bodies must never reach logs.
  console.error(
    JSON.stringify({ evt: 'error', route: c.req.routePath, name: err.name, request_id: c.get('requestId') }),
  );
  // And into Core's error inbox for the errors.spike watchdog (http/report.ts), capped, after the response.
  reportServerError(c, err.name);
  return errorResponse(c, new ApiError('internal'));
}

export function notFound(c: Context): Response {
  return errorResponse(c, new ApiError('not_found'));
}

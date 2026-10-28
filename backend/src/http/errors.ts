// The error envelope: {error:{code, message, details?, request_id}}. Messages are fixed per
// code and never echo the request, so nothing a client sent can leak back into logs or pages.
import type { Context } from 'hono';
import type { ErrorBody, ErrorCode, ErrorDetails } from '../../../shared/contract/api';
import { CODES } from './codes';

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

/** Hono onError: known errors keep their code; anything else is logged by name only. */
export function onError(err: Error, c: Context): Response {
  if (err instanceof ApiError) return errorResponse(c, err);
  // The name only: messages can carry request data, and auth bodies must never reach logs.
  console.error(
    JSON.stringify({ evt: 'error', route: c.req.routePath, name: err.name, request_id: c.get('requestId') }),
  );
  return errorResponse(c, new ApiError('internal'));
}

export function notFound(c: Context): Response {
  return errorResponse(c, new ApiError('not_found'));
}

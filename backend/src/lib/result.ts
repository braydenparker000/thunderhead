// Results across the Core RPC boundary. A custom error class does not survive RPC, so area code
// throws `Fail` and the Core facade turns it into `{ok:false, code}`; the Worker route turns that
// back into the HTTP error with `value()`.
import type { ErrorCode, ErrorDetails } from '../../../shared/contract/api';
import { ApiError } from '../http/errors';

export class Fail extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly details?: ErrorDetails,
  ) {
    super(code);
  }
}

export type Out<T> = { ok: true; value: T } | { ok: false; code: ErrorCode; details?: ErrorDetails };

/** Runs `fn`; a thrown Fail becomes a failed Out, anything else is rethrown. */
export function attempt<T>(fn: () => T): Out<T> {
  try {
    return { ok: true, value: fn() };
  } catch (e) {
    if (e instanceof Fail) return { ok: false, code: e.code, ...(e.details ? { details: e.details } : {}) };
    throw e;
  }
}

/** In a Worker route: the value, or the HTTP error the object chose. */
export function value<T>(out: Out<T>): T {
  if (!out.ok) throw new ApiError(out.code, out.details);
  return out.value;
}

/** A 422 with one field issue. */
export const invalid = (path: string, issue: string) => new Fail('validation', [{ path, issue }]);

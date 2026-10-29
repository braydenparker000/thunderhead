// Deploy-transition tolerance for new object methods. During a deploy the new Worker code can
// reach an object that still runs the previous release for a moment; an RPC method that release
// lacks then throws a TypeError. A route that calls a method added in this release wraps the call
// in `fresh`, so that moment answers 503 `unavailable` (clients retry after 1, 2, 4 s, API.md §6)
// instead of a 500.
import { ApiError } from '../http/errors';

const MISSING = /does not implement|not implement the method|is not a function|no such method/i;

export function missingMethod(e: unknown): boolean {
  return e instanceof TypeError && MISSING.test(e.message);
}

export async function fresh<P extends PromiseLike<unknown>>(call: P): Promise<Awaited<P>> {
  try {
    return await call;
  } catch (e) {
    if (missingMethod(e)) throw new ApiError('unavailable');
    throw e;
  }
}

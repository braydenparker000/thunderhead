// Deploy-transition tolerance for new object methods. During a deploy the new Worker code can
// reach an object that still runs the previous release for a moment; an RPC method that release
// lacks then throws a TypeError. A route that calls a method added in this release wraps the call
// in `fresh`, so that moment answers 503 `unavailable` (clients retry after 1, 2, 4 s, API.md §6)
// instead of a 500.
import { ApiError } from '../http/errors';

/** workerd's own words for a method the object lacks (probed: `The RPC receiver does not
 * implement "x".`). Only that: any other TypeError is a real bug and stays a logged 500. */
const MISSING = /^The RPC receiver does not implement /;

export function missingMethod(e: unknown): boolean {
  return e instanceof TypeError && MISSING.test(e.message);
}

export async function fresh<P extends PromiseLike<unknown>>(call: P): Promise<Awaited<P>> {
  try {
    return await call;
  } catch (e) {
    if (!missingMethod(e)) throw e;
    // The name only, as onError logs (the message names the method, never request data).
    console.error(JSON.stringify({ evt: 'rpc_missing_method', name: (e as Error).name }));
    throw new ApiError('unavailable');
  }
}

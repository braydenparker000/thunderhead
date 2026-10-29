// The eval sandbox's request scope (EVALS.md §1.1). A request with `TH-Sandbox: eval` from a
// mind:chat or mind:night key runs against the scratch Core instance `core-eval` through the same
// routes; nobody else may ask for it (403), nor may a route that only one named key may call (the
// import's). The route guard sets the scope after the key is checked, and it lasts for the request
// and the work it leaves running (waitUntil); `coreObject()` reads it. Write requests made in the
// sandbox are recorded there, accepted or refused, so an eval can see what was tried.
import { AsyncLocalStorage } from 'node:async_hooks';
import { SANDBOX_HEADER, SANDBOX_INSTANCE } from '../../../shared/contract/evals.ts';

const scope = new AsyncLocalStorage<typeof SANDBOX_INSTANCE>();

/** The Core instance this request works on. */
export const coreInstance = () => scope.getStore() ?? 'owner';
export const inSandbox = () => scope.getStore() === SANDBOX_INSTANCE;

export function inScope<T>(fn: () => T): T {
  return scope.run(SANDBOX_INSTANCE, fn);
}

export { SANDBOX_HEADER };

/** The housekeeping a session does in the sandbox, which the attempt log leaves out. */
export const NOT_ATTEMPTS = new Set([
  'POST /v1/mind/brief',
  'POST /v1/mind/status',
  'POST /v1/mind/taint',
  'POST /v1/mind/notes',
  'POST /v1/evals/sandbox',
]);

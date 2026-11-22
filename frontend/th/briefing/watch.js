// @ts-check
// What is wrong, from the Worker's own answer (OPERATIONS.md §8.5): on opening home, deep health's
// `watch` (the last cron, the last day roll, the mind's state, whether a push reaches this phone and
// the owner's lines), so the Briefing shows its lines even when no push arrived, and the chat shows
// the mind's line while it still can't answer. Offline or an older Worker: nothing changes.
import { api, signedIn } from '../client.js';

/** @typedef {import('../../../shared/contract/watch.ts').OwnerWatch} OwnerWatch */

let last = /** @type {OwnerWatch | null} */ (null);
let at = 0;

/** Asks once a minute at most; `th:watch` tells the Briefing and the chat. */
export async function loadWatch() {
  if (Date.now() - at < 60_000) return;
  at = Date.now();
  try {
    /** @type {import('../../../shared/contract/api.ts').DeepHealthResponse} */
    const h = await signedIn((t) => api.call('/v1/ops/health/deep', { token: t }));
    last = h.watch ?? null;
    document.dispatchEvent(new CustomEvent('th:watch'));
  } catch {
    // The Briefing's own lines stand.
  }
}

/** When the last answer came. */
export const watchAt = () => at;

/** The owner's lines from the last answer. */
export const watchLines = () => last?.lines ?? [];

/** The mind's line while its presence still says it can't answer (gone once it answers).
 * @param {{ state: string } | null | undefined} presence */
export function mindLine(presence) {
  const line = last?.mind.line ?? null;
  return line && (!presence || ['failed', 'limited', 'unconfigured'].includes(presence.state)) ? line : null;
}

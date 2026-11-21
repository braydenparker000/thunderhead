// Change kinds only a signed-in device may see (SIGN-IN.md §11.4): a `notice` row says when a sign-in,
// a password change, a recovery or a reset ticket happened, which no agent key may learn. For any
// other caller they are left out of GET /v1/changes, a take of /v1/live/wait and the frames on the
// wait sockets; the cursor still moves past them, so nothing loops and no gap is left to fill.
import type { ChangeKind, ChangesResponse, LiveWaitResponse } from '../../../../shared/contract/api';

export const DEVICE_ONLY: readonly ChangeKind[] = ['notice'];

const shown = (kind: ChangeKind) => !DEVICE_ONLY.includes(kind);

/** A page of the feed for a caller that is not a device: the same `next_after`, fewer items. */
export function changesForAgent(r: ChangesResponse): ChangesResponse {
  return { ...r, items: r.items.filter((c) => shown(c.kind)) };
}

/** A take for the mind: the same `seq`; `changed` only for what it may see. */
export function takeForAgent(r: LiveWaitResponse): LiveWaitResponse {
  const kinds = r.kinds.filter(shown);
  return { ...r, kinds, changed: kinds.length > 0 || r.messages.length > 0 };
}

/** The kinds a wait socket hears of one commit; empty means it hears nothing. */
export const kindsForAgent = (kinds: ChangeKind[]): ChangeKind[] => kinds.filter(shown);

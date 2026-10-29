// Who is asking, as the Core object sees it: derived by the Worker from the verified token (and
// the mind's TH-Session header), never from a request body.
import type { Actor } from '../../../shared/contract/api';
import type { Who } from '../../../shared/contract/routes.ts';

export interface Caller {
  actor: Actor;
  who: Who;
  /** A device's session id, or the mind's Claude session id (TH-Session). */
  session_id: string | null;
  /** The signed-in device (its session id), for device-bound rows. */
  device_id: string | null;
}

export const isMind = (c: Caller) => c.who === 'C' || c.who === 'N' || c.who === 'R';

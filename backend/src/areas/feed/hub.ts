// The live channel inside Core (API.md §12): hibernatable WebSockets, so an idle phone or a
// waiting mind costs no object duration. Phones connect with tag `device` plus `s:<session>`;
// the Worker's `/v1/live/wait` holds a socket with tag `wait`. The object never sends on a timer:
// frames go out only after a commit (commit.ts) or a presence update. Clients ignore frame types
// they do not know and pull GET /v1/changes, so features add change kinds, not sockets.
import type { ChangeKind, LiveFrame } from '../../../../shared/contract/api';
import { CLOSE_CODES, LIVE_PROTOCOL } from '../../../../shared/contract/feed.ts';

export const TAG_DEVICE = 'device';
export const TAG_WAIT = 'wait';
const sessionTag = (id: string) => `s:${id}`;

export class Hub {
  constructor(private readonly ctx: DurableObjectState) {}

  /** Accepts a socket for a phone session or a waiting mind and sends `hello`. */
  accept(ws: WebSocket, who: { session_id: string } | 'wait', seq: number, minClient: number): void {
    const tags = who === 'wait' ? [TAG_WAIT] : [TAG_DEVICE, sessionTag(who.session_id)];
    this.ctx.acceptWebSocket(ws, tags);
    ws.serializeAttachment({ at: Date.now() });
    send(ws, { t: 'hello', v: LIVE_PROTOCOL, seq, min_client: minClient });
  }

  /** After a commit: every phone and every waiting mind hears the new seq and kinds. */
  changed(seq: number, kinds: ChangeKind[]): void {
    const frame: LiveFrame = { t: 'changed', seq, kinds };
    for (const ws of this.ctx.getWebSockets()) send(ws, frame);
  }

  /** The presence pulse while the mind writes. Phones only. */
  typing(until: number): void {
    for (const ws of this.ctx.getWebSockets(TAG_DEVICE)) send(ws, { t: 'typing', who: 'mind', until });
  }

  /** Closes the sockets of signed-out sessions with 4401. */
  revoke(sessionIds: string[]): number {
    let n = 0;
    for (const id of sessionIds)
      for (const ws of this.ctx.getWebSockets(sessionTag(id))) {
        send(ws, { t: 'bye', code: 'session_revoked' });
        try {
          ws.close(CLOSE_CODES.revoked, 'session_revoked');
        } catch {
          // already closing
        }
        n++;
      }
    return n;
  }

  /** Whether a phone shows Thunderhead now (BEHAVIOR.md §3.4 rule 6): a page connected or pinged in
   * the last 60 s. Pings run every 30 s only while the page is visible, answered by the runtime. */
  looking(now: number): boolean {
    return this.ctx.getWebSockets(TAG_DEVICE).some((ws) => {
      const pinged = this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? 0;
      const at = (ws.deserializeAttachment() as { at?: number } | null)?.at ?? 0;
      return Math.max(pinged, at) >= now - 60_000;
    });
  }

  counts(): { devices: number; waiting: number } {
    return { devices: this.ctx.getWebSockets(TAG_DEVICE).length, waiting: this.ctx.getWebSockets(TAG_WAIT).length };
  }
}

function send(ws: WebSocket, frame: LiveFrame): void {
  try {
    ws.send(JSON.stringify(frame));
  } catch {
    // A socket that is closing drops the frame; the client resyncs from the feed on reconnect.
  }
}

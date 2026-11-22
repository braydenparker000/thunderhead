// The check-ins' half of the Core object (areas/mind/checkin*.ts; owner, 2026-11-22): the cron's
// tick that fires a due slot on the night routine, and the check-in session's one message and its
// end. A code layer of the one Core class.
import { checkinTick } from '../areas/mind/checkin';
import { checkinPending, done, say } from '../areas/mind/checkin-session';
import { fire, fireConfig } from '../areas/mind/fire';
import * as mstore from '../areas/mind/store';
import type { Out } from '../lib/result';
import type { Caller } from './caller';
import { CorePhotos } from './core-photos';

export abstract class CoreCheckin extends CorePhotos {
  /** The cron's step: the wake fired for a due slot (its id), or null. The fire is recorded without
   * the chat back-off, as the night's is (core.ts tick). */
  async checkinTick(now = Date.now(), fetchImpl: typeof fetch = fetch): Promise<string | null> {
    const f = this.write((w) => checkinTick(w, this.nightConfigured(), this.tz()), now);
    const cfg = f && !this.sandboxed ? fireConfig(this.env, 'night') : null;
    if (f && cfg) {
      const r = await fire(cfg, fetchImpl);
      this.write((w) => mstore.recordFire(w.db, f.id, r.status, r.session_id, r.error));
    }
    return f?.id ?? null;
  }

  /** A check-in may be reading its briefing now: its day is today's, not the closed one. */
  protected checkinNear(): boolean {
    return checkinPending(this.db, Date.now());
  }

  checkinSay(c: Caller, r: { id: string; body: string }): Out<{ message_id: string; thread_id: string }> {
    return this.run((w) => say(w, c, r, this.tz()));
  }

  checkinDone(c: Caller, nothing: string | null): Out<{ outcome: string; slot: string }> {
    return this.run((w) => done(w, c, nothing));
  }
}

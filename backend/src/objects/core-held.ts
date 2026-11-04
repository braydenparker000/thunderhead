// The held conversations' half of the Core object (areas/conversation/held.ts, purge.ts): reading
// threads as the caller may (a deleted one by nobody, one off the record never by the night or the
// reflex), starting one off the record, Delete and Restore (the owner's device only, checked again
// in held.ts), Recently deleted, and the cron's prune pass: each tick it purges what is due (one
// index read when nothing is), never while the rows guard holds the heavy work, then once a logical
// day every table's own prune (DATA.md §10). A code layer of the one Core class.
import type { DeletedThread, Message, MindRole, Thread } from '../../../shared/contract/api';
import { HELD_LIMITS } from '../../../shared/contract/held.ts';
import type { Who } from '../../../shared/contract/routes.ts';
import { currentDay } from '../areas/conversation/day';
import * as held from '../areas/conversation/held';
import * as purge from '../areas/conversation/purge';
import { expirePastKeep, RETENTION_STEP } from '../areas/conversation/retention';
import { lastMessageAt } from '../areas/conversation/stats';
import * as cstore from '../areas/conversation/store';
import type * as fstore from '../areas/files/store';
import { byId as fileById } from '../areas/files/store';
import { DROP_STEP, dropUnkept } from '../areas/memory/expire';
import { quotaHold } from '../areas/meter/quota';
import { markOffRecord } from '../areas/mind/guards';
import { getSetting, putSetting } from '../areas/settings/store';
import type { Caller } from './caller';
import { CORE_TABLES } from './core.migrations';
import { CorePodcasts } from './core-podcasts';

const PRUNE_STEP = 2_000;

export abstract class CoreHeld extends CorePodcasts {
  // --- reading threads, as the caller may --------------------------------------------------------

  /** GET /v1/threads: never a deleted thread; one off the record only in the owner's list. */
  threads(who: Who, status: 'open' | 'filed' | null, limit: number, after: [number, string] | null): Thread[] {
    return cstore.threadsPage(this.db, status, limit, after, who === 'D' ? { now: Date.now() } : null);
  }

  /** GET /v1/threads/:id, or null when it doesn't exist for this caller. */
  thread(who: Who, id: string): Thread | null {
    return held.threadReadable(this.db, who, id, Date.now()) ? cstore.thread(this.db, id) : null;
  }

  /** GET /v1/threads/:id/messages, or null when the thread doesn't exist for this caller. The chat
   * reading one off the record is marked: it writes no memory from then on. */
  messages(c: Caller, threadId: string, before: number | null, after: number | null, limit: number): Message[] | null {
    const now = Date.now();
    if (!held.threadReadable(this.db, c.who, threadId, now)) return null;
    if (c.who === 'C' && held.threadHeld(this.db, threadId, now) === 'off_record') this.markOffRecord(c.session_id);
    return cstore.messagesPage(this.db, threadId, before, after, limit);
  }

  /** GET /v1/files/:id: a file whose message is in a thread this caller may not read is not there;
   * the chat reading one off the record is marked, as above. */
  fileFor(c: Caller, id: string): fstore.FileRow | null {
    const now = Date.now();
    const f = fileById(this.db, id);
    if (!f || !held.fileReadable(this.db, c.who, f.message_id, now)) return null;
    if (c.who === 'C' && f.message_id && held.messageHeld(this.db, f.message_id, now) === 'off_record')
      this.markOffRecord(c.session_id);
    return f;
  }

  /** The Worker handed the chat session words off the record (its briefing, a wait, the thread or
   * a file): from now on it writes no memory, whatever it cites (guards.ts `offRecord`). */
  protected markOffRecord(sessionId: string | null, role: MindRole = 'chat'): void {
    if (!sessionId || role !== 'chat') return;
    this.write((w) => markOffRecord(w.db, { id: sessionId, role, day: currentDay(w.db, this.tz(), w.at), at: w.at }));
  }

  // --- off the record, Delete, Restore (device only) ---------------------------------------------

  offRecord(c: Caller, id: string) {
    return this.run((w) => held.startOffRecord(w, c, id, this.tz()));
  }

  deleteThread(c: Caller, id: string) {
    return this.run((w) => held.remove(w, c, id));
  }

  restoreThread(c: Caller, id: string) {
    return this.run((w) => held.restore(w, c, id, this.tz()));
  }

  deletedThreads(): DeletedThread[] {
    return held.deleted(this.db, Date.now());
  }

  /** When the conversation last spoke, for the roll's quiet hour: today's thread, or the newest
   * conversation off the record (talking off the record is talking). */
  protected lastSpokeAt(dailyId: string | null): number | null {
    const at = [lastMessageAt(this.db, dailyId), held.lastOffRecordAt(this.db)].filter((x): x is number => x !== null);
    return at.length ? Math.max(...at) : null;
  }

  // --- the prune pass ----------------------------------------------------------------------------

  /** Held conversations first, each tick; then once a logical day the conversations past Keep
   * conversations marked due (retention.ts, for the next tick's purge) and every table's prune,
   * ≤ 2,000 rows each a step: the day counts as done only when nothing was cut short, so a backlog
   * continues on the next tick. Returns the rows pruned, conversations marked and messages purged. */
  protected async pruneDaily(now: number, today: string): Promise<number> {
    const purged = await this.purgeHeld(now);
    if (getSetting(this.db, 'prune.day') === today) return purged;
    // Outside facts nobody kept, in their own commit: they write the ledger (memory/expire.ts).
    const dropped = this.write((w) => dropUnkept(w, now), now);
    return (
      purged +
      dropped +
      this.ctx.storage.transactionSync(() => {
        let total = expirePastKeep(this.db, now);
        let short = dropped < DROP_STEP && total < RETENTION_STEP;
        for (const t of Object.values(CORE_TABLES)) {
          const n = t.prune?.(this.db, now, PRUNE_STEP) ?? 0;
          total += n;
          if (n >= PRUNE_STEP) short = false;
        }
        if (short) putSetting(this.db, 'prune.day', today, 'worker', now);
        return total;
      })
    );
  }

  /** Purges what is due, at most HELD_LIMITS.purge_messages messages this tick, unless the rows
   * guard holds the heavy work (from 80% of the day's budget: then it waits for 00:00 UTC, the
   * threads already gone from every read). Each step: the files' bytes leave the private bucket,
   * then one commit takes the rows (purge.ts). Returns the messages purged. */
  protected async purgeHeld(now: number): Promise<number> {
    const steps = purge.plan(this.db, now);
    if (!steps.length || quotaHold(this.db, now) !== null) return 0;
    const vault = (this.env as { VAULT?: R2Bucket }).VAULT;
    let n = 0;
    for (const s of steps) {
      const keys = s.files.map((f) => f.key);
      // Without the bucket the bytes can't go, so the rows that name them wait too.
      if (keys.length && !vault) break;
      for (let i = 0; i < keys.length; i += HELD_LIMITS.vault_keys)
        await vault?.delete(keys.slice(i, i + HELD_LIMITS.vault_keys));
      this.write((w) => purge.apply(w, s), now);
      n += s.messages.length;
    }
    return n;
  }
}

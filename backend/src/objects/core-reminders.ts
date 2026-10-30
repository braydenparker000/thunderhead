// The reminders' half of the Core object (areas/reminders): the owner's reminders, and their
// delivery from the alarm. A code layer of the one Core class. The alarm wakes for the soonest set
// reminder (core-base.ts `schedule`), and the 15-minute tick delivers any it missed: in one commit
// the row turns `done` and its line joins today's thread, so it is delivered once. Its push is then
// offered to the Auth object's outbox for an hour through the push context (by the reminder's id,
// so offering it again changes nothing): from here at once, and from every later delivery run, so
// a push lost on the way still goes.
import type { PutReminderRequest, Reminder, RemindersResponse } from '../../../shared/contract/reminders.ts';
import type { PushContext } from '../areas/push/rules';
import * as reminders from '../areas/reminders/ops';
import { nextFireAt, pushesOwed } from '../areas/reminders/store';
import type { Out } from '../lib/result';
import { authObject } from './auth';
import type { Caller } from './caller';
import { CoreFiles } from './core-files';

export abstract class CoreReminders extends CoreFiles {
  /** The soonest set reminder's time, read once per object start and again after each change to
   * the set reminders, which change only through this layer: `schedule` and the tick read no row. */
  private soonest: number | null | undefined;

  protected reminderDue(): number | null {
    if (this.soonest === undefined) this.soonest = nextFireAt(this.db);
    return this.soonest;
  }

  /** After a change to the set reminders: read the soonest again and move the alarm to it. */
  private changed(): void {
    this.soonest = undefined;
    this.schedule();
  }

  putReminder(
    c: Caller,
    id: string,
    r: PutReminderRequest,
    hash: string,
  ): Out<{ reminder: Reminder; created: boolean }> {
    const out = this.run((w) => reminders.put(w, c, id, r, hash, this.tz()));
    if (out.ok && out.value.created) this.changed();
    return out;
  }

  reminders(): RemindersResponse {
    return reminders.list(this.db, Date.now());
  }

  cancelReminder(c: Caller, id: string): Out<Reminder> {
    const out = this.run((w) => reminders.cancel(w, c, id));
    if (out.ok) this.changed();
    return out;
  }

  /** The push context with the reminder pushes still owed (none from the eval sandbox). */
  override pushContext(): PushContext {
    const ctx = super.pushContext();
    const owed = this.sandboxed ? [] : pushesOwed(this.db, ctx.now, reminders.PUSH_MS);
    return { ...ctx, reminders: owed.map((r) => ({ id: r.id, at: r.fired_at, until: r.push_until })) };
  }

  /** The alarm's and the tick's pass: the reminders due by `now`, then their pushes. A failed hand-off
   * to the outbox is offered again by the next delivery run (the cron's, within 15 minutes). */
  protected async deliverReminders(now: number): Promise<void> {
    const next = this.reminderDue();
    if (next === null || next > now) return;
    const pushes = this.write((w) => reminders.deliverDue(w, this.tz(), !this.sandboxed), now);
    this.changed();
    if (!pushes) return;
    try {
      await authObject(this.env).deliverPushes(this.pushContext());
    } catch {
      // The Auth object is out of reach for a moment: the cron's delivery run offers it again.
    }
  }
}

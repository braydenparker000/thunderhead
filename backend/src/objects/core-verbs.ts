// The verbs' half of the Core object (areas/verbs, API.md §11.11): queueing one (a Worker-side verb
// runs at once), a phone's claim and result, plans, and scheduled actions with their delivery. A
// code layer of the one Core class. The alarm wakes for the soonest scheduled row as it does for a
// reminder (core-base.ts `schedule`; the time is kept in memory, read again only after a change to
// the scheduled rows, which change only through this layer), and the 15-minute tick runs any it
// missed; each due row runs in its own commit (areas/verbs/due.ts).
import type { PostPlanRequest, PutVerbRequest, VerbResultRequest } from '../../../shared/contract/api';
import * as due from '../areas/verbs/due';
import { list as listMixes, songs as mixSongs } from '../areas/verbs/mixes';
import * as verbs from '../areas/verbs/ops';
import * as plans from '../areas/verbs/plan';
import * as schedule from '../areas/verbs/schedule';
import { due as dueRows, soonest } from '../areas/verbs/store';
import { attempt, type Out } from '../lib/result';
import type { Caller } from './caller';
import { CoreHeld } from './core-held';

export abstract class CoreVerbs extends CoreHeld {
  /** The soonest scheduled verb's or plan's time (undefined: read it again). */
  private soonestVerb: number | null | undefined;

  protected override verbsDue(): number | null {
    if (this.soonestVerb === undefined) this.soonestVerb = soonest(this.db);
    return this.soonestVerb;
  }

  /** After a change to the scheduled rows: read the soonest again and move the alarm to it. */
  protected verbsChanged(): void {
    this.soonestVerb = undefined;
    this.schedule();
  }

  /** `prepared`: what the route worked out first (a play_mix find's songs); absent from a Worker of
   * the release before, which sends none (then such a find is refused, 422). */
  putVerb(c: Caller, id: string, r: PutVerbRequest, hash: string, prepared?: verbs.Prepared) {
    const out = this.run((w) => verbs.put(w, c, id, r, hash, () => this.tz(), prepared ?? {}));
    if (out.ok && out.value.created && r.verb === 'reminder.move') this.changed();
    if (out.ok && out.value.created && out.value.verb.status === 'scheduled') this.verbsChanged();
    return out;
  }

  /** A verb with `fire_at`, under a name the release before lacks: an object still on it answers 503
   * (`fresh`) for a moment of the deploy, instead of running the verb at once. */
  scheduleVerb(c: Caller, id: string, r: PutVerbRequest, hash: string, prepared?: verbs.Prepared) {
    return this.putVerb(c, id, r, hash, prepared);
  }

  /** POST /v1/verbs/plan; `prepared`: each step's (a play_mix find's songs). */
  postPlan(c: Caller, r: PostPlanRequest, hash: string, prepared: verbs.Prepared[]) {
    const out = this.run((w) => plans.post(w, c, r, hash, () => this.tz(), Array.isArray(prepared) ? prepared : []));
    if (out.ok && out.value.created && r.steps.some((s) => s.verb === 'reminder.move')) this.changed();
    if (out.ok && out.value.created && out.value.plan.status === 'scheduled') this.verbsChanged();
    return out;
  }

  cancelVerb(c: Caller, id: string) {
    const out = this.run((w) => schedule.cancel(w, c, id));
    if (out.ok) this.verbsChanged();
    return out;
  }

  scheduledVerbs() {
    return { items: schedule.list(this.db) };
  }

  /** The alarm's and the tick's pass: each scheduled row due by `now` in its own commit; one that
   * fails is recorded in the next. Past PER_PASS rows, the alarm comes back at once for the rest. */
  protected fireVerbs(now: number): void {
    const next = this.verbsDue();
    if (next === null || next > now) return;
    for (const row of dueRows(this.db, now, due.PER_PASS)) {
      let out: Out<unknown>;
      try {
        out = attempt(() => this.write((w) => due.fire(w, row.id, () => this.tz()), now));
      } catch {
        // A bug, not a refusal: recorded as failed all the same, so one row never holds the alarm.
        console.error(JSON.stringify({ evt: 'scheduled_verb_failed', id: row.id }));
        out = { ok: false, code: 'internal' };
      }
      if (!out.ok) {
        const { code, details } = out;
        this.write((w) => due.failed(w, row.id, code, details, () => this.tz()), now);
      }
    }
    this.verbsChanged();
  }

  /** `app`: that app's pending intents; without it, what home's own loop runs. */
  pendingVerbs(deviceId: string, app?: string) {
    return this.write((w) => verbs.pending(w, deviceId, app));
  }

  claimVerb(id: string, deviceId: string) {
    return this.run((w) => verbs.claim(w, id, deviceId));
  }

  verbResult(id: string, deviceId: string, r: VerbResultRequest) {
    return this.run((w) => verbs.result(w, id, deviceId, r, () => this.tz()));
  }

  /** GET /v1/music/mixes: the mixes `music.mix_save` kept, newest first. */
  musicMixes() {
    return listMixes(this.db);
  }

  /** GET /v1/music/mixes/:id: one mix's songs, or null (one read by the key). */
  musicMix(id: string) {
    return mixSongs(this.db, id);
  }
}

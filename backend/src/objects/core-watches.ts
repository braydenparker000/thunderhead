// The watches' half of the Core object (areas/mind/watches, RUNTIME.md §3): the day pulse. A code
// layer of the one Core class, under every other, so each can meet a watch. It keeps the waiting
// watches' summary in memory (their kinds and types, the soonest time, how many are queued), read
// once per object start and again after each commit that changed a watch: so a commit that changes
// nothing a watch waits on reads no row (`committed`), a senses batch with no watched type reads
// none (`watchEvents`), and `schedule` knows the soonest `at` without a read. A met watch moves
// the alarm to now; the alarm's and the tick's pass fire the wake after its commit.
import type { ChangeKind } from '../../../shared/contract/api';
import { type UsageResponse, WATCH_CHANGES, type WatchesResponse } from '../../../shared/contract/watches.ts';
import { fire, fireConfig } from '../areas/mind/fire';
import { taintedNow } from '../areas/mind/guards';
import { session } from '../areas/mind/store';
import * as wake from '../areas/mind/wake';
import { toWatch } from '../areas/mind/watches/brief';
import { matchChanges, matchEvents } from '../areas/mind/watches/ops';
import { budgetNow, pass } from '../areas/mind/watches/pulse';
import * as wstore from '../areas/mind/watches/store';
import { usage } from '../areas/mind/watches/usage';
import { DAY } from '../lib/time';
import type { Caller } from './caller';
import type { Made } from './commit';
import { CoreBase } from './core-base';

interface Summary {
  waiting: number;
  queued: number;
  at: number | null;
  events: Set<string>;
  changes: Set<string>;
}

export abstract class CoreWatches extends CoreBase {
  private watching: Summary | undefined;
  /** Something was met (or the night ended) while the queue waits: the alarm releases it now. */
  private releaseSoon = false;

  private watchSummary(): Summary {
    if (this.watching) return this.watching;
    const s: Summary = { waiting: 0, queued: 0, at: null, events: new Set(), changes: new Set() };
    for (const r of wstore.summary(this.db)) {
      s.waiting += r.n;
      s.queued += r.queued;
      if (r.at !== null && (s.at === null || r.at < s.at)) s.at = r.at;
      if (r.kind !== 'at' && r.type) (r.kind === 'event' ? s.events : s.changes).add(r.type);
    }
    this.watching = s;
    return s;
  }

  protected watchDue(): number | null {
    const s = this.watchSummary();
    const now = this.releaseSoon && s.queued > 0 ? Date.now() : null;
    return now !== null && (s.at === null || now < s.at) ? now : s.at;
  }

  /** After every commit: one that changed a watch reads the summary again (and a queue waiting moves
   * the alarm to now); one whose changes a change watch waits on meets it, in its own commit. */
  protected committed(kinds: ChangeKind[], made: Made[], at: number): void {
    const touched = kinds.includes('watch');
    if (!touched && !kinds.some((k) => Object.hasOwn(WATCH_CHANGES, k))) return;
    if (touched) this.watching = undefined;
    const s = this.watchSummary();
    if (touched && s.queued > 0) this.releaseSoon = true;
    if (s.changes.size && made.some((m) => s.changes.has(m.kind))) this.write((w) => matchChanges(w, made, at));
    if (touched) this.schedule();
  }

  /** The night shift ended (`th night done`): what it held back goes now. */
  protected watchesAfterNight(): void {
    this.releaseSoon = true;
    this.schedule();
  }

  /** The alarm's and the tick's pass (pulse.ts): lapses, due times, the queue; then the wake's fire. */
  protected async watchesTick(now: number, fetchImpl: typeof fetch = fetch): Promise<string | null> {
    this.releaseSoon = false;
    if (!this.watchSummary().waiting) return null;
    const f = this.write((w) => pass(w, this.configured(), this.tz()), now);
    if (!f) return null;
    const cfg = this.sandboxed ? null : fireConfig(this.env, 'chat');
    if (cfg) {
      const r = await fire(cfg, fetchImpl);
      this.write((w) => wake.fired(w, f.id, r));
    }
    this.schedule();
    return f.id;
  }

  /** The events a senses batch (or the Worker itself) saw: meets the live event watches on them. */
  watchEvents(events: { type: string; ref: string | null; at: number }[]): number {
    const s = this.watchSummary();
    const hit = events.filter((e) => s.events.has(e.type));
    return hit.length ? this.write((w) => matchEvents(w, hit)) : 0;
  }

  /** GET /v1/mind/watches. Outside words reach the device and a known session that read outside text. */
  watchList(c: Caller): WatchesResponse {
    const now = Date.now();
    const role = c.who === 'N' ? 'night' : c.who === 'R' ? 'reflex' : 'chat';
    const sid = c.session_id;
    const words = c.who === 'D' || (sid !== null && session(this.db, sid) !== null && taintedNow(this.db, sid, role));
    const waiting = wstore.waiting(this.db);
    const items = [...waiting, ...wstore.settledSince(this.db, now - DAY, 50)].slice(0, 50);
    const b = budgetNow(this.db, now, this.tz());
    return { items: items.map((r) => toWatch(r, words)), live: waiting.length, ...b };
  }

  /** GET /v1/mind/usage: the meter (usage.ts). */
  usage(): UsageResponse {
    return usage(this.db, Date.now(), this.tz());
  }
}

// The Core object: the owner's data. It only composes the areas (areas/<name>/): every RPC is a
// thin call into an area, every write runs through `write` (commit.ts: area mutation + ledger +
// change feed in one transaction, then the live channel), and area failures come back as
// `{ok:false, code}` (lib/result.ts). No timers: wake retries and requeues use the alarm. The P1
// data, the feed and the sockets are in core-base.ts; memory (P3) is in core-memory.ts and the
// night shift's run and input in core-night.ts.
import type {
  BriefRequest,
  JsonObject,
  LiveWaitResponse,
  MindNoteRequest,
  MindStatusRequest,
  PendingResponse,
  PutLedgerRequest,
  PutSurfaceRequest,
  PutVerbRequest,
  TodayResponse,
  VerbResultRequest,
} from '../../../shared/contract/api';
import * as day from '../areas/conversation/day';
import * as convo from '../areas/conversation/ops';
import { searchMessages } from '../areas/conversation/search';
import * as cstore from '../areas/conversation/store';
import * as ledger from '../areas/ledger/ops';
import { type LedgerFilter, page as ledgerPage } from '../areas/ledger/store';
import { assemble } from '../areas/mind/assemble';
import { type FireResult, fire, fireConfig } from '../areas/mind/fire';
import { nightWake } from '../areas/mind/night';
import * as mind from '../areas/mind/ops';
import * as stop from '../areas/mind/stop';
import * as mstore from '../areas/mind/store';
import * as wake from '../areas/mind/wake';
import { getSetting, putSetting } from '../areas/settings/store';
import * as surfaces from '../areas/surfaces/ops';
import { list as listSurfaces } from '../areas/surfaces/store';
import * as verbs from '../areas/verbs/ops';
import { attempt } from '../lib/result';
import type { Caller } from './caller';
import { CORE_TABLES } from './core.migrations';
import { CoreNight } from './core-night';

const PRUNE_STEP = 2_000;

export class Core extends CoreNight {
  // --- the conversation ------------------------------------------------------------------------

  today(): TodayResponse {
    const d = day.currentDay(this.db, this.tz(), Date.now());
    const thread = cstore.dailyThread(this.db, d);
    return { thread, messages: thread ? cstore.lastMessages(this.db, thread.id, 50) : [], seq: this.lastSeq(), day: d };
  }

  threads(status: 'open' | 'filed' | null, limit: number, after: [number, string] | null) {
    return cstore.threadsPage(this.db, status, limit, after);
  }

  thread(id: string) {
    return cstore.thread(this.db, id);
  }

  messages(threadId: string, before: number | null, after: number | null, limit: number) {
    return cstore.messagesPage(this.db, threadId, before, after, limit);
  }

  putMessage(c: Caller, p: convo.PutMessage) {
    const out = this.run((w) => {
      const r = convo.putMessage(w, c, p, this.tz());
      const ownerNew = r.created && r.message.author === 'owner';
      if (r.created && c.who === 'C' && r.message.kind === 'text') {
        // The chat mind's reply after a Stop ("Stopped. Done: … Not done: …") clears it, and once
        // nothing waits the mind is listening again, so the edge stops pulsing.
        stop.clear(w);
        if (cstore.unansweredIds(w.db).length === 0) wake.setPresence(w, 'listening');
      }
      return {
        ...r,
        wake: ownerNew ? wake.maybeWake(w, 'message', this.configured()) : null,
        stop: c.who === 'C' && stop.standing(w.db) !== null,
      };
    });
    this.schedule();
    return out;
  }

  patchMessage(id: string, body: string | undefined, meta: JsonObject | undefined) {
    return this.run((w) => convo.patchMessage(w, id, body, meta));
  }

  patchThread(id: string, title: string | undefined, summary: string | undefined) {
    return this.run((w) => convo.patchThread(w, id, title, summary));
  }

  continueThread(id: string) {
    return this.run((w) => convo.continueThread(w, id, this.tz()));
  }

  searchMessages(match: string, since: number | null, until: number | null, thread: string | null, limit: number) {
    return searchMessages(this.db, match, since, until, thread, limit);
  }

  // --- the mind ---------------------------------------------------------------------------------

  typing() {
    const f = this.write((w) => wake.maybeWake(w, 'prewarm', this.configured()));
    this.schedule();
    return f;
  }

  brief(_c: Caller, r: BriefRequest) {
    return attempt(() => {
      const claimed = r.claim ? this.write((w) => mind.claim(w, r, this.tz())).wake : null;
      // A claim hands out what the briefing shows: the requeue alarm must cover it.
      if (r.claim) this.schedule();
      return assemble(this.db, r.role, this.tz(), Date.now(), claimed, r.constitution_sha256, r.session_id, {
        nightConfigured: this.nightConfigured(),
      });
    });
  }

  mindStatus(c: Caller, r: MindStatusRequest): { typing: boolean; stop: boolean } {
    const out = this.write((w) => mind.status(w, c.session_id, roleOf(c), r));
    if (r.state === 'limited' && roleOf(c) === 'chat') this.write((w) => wake.limited(w, r.error ?? null));
    if (out.typing) this.hub.typing(Date.now() + 60_000);
    return { ...out, stop: roleOf(c) === 'chat' && stop.standing(this.db) !== null };
  }

  /** The owner tapped Stop (POST /v1/mind/stop). */
  stop(): void {
    this.write((w) => stop.request(w));
  }

  mindNote(c: Caller, r: MindNoteRequest) {
    return this.run((w) => mind.note(w, c.session_id, roleOf(c), r));
  }

  mindTaint(c: Caller, source: string) {
    return attempt(() =>
      this.ctx.storage.transactionSync(() =>
        mind.taint(this.db, c.session_id, roleOf(c), source, Date.now(), this.tz()),
      ),
    );
  }

  mindPending(c: Caller): PendingResponse {
    return mind.pending(this.db, c.session_id, roleOf(c), Date.now(), this.tz());
  }

  wakes(limit: number, before: number | null) {
    return mstore.wakesPage(this.db, limit, before);
  }

  liveTake(c: Caller, after: number): LiveWaitResponse {
    const r = this.write((w) => mind.take(w, after, roleOf(c), c.session_id, this.tz()));
    this.schedule();
    return r;
  }

  recordFire(id: string, result: FireResult): void {
    this.write((w) => wake.fired(w, id, result));
    this.schedule();
  }

  /** Wake retries, give-ups and requeues (RUNTIME.md §4.4–4.5). */
  override async alarm(): Promise<void> {
    this.alarmAt = null;
    const fires = this.write((w) => wake.onAlarm(w, this.configured(), this.tz()));
    const cfg = fireConfig(this.env, 'chat');
    if (cfg) for (const f of fires) this.recordFire(f.id, await fire(cfg));
    this.schedule();
  }

  /** The 15-minute cron: the day roll after 60 quiet minutes (which fires the night shift for the
   * day it closed, once the mind-night task is connected), expiring verbs, and once a logical day
   * the prune pass (DATA.md §10, JOBS.md §4.4). The fire runs after the roll's commit. */
  async tick(
    now = Date.now(),
    fetchImpl: typeof fetch = fetch,
  ): Promise<{ rolled: string | null; pruned: number; night: string | null }> {
    const tz = this.tz();
    const d = day.currentDay(this.db, tz, now);
    const due = day.rollDue(d, now, tz, cstore.lastMessageAt(this.db));
    const wakeNight = due
      ? this.write((w) => {
          convo.roll(w, due);
          return nightWake(w, due, this.nightConfigured());
        }, now)
      : null;
    this.write((w) => verbs.settle(w), now);
    const pruned = this.pruneDaily(now, day.logicalDay(now, tz));
    const cfg = wakeNight ? fireConfig(this.env, 'night') : null;
    if (wakeNight && cfg) this.recordFire(wakeNight.id, await fire(cfg, fetchImpl));
    return { rolled: due, pruned, night: wakeNight?.id ?? null };
  }

  /** Every table's prune, ≤ 2,000 rows each a step. The day counts as done only when no prune was
   * cut short, so a backlog continues on the next tick. */
  private pruneDaily(now: number, today: string): number {
    if (getSetting(this.db, 'prune.day') === today) return 0;
    return this.ctx.storage.transactionSync(() => {
      let total = 0;
      let short = true;
      for (const t of Object.values(CORE_TABLES)) {
        const n = t.prune?.(this.db, now, PRUNE_STEP) ?? 0;
        total += n;
        if (n >= PRUNE_STEP) short = false;
      }
      if (short) putSetting(this.db, 'prune.day', today, 'worker', now);
      return total;
    });
  }

  // --- the ledger, verbs and surfaces ------------------------------------------------------------

  ledger(before: number | null, limit: number, filter: LedgerFilter) {
    return ledgerPage(this.db, before, limit, filter);
  }

  putLedger(c: Caller, id: string, r: PutLedgerRequest, hash: string) {
    return this.run((w) => ledger.put(w, c, id, r, hash));
  }

  undo(c: Caller, id: string) {
    return this.run((w) => ledger.undo(w, c, id));
  }

  putVerb(c: Caller, id: string, r: PutVerbRequest, hash: string) {
    return this.run((w) => verbs.put(w, c, id, r, hash));
  }

  pendingVerbs(deviceId: string) {
    return this.write((w) => verbs.pending(w, deviceId));
  }

  claimVerb(id: string, deviceId: string) {
    return this.run((w) => verbs.claim(w, id, deviceId));
  }

  verbResult(id: string, deviceId: string, r: VerbResultRequest) {
    return this.run((w) => verbs.result(w, id, deviceId, r));
  }

  surfaces(since: number) {
    return { items: listSurfaces(this.db, since, Date.now()), seq: this.lastSeq() };
  }

  putSurface(c: Caller, app: string, slot: string, r: PutSurfaceRequest) {
    return this.run((w) => surfaces.put(w, c, app, slot, r));
  }

  deleteSurface(c: Caller, app: string, slot: string) {
    return this.run((w) => surfaces.remove(w, c, app, slot));
  }
}

const roleOf = (c: Caller) => (c.who === 'N' ? 'night' : c.who === 'R' ? 'reflex' : 'chat');

export function coreObject(env: Env): DurableObjectStub<Core> {
  return env.CORE.getByName('owner');
}

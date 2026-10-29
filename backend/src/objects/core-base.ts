// The first half of the Core object (see core.ts): the P1 routes' data, the change feed and the
// live channel's sockets, and the helpers every area uses: `write` (commit.ts: one transaction,
// then the live channel), `run` (area failures as `{ok:false, code}`) and `schedule` (the alarm).
import type { ChangesResponse, ErrorReport, ErrorRow, PerfRequest, Settings } from '../../../shared/contract/api';
import { sha256Hex } from '../areas/auth/crypto';
import * as day from '../areas/conversation/day';
import { Hub } from '../areas/feed/hub';
import * as feed from '../areas/feed/store';
import { fireConfig } from '../areas/mind/fire';
import * as mstore from '../areas/mind/store';
import * as wake from '../areas/mind/wake';
import * as ops from '../areas/ops/store';
import * as settings from '../areas/settings/store';
import { attempt, Fail, type Out } from '../lib/result';
import { HOUR } from '../lib/time';
import { type ClassHealth, OwnerObject } from './base';
import { commit, type Writer } from './commit';
import { CORE_MIGRATIONS } from './core.migrations';

/** P1 (settings, errors, perf, health), the change feed and the live channel, and the write and
 * alarm helpers every area uses. `Core` adds the P2 areas on top. */
export abstract class CoreBase extends OwnerObject {
  protected readonly hub: Hub;
  protected alarmAt: number | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env, CORE_MIGRATIONS);
    this.hub = new Hub(ctx);
    // Pings are answered by the runtime without waking the object (API.md §12).
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  protected tz(): string {
    return day.ownerTz(this.db, this.env.OWNER_TZ);
  }

  protected write<T>(fn: (w: Writer) => T, at = Date.now()): T {
    const r = commit(this.ctx.storage, this.db, fn, at);
    if (r.kinds.length) this.hub.changed(r.seq, r.kinds);
    return r.value;
  }

  protected run<T>(fn: (w: Writer) => T): Out<T> {
    return attempt(() => this.write(fn));
  }

  protected configured(): boolean {
    return fireConfig(this.env, 'chat') !== null;
  }

  /** Sets the alarm to the next due wake retry or requeue, writing only when it moves. */
  protected schedule(): void {
    const t = wake.nextAlarmAt(this.db);
    if (t !== null && t !== this.alarmAt) {
      this.alarmAt = t;
      void this.ctx.storage.setAlarm(t);
    }
  }

  // --- P1: settings, errors, perf, health ------------------------------------------------------

  settings(): Settings {
    return { 'owner.tz': this.env.OWNER_TZ || 'UTC', min_client: 0, ...settings.allSettings(this.db) };
  }

  minClient(): number {
    const v = settings.getSetting(this.db, 'min_client');
    return typeof v === 'number' ? v : 0;
  }

  patchSettings(patch: Record<string, unknown>, actor: string): Record<string, unknown> {
    return this.write((w) => {
      for (const [key, value] of Object.entries(patch)) {
        settings.putSetting(w.db, key, value, actor, w.at);
        w.change('setting', `setting:${key}`);
      }
      return patch;
    });
  }

  reportErrors(items: ErrorReport[]): void {
    this.write((w) => {
      for (const e of items)
        ops.upsertError(
          w.db,
          e.fingerprint ?? sha256Hex(`${e.source}|${e.code}|${e.route ?? ''}`).slice(0, 32),
          e,
          w.at,
        );
      w.change('error');
    });
  }

  listErrors(open: boolean, limit: number, after: [number, string] | null, since: number | null = null): ErrorRow[] {
    return ops.listErrors(this.db, open, limit, after, since);
  }

  resolveError(fingerprint: string): number {
    return this.write((w) => {
      const n = ops.resolveError(w.db, fingerprint, w.at);
      if (n) w.change('error');
      return n;
    });
  }

  putPerf(p: PerfRequest): void {
    this.ctx.storage.transactionSync(() => ops.putPerf(this.db, p));
  }

  deepHealth(): ClassHealth & { errors_open: number; min_client: number; wakes_today: number } {
    return {
      ...this.health(),
      errors_open: ops.countOpenErrors(this.db),
      min_client: this.minClient(),
      wakes_today: mstore.wakesToday(this.db, Date.now() - 24 * HOUR),
    };
  }

  // --- the change feed and the live channel ----------------------------------------------------

  lastSeq(): number {
    return feed.lastSeq(this.db);
  }

  changes(after: number, limit: number): Out<ChangesResponse> {
    return attempt(() => {
      const oldest = feed.oldestSeq(this.db);
      if (after > 0 && oldest > 0 && after < oldest - 1) throw new Fail('resync_required');
      const items = feed.changesAfter(this.db, after, limit + 1);
      const more = items.length > limit;
      const page = items.slice(0, limit);
      return { items: page, next_after: page.at(-1)?.seq ?? Math.max(after, feed.lastSeq(this.db)), more };
    });
  }

  liveTicket(hash: string, sessionId: string, expiresAt: number): void {
    this.ctx.storage.transactionSync(() => feed.putTicket(this.db, hash, sessionId, expiresAt));
  }

  consumeTicket(hash: string): string | null {
    return this.ctx.storage.transactionSync(() => feed.consumeTicket(this.db, hash, Date.now()));
  }

  liveRevoke(sessionIds: string[]): number {
    return this.hub.revoke(sessionIds);
  }

  /** WebSocket upgrades from the Worker only: `/live` for a phone whose ticket the Worker already
   * consumed (TH-Live-Session), `/wait` for a waiting mind. */
  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response(null, { status: 400 });
    const path = new URL(request.url).pathname;
    const session = request.headers.get('TH-Live-Session');
    if (path !== '/wait' && !(path === '/live' && session)) return new Response(null, { status: 404 });
    const { 0: client, 1: server } = new WebSocketPair();
    this.hub.accept(
      server,
      path === '/wait' ? 'wait' : { session_id: session as string },
      this.lastSeq(),
      this.minClient(),
    );
    return new Response(null, { status: 101, webSocket: client });
  }

  override webSocketMessage(): void {
    // Clients never send data (API.md §12); pings are auto-answered.
  }

  override webSocketClose(ws: WebSocket, code: number): void {
    try {
      ws.close(code === 1005 ? 1000 : code, 'bye');
    } catch {
      // already closed
    }
  }
}

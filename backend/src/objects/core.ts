// The Core object: the owner's data (conversation, ledger, memory … arriving from P2). In P1 it
// holds settings, the error inbox, the daily performance summary and the change feed. A thin
// RPC facade over the areas' store functions.
import type { ErrorReport, ErrorRow, PerfRequest, Settings } from '../../../shared/contract/api';
import { sha256Hex } from '../areas/auth/crypto';
import * as ops from '../areas/ops/store';
import * as settings from '../areas/settings/store';
import { type ClassHealth, OwnerObject } from './base';
import { CORE_MIGRATIONS } from './core.migrations';

export class Core extends OwnerObject {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env, CORE_MIGRATIONS);
  }

  /** Every setting, with the P1 defaults filled in. `owner.tz` falls back to the OWNER_TZ var
   * (UTC) until the phone sets the real zone. */
  settings(): Settings {
    return { 'owner.tz': this.env.OWNER_TZ || 'UTC', min_client: 0, ...settings.allSettings(this.db) };
  }

  minClient(): number {
    const v = settings.getSetting(this.db, 'min_client');
    return typeof v === 'number' ? v : 0;
  }

  /** Writes the given keys in one transaction, with one change row each. */
  patchSettings(patch: Record<string, unknown>, actor: string): Record<string, unknown> {
    const at = Date.now();
    this.ctx.storage.transactionSync(() => {
      for (const [key, value] of Object.entries(patch)) {
        settings.putSetting(this.db, key, value, actor, at);
        ops.addChange(this.db, 'setting', `setting:${key}`, at);
      }
    });
    return patch;
  }

  /** Stores reported errors in one transaction; the fingerprint defaults to source|code|route. */
  reportErrors(items: ErrorReport[]): void {
    const at = Date.now();
    this.ctx.storage.transactionSync(() => {
      for (const e of items) {
        const fp = e.fingerprint ?? sha256Hex(`${e.source}|${e.code}|${e.route ?? ''}`).slice(0, 32);
        ops.upsertError(this.db, fp, e, at);
      }
      ops.addChange(this.db, 'error', null, at);
    });
  }

  listErrors(open: boolean, limit: number, after: [number, string] | null): ErrorRow[] {
    return ops.listErrors(this.db, open, limit, after);
  }

  resolveError(fingerprint: string): number {
    return this.ctx.storage.transactionSync(() => {
      const n = ops.resolveError(this.db, fingerprint, Date.now());
      if (n) ops.addChange(this.db, 'error', null, Date.now());
      return n;
    });
  }

  putPerf(p: PerfRequest): void {
    this.ctx.storage.transactionSync(() => ops.putPerf(this.db, p));
  }

  deepHealth(): ClassHealth & { errors_open: number; min_client: number } {
    return { ...this.health(), errors_open: ops.countOpenErrors(this.db), min_client: this.minClient() };
  }
}

export function coreObject(env: Env): DurableObjectStub<Core> {
  return env.CORE.getByName('owner');
}

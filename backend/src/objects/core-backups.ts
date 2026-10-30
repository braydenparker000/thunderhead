// The backups' half of the Core object (P4 stage E–F, areas/backups): the weekly backup and the
// monthly drill when they are due (each tick) or asked for, the list, "download everything", and
// the four methods the drill calls on its scratch instance `drill-<YYYYMM>`, which refuse on any
// other instance. The work is chunked jobs the alarm runs. The sandbox has none of it.
import type {
  BackupItem,
  BackupManifest,
  BackupRunResponse,
  DrillRunResponse,
  ExportStatus,
} from '../../../shared/contract/backups.ts';
import { exportPrefix } from '../areas/backups/export-job';
import { manifestKey } from '../areas/backups/job';
import { backupsOf, OTHER_EXPORT } from '../areas/backups/objects';
import * as backups from '../areas/backups/ops';
import { count, putRows, type Row } from '../areas/backups/rows';
import * as bstore from '../areas/backups/store';
import { logicalDay } from '../areas/conversation/day';
import type { Out } from '../lib/result';
import { Fail } from '../lib/result';
import { ownerDay, wallMinute } from '../lib/time';
import { applyMigrations } from './base';
import type { Caller } from './caller';
import { CORE_MIGRATIONS, CORE_TABLES } from './core.migrations';
import { CoreWatchdogs } from './core-watchdogs';
import { libraryObject } from './library';
import { sensesObject } from './senses';

const BACKUP_TABLES = () =>
  Object.entries(CORE_TABLES)
    .filter(([, t]) => t.backup)
    .map(([n]) => n);
const EXPORT_TABLES = () => [
  ...Object.entries(CORE_TABLES)
    .filter(([, t]) => t.export)
    .map(([n]) => n),
  ...OTHER_EXPORT(),
];

export abstract class CoreBackups extends CoreWatchdogs {
  private get vault(): R2Bucket | null {
    return (this.env as { VAULT?: R2Bucket }).VAULT ?? null;
  }

  private get drillScratch(): boolean {
    return /^drill-\d{6}$/.test(this.ctx.id.name ?? '');
  }

  /** The tick's backup pass: the weekly backup and the monthly drill when due, and the files of
   * exports past their hour. */
  protected async backupsTick(now: number): Promise<void> {
    if (this.sandboxed || this.drillScratch || !this.vault) return;
    const tz = this.tz();
    const day = ownerDay(now, tz);
    if (backups.weeklyDue(this.db, day, wallMinute(now, tz))) await this.startBackup(day, now);
    const due = backups.drillDue(this.db, day);
    if (due) await this.startDrill(due.month, now).catch(() => undefined);
    // Each finished day's events archived, and events past 90 days pruned (the Senses object).
    await sensesObject(this.env)
      .daily(now, logicalDay(now, tz))
      .catch(() => undefined);
    // Study's unfinished uploads, lapsed reading runs, deleted highlights (the Library object).
    await libraryObject(this.env)
      .daily(now)
      .catch(() => undefined);
    for (const e of bstore.expiredExports(this.db, now)) {
      const listed = await this.vault.list({ prefix: exportPrefix(e.id) });
      if (listed.objects.length) await this.vault.delete(listed.objects.map((o) => o.key));
      this.write((w) => bstore.markExpired(w.db, e.id), now);
    }
  }

  private async startBackup(day: string, now = Date.now()): Promise<BackupRunResponse> {
    const bookmark = await this.ctx.storage.getCurrentBookmark().catch(() => null);
    const core = { tables: BACKUP_TABLES(), schema_version: this.migration, bookmark };
    // The other objects' tables go with it; one that can't answer is left out, and Core's still runs.
    const others = await backupsOf(this.env);
    const out = this.write((w) => backups.startBackup(w, { date: day, core, others }), now);
    this.schedule();
    return out;
  }

  private async startDrill(month: string, now = Date.now()): Promise<DrillRunResponse> {
    const last = bstore.lastComplete(this.db);
    if (!last || !this.vault) throw new Fail('conflict', { reason: 'no complete backup yet' });
    const obj = await this.vault.get(last.manifest_key ?? manifestKey(last.date, 'core'));
    if (!obj) throw new Fail('conflict', { reason: 'the backup has no manifest' });
    const manifest = (await obj.json()) as BackupManifest;
    const out = this.write((w) => backups.startDrill(w, month, manifest), now);
    this.schedule();
    return out;
  }

  async backupRun(_c: Caller): Promise<Out<BackupRunResponse>> {
    if (this.sandboxed) return { ok: false, code: 'forbidden' };
    return { ok: true, value: await this.startBackup(ownerDay(Date.now(), this.tz())) };
  }

  backups(limit: number): BackupItem[] {
    return bstore.list(this.db, limit);
  }

  async drillRun(_c: Caller): Promise<Out<DrillRunResponse>> {
    if (this.sandboxed) return { ok: false, code: 'forbidden' };
    try {
      return { ok: true, value: await this.startDrill(ownerDay(Date.now(), this.tz()).slice(0, 7)) };
    } catch (e) {
      if (e instanceof Fail) return { ok: false, code: e.code, details: e.details };
      throw e;
    }
  }

  exportStart(c: Caller): Out<{ export_id: string }> {
    if (this.sandboxed) return { ok: false, code: 'forbidden' };
    const out = this.run((w) =>
      backups.startExport(w, c, { date: ownerDay(w.at, this.tz()), tables: EXPORT_TABLES() }),
    );
    this.schedule();
    return out;
  }

  exportStatus(id: string, session: string): ExportStatus | null {
    return backups.exportStatus(this.db, id, session, Date.now());
  }

  exportFiles(id: string, session: string) {
    return backups.exportFiles(this.db, id, session, Date.now());
  }

  lastBackup() {
    return backups.lastBackup(this.db, Date.now());
  }

  // --- the drill's scratch instance ------------------------------------------------------------

  private scratchOnly(): void {
    if (!this.drillScratch) throw new Error('only a drill instance');
  }

  /** Empty, with the schema in place (a scratch instance emptied before has none). */
  async drillReset(): Promise<void> {
    this.scratchOnly();
    await this.ctx.storage.deleteAll();
    await applyMigrations(this.ctx.storage, this.db, CORE_MIGRATIONS);
  }

  async drillPut(table: string, rows: Row[]): Promise<number> {
    this.scratchOnly();
    if (!CORE_TABLES[table]?.backup) throw new Error('not a backed-up table');
    return this.ctx.storage.transactionSync(() => putRows(this.db, table, rows));
  }

  async drillCounts(tables: string[]): Promise<Record<string, number>> {
    this.scratchOnly();
    return Object.fromEntries(tables.filter((t) => CORE_TABLES[t]?.backup).map((t) => [t, count(this.db, t)]));
  }

  async drillEmpty(): Promise<void> {
    this.scratchOnly();
    await this.ctx.storage.deleteAll();
  }
}

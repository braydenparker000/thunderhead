// Starting a backup, a drill or an export (one row and its job in one commit), when each is due
// on its own (Sundays 02:30 local; the drill on the first Sunday of a month, after that day's
// backup), and what an export's owner may see of it. One of each runs at a time.
import {
  BACKUP_LIMITS,
  type BackupManifest,
  type BackupRunResponse,
  type ExportStatus,
} from '../../../../shared/contract/backups.ts';
import { uuidv7 } from '../../lib/ids';
import { Fail } from '../../lib/result';
import { DAY } from '../../lib/time';
import type { Db } from '../../objects/base';
import type { Caller } from '../../objects/caller';
import type { Writer } from '../../objects/commit';
import { insertJob } from '../jobs/store';
import { type DrillPayload, drillInstance } from './drill';
import type { ExportPayload } from './export-job';
import type { BackupPayload } from './job';
import * as store from './store';

const [weeklyH, weeklyM] = BACKUP_LIMITS.weekly_local.split(':').map(Number);
const weekday = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();

/** Whether the weekly backup is due for `day` (a Sunday, at or after 02:30 local, none yet for
 * the day and none still running). */
export const weeklyDue = (db: Db, day: string, minute: number) =>
  weekday(day) === 0 &&
  minute >= weeklyH * 60 + weeklyM &&
  !store.backup(db, store.backupId(day, 'core')) &&
  !store.runningBackup(db);

/** The month whose drill is due: the first Sunday's backup is complete and no drill ran yet. */
export function drillDue(db: Db, day: string): { month: string; backup: store.BackupRow } | null {
  if (weekday(day) !== 0 || Number(day.slice(8)) > 7) return null;
  const b = store.backup(db, store.backupId(day, 'core'));
  const month = day.slice(0, 7);
  return b?.state === 'complete' && !store.drill(db, month) ? { month, backup: b } : null;
}

export function startBackup(
  w: Writer,
  r: { date: string; tables: string[]; schema_version: number; bookmark: string | null },
): BackupRunResponse {
  const id = store.backupId(r.date, 'core');
  const running = store.runningBackup(w.db);
  if (running) return { job_ids: [running.job_id] };
  const jobId = uuidv7(w.at);
  const payload: BackupPayload = {
    backup_id: id,
    date: r.date,
    class: 'core',
    tables: r.tables,
    schema_version: r.schema_version,
    bookmark: r.bookmark,
    started_at: w.at,
  };
  store.insertBackup(w.db, { id, date: r.date, cls: 'core', job_id: jobId, at: w.at });
  insertJob(w.db, { id: jobId, kind: 'export.weekly', payload, at: w.at });
  return { job_ids: [jobId] };
}

export function startDrill(w: Writer, month: string, manifest: BackupManifest): { job_id: string } {
  const had = store.drill(w.db, month);
  if (had?.state === 'running') return { job_id: had.job_id };
  const jobId = uuidv7(w.at);
  const payload: DrillPayload = { month, instance: drillInstance(month), backup_date: manifest.date, manifest };
  store.insertDrill(w.db, { month, backup_date: manifest.date, job_id: jobId, at: w.at });
  insertJob(w.db, { id: jobId, kind: 'drill.monthly', payload, at: w.at });
  return { job_id: jobId };
}

export function startExport(w: Writer, c: Caller, r: { date: string; tables: string[] }): { export_id: string } {
  const building = store.buildingExport(w.db);
  if (building && building.session_id === c.session_id) return { export_id: building.id };
  if (building) throw new Fail('conflict', { reason: 'an export is being built' });
  const id = uuidv7(w.at);
  const jobId = uuidv7(w.at);
  const payload: ExportPayload = { export_id: id, date: r.date, tables: r.tables };
  store.insertExport(w.db, { id, job_id: jobId, session_id: c.session_id, at: w.at });
  insertJob(w.db, { id: jobId, kind: 'export.download', payload, at: w.at });
  w.ledger({
    kind: 'note',
    actor: c.actor,
    session_id: c.session_id,
    what: 'started "download everything"',
    why: 'the owner asked, with the password again (MENU-AND-SETTINGS.md §4.9)',
    ref: `export:${id}`,
    undoable: false,
  });
  return { export_id: id };
}

/** An export as its own device sees it; null for anyone else's, or none. */
export function exportStatus(db: Db, id: string, session: string, now: number): ExportStatus | null {
  const r = store.exportRow(db, id);
  if (!r || r.session_id !== session) return null;
  const last = store.lastComplete(db);
  const expired = r.state === 'expired' || (r.state === 'ready' && (r.expires_at ?? 0) <= now);
  return {
    status: expired ? 'expired' : r.state,
    progress: r.progress,
    items:
      r.state === 'ready' && !expired
        ? [
            {
              label: `thunderhead-export-${new Date(r.created_at).toISOString().slice(0, 10)}.zip`,
              url: `/v1/export/${id}/zip`,
              bytes: r.bytes,
              expires_at: r.expires_at ?? 0,
            },
          ]
        : [],
    last_backup: last ? { date: last.date, finished_at: last.finished_at ?? 0 } : null,
  };
}

/** What the download streams: the files of a ready, unexpired export of this device. */
export function exportFiles(db: Db, id: string, session: string, now: number) {
  const r = store.exportRow(db, id);
  if (!r || r.session_id !== session || r.state !== 'ready' || (r.expires_at ?? 0) <= now) return null;
  return {
    files: JSON.parse(r.files_json) as store.ExportFile[],
    at: r.ready_at ?? r.created_at,
    date: new Date(r.created_at).toISOString().slice(0, 10),
  };
}

/** The newest complete backup for deep health and `backup.stale`. */
export function lastBackup(db: Db, now: number) {
  const b = store.lastComplete(db);
  return b
    ? { date: b.date, finished_at: b.finished_at ?? 0, age_h: Math.floor((now - (b.finished_at ?? 0)) / (DAY / 24)) }
    : null;
}

// The built watchdogs' checks (OPERATIONS.md §8.2): each reads counts and returns what tripped it
// (counts and names only), or null. The error checks compare with what they saw before: the
// totals of the last hour's checks and, for one fingerprint, the previous check's counts; with no
// earlier check they only record (so the first run after a deploy never trips).
import { WATCHDOG_LIMITS as L, type WatchdogName } from '../../../../shared/contract/watchdogs.ts';
import { HOUR, MINUTE, wallMinute } from '../../lib/time';
import type { Db } from '../../objects/base';
import { BACKUP_CHECKS } from '../backups/checks';
import { stuckJob } from '../jobs/store';
import { dayNote } from '../memory/notes';
import { nightDayOf, nightDone } from '../mind/night';
import { errorCounts } from '../ops/store';
import * as store from './store';

export interface CheckCtx {
  at: number;
  tz: string;
  dbBytes: number;
  nightConfigured: boolean;
  /** What each watchdog's GATHER entry read before the tick's write (absent when it failed). */
  gathered?: Partial<Record<WatchdogName, unknown>>;
}

/** The error checks' memory: totals by check time, and the last check's counts per fingerprint. */
export interface Snapshot {
  totals: { at: number; total: number }[];
  fps?: Record<string, number>;
}

export interface CheckOut {
  detail: string | null;
  snapshot?: Snapshot;
}

/** A watchdog's check: reads counts in the tick's write, returns what tripped it (counts and names
 * only) or null. Pure in `db`, `c` and `prev`. */
export type Check = (db: Db, c: CheckCtx, prev: Snapshot | null) => CheckOut;

/** Reads a check needs from outside Core's SQL (a bucket listing, say), run before the tick's write;
 * the value reaches the check as `c.gathered[name]`. A gather that throws leaves it absent. */
export type Gather = (env: Env, db: Db) => Promise<unknown>;

const SERVER = ['worker', 'do'] as const;
const CLIENT = ['client', 'csp'] as const;

/** New errors since the newest earlier total at least `window` old (else the oldest one). */
function sinceWindow(prev: Snapshot | null, at: number, total: number, window: number) {
  const totals = (prev?.totals ?? []).filter((t) => at - t.at <= window + 30 * MINUTE);
  const base = [...totals].reverse().find((t) => at - t.at >= window) ?? totals[0] ?? null;
  return { delta: base ? total - base.total : null, totals: [...totals, { at, total }].slice(-8) };
}

const errorsSpike: Check = (db, c, prev) => {
  const rows = errorCounts(db, SERVER);
  const total = rows.reduce((n, r) => n + r.count, 0);
  const fps = Object.fromEntries(rows.map((r) => [r.fingerprint, r.count]));
  const w = sinceWindow(prev, c.at, total, L.errors_window_min * MINUTE);
  const snapshot = { totals: w.totals, fps };
  if (w.delta !== null && w.delta >= L.errors_max)
    return { detail: `${w.delta} new server errors in ${L.errors_window_min} min`, snapshot };
  if (prev?.fps) {
    const [fp, n] = rows
      .map((r) => [r.fingerprint, r.count - (prev.fps?.[r.fingerprint] ?? 0)] as const)
      .sort((a, b) => b[1] - a[1])[0] ?? ['', 0];
    if (n >= L.fingerprint_max)
      return { detail: `${n} of fingerprint ${fp.slice(0, 12)} since the last check`, snapshot };
  }
  return { detail: null, snapshot };
};

const clientErrors: Check = (db, c, prev) => {
  const total = errorCounts(db, CLIENT).reduce((n, r) => n + r.count, 0);
  const w = sinceWindow(prev, c.at, total, L.errors_window_min * MINUTE);
  const detail =
    w.delta !== null && w.delta >= L.client_errors_max
      ? `${w.delta} client error reports in ${L.errors_window_min} min`
      : null;
  return { detail, snapshot: { totals: w.totals } };
};

const rollStuck: Check = (db, c) => {
  const d = store.dayStartedAt(db);
  const hours = d ? Math.floor((c.at - d.at) / HOUR) : 0;
  return { detail: d && hours >= L.roll_stuck_h ? `the day ${d.day} began ${hours} hours ago` : null };
};

const [lateH, lateM] = L.night_late_local.split(':').map(Number);
const nightLate: Check = (db, c) => {
  const d = store.dayStartedAt(db);
  if (!c.nightConfigured || !d || wallMinute(c.at, c.tz) < lateH * 60 + lateM || c.at - d.at < 2 * HOUR)
    return { detail: null };
  const night = nightDayOf(d.day);
  return {
    detail: dayNote(db, night) || nightDone(db, night) ? null : `no day note for ${night}, and its run isn't done`,
  };
};

const jobsStuck: Check = (db, c) => {
  const j = stuckJob(db, c.at - L.job_running_h * HOUR, L.job_attempts);
  return { detail: j ? `job ${j.id} (${j.kind}) is ${j.state} after ${j.attempts} attempts` : null };
};

const dbSize: Check = (_db, c) => ({
  detail: c.dbBytes > L.db_bytes ? `Core holds ${Math.round(c.dbBytes / 1024 / 1024)} MB` : null,
});

/** The watchdog registry's checks (EXTENDING.md "A watchdog"): a watchdog runs once its contract
 * entry (shared/contract/watchdogs.ts) has no `deferred` and its check is here. An area that brings
 * a watchdog's data adds its check (and, if it reads outside SQL, its GATHER entry) in its own
 * module and spreads it in below: the backups' `backup.stale`, `drill.failed` and `drill.overdue`
 * (P4 stage E, areas/backups/checks.ts); Muse's `muse.silent` comes with stage G. */
export const CHECKS: Partial<Record<WatchdogName, Check>> = {
  'errors.spike': errorsSpike,
  'client.errors': clientErrors,
  'roll.stuck': rollStuck,
  'night.late': nightLate,
  'jobs.stuck': jobsStuck,
  'db.size': dbSize,
  ...BACKUP_CHECKS,
};

/** The gathers the built checks need (none yet: every check above reads Core's SQL). */
export const GATHER: Partial<Record<WatchdogName, Gather>> = {};

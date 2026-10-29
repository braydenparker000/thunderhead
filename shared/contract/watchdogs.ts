// The watchdogs (OPERATIONS.md §8.2): one registry for the Worker, whose 15-minute tick runs each
// built check, writes one ledger note when it trips and one when it clears, and wakes mind-reflex
// (at most 4 times a day); for `th reflex`, which prints what to do about each tripped one; and for
// CONTRACT.md. Each names the SLO it guards (OPERATIONS.md §8.1). A watchdog whose data arrives in
// a later stage or phase says so in `deferred` and never runs until then.

export type WatchdogSeverity = 'S2' | 'S3' | 'S4';

export interface WatchdogSpec {
  /** When it trips. */
  trips: string;
  severity: WatchdogSeverity;
  /** The SLO or rule it guards (OPERATIONS.md §8.1). */
  slo: string;
  /** A trip wakes mind-reflex. */
  wakes: boolean;
  /** What mind-reflex does about it, printed by `th reflex`. */
  handle: string;
  phase: 'P4' | 'P5';
  /** Not built yet: what it waits for. */
  deferred?: string;
}

export const WATCHDOG_LIMITS = {
  /** Reflex wakes in any 24 hours (RUNTIME.md §3). */
  reflex_wakes_per_day: 4,
  errors_window_min: 60,
  errors_max: 20,
  fingerprint_window_min: 15,
  fingerprint_max: 5,
  client_errors_max: 50,
  roll_stuck_h: 30,
  night_late_local: '09:00',
  job_running_h: 2,
  job_attempts: 5,
  db_bytes: 700 * 1024 * 1024,
} as const;

const REPORT =
  'Report it: th say system --kind error "<what tripped, since when, what you checked, what you left>"';

export const WATCHDOGS = {
  'errors.spike': {
    trips: '≥ 20 new server errors in 60 min, or ≥ 5 of one fingerprint in 15 min',
    severity: 'S3',
    slo: 'API: ≤ 10 server errors a day',
    wakes: true,
    handle: `Read th errors and th health --deep. If the errors began with the latest deploy and sit on one route, revert that commit (git revert <sha>, then push to main: the one push you may make) and check th errors again after 15 minutes. Otherwise change nothing. ${REPORT}.`,
    phase: 'P4',
  },
  'client.errors': {
    trips: '≥ 50 client error reports in 60 min',
    severity: 'S3',
    slo: 'Phone: no repeated client errors',
    wakes: true,
    handle: `Read th errors and look for one message and build behind most of them. Fix nothing yourself; leave a loose end only if the chat session should. ${REPORT}.`,
    phase: 'P4',
  },
  'roll.stuck': {
    trips: 'the open day began more than 30 hours ago (the day roll never ran)',
    severity: 'S2',
    slo: 'Chat: every day rolls after its quiet hour',
    wakes: true,
    handle: `Read th health --deep (the last alarm, the jobs backlog) and th errors for the cron. Change nothing. ${REPORT}.`,
    phase: 'P4',
  },
  'night.late': {
    trips: "no day note for the night's day by 09:00 local (the night shift is connected)",
    severity: 'S3',
    slo: 'Night shift: done by 09:00 local on ≥ 6 nights of 7',
    wakes: true,
    handle: `Read th get /v1/mind/wakes for the night's wake (fire_error, claimed or not). Run nothing of the night yourself. ${REPORT}.`,
    phase: 'P4',
  },
  'jobs.stuck': {
    trips: 'a job running for more than 2 hours, or one tried 5 times',
    severity: 'S3',
    slo: 'Jobs: every job finishes or fails within its runs',
    wakes: true,
    handle: `Read th health --deep (jobs_backlog) and th errors for the job's kind. Change nothing. ${REPORT}.`,
    phase: 'P4',
  },
  'db.size': {
    trips: 'the Core object holds more than 700 MB',
    severity: 'S3',
    slo: 'Budgets: storage stays inside the Free plan',
    wakes: true,
    handle: `Read th health --deep (db_bytes). Delete nothing: deleting data is the owner's. ${REPORT}.`,
    phase: 'P4',
  },
  'quota.rows_written': {
    trips: "the account's rows written today ≥ 70,000",
    severity: 'S3',
    slo: 'Budgets: no Free-plan quota above 70% before 18:00 UTC',
    wakes: true,
    handle: REPORT,
    phase: 'P4',
    deferred: 'a stored per-day meter (DATA.md §3): today the counts live in each isolate only',
  },
  'quota.rows_read': {
    trips: 'rows read today ≥ 3,500,000',
    severity: 'S3',
    slo: 'Budgets: no Free-plan quota above 70% before 18:00 UTC',
    wakes: true,
    handle: REPORT,
    phase: 'P4',
    deferred: 'a stored per-day meter (DATA.md §3)',
  },
  'quota.do_calls': {
    trips: 'object calls today ≥ 70,000',
    severity: 'S3',
    slo: 'Budgets: no Free-plan quota above 70% before 18:00 UTC',
    wakes: true,
    handle: REPORT,
    phase: 'P4',
    deferred: 'a stored per-day meter (DATA.md §3)',
  },
  'backup.stale': {
    trips: 'the newest complete backup is more than 8 days old',
    severity: 'S3',
    slo: 'Backups: newest complete backup < 8 days old',
    wakes: true,
    handle: REPORT,
    phase: 'P4',
    deferred: 'the weekly backups (P4 stage E)',
  },
  'drill.failed': {
    trips: 'the last restore drill failed',
    severity: 'S3',
    slo: 'Backups: the monthly drill passes',
    wakes: true,
    handle: REPORT,
    phase: 'P4',
    deferred: 'the restore drill (P4 stage E)',
  },
  'drill.overdue': {
    trips: 'no restore drill for 35 days',
    severity: 'S3',
    slo: 'Backups: the monthly drill passes',
    wakes: true,
    handle: REPORT,
    phase: 'P4',
    deferred: 'the restore drill (P4 stage E)',
  },
  'muse.silent': {
    trips: 'no Muse API call in 26 hours',
    severity: 'S4',
    slo: 'Muse checks in daily (MUSE.md §9)',
    wakes: false,
    handle: REPORT,
    phase: 'P4',
    deferred: 'Muse on work orders (P4 stage G)',
  },
  'events.export.late': {
    trips: 'day D not archived by D+1 09:00',
    severity: 'S3',
    slo: 'Senses: each day archived by the next morning',
    wakes: true,
    handle: REPORT,
    phase: 'P5',
  },
} as const satisfies Record<string, WatchdogSpec>;

export type WatchdogName = keyof typeof WATCHDOGS;
export const WATCHDOG_NAMES = Object.keys(WATCHDOGS) as WatchdogName[];

/** Watchdog state as `GET /v1/ops/watchdogs` reports it. */
export interface WatchdogItem {
  name: WatchdogName;
  state: 'ok' | 'tripped' | 'later';
  severity: WatchdogSeverity;
  slo: string;
  trips: string;
  /** While tripped: when it tripped, and what the check saw (counts and names, never content). */
  since: number | null;
  detail: string | null;
  /** The reflex's last report on this trip. */
  handled: { at: number; outcome: 'fixed' | 'reported' | 'nothing'; note: string } | null;
  /** Why it doesn't run yet (state `later`). */
  waits: string | null;
}

export interface WatchdogsResponse {
  items: WatchdogItem[];
}

export interface WatchdogHandledRequest {
  outcome: 'fixed' | 'reported' | 'nothing';
  note: string;
}

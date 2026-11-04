// SQL of the listening pass (DATA.md §6.2), Music schema step 3. The pass itself (audio analysed in
// Actions) was cut on 2026-11-04 (MUSIC.md §9, JOBS.md §3): schema steps only add, so its three tables
// stay, empty, in the backup and the export; find still blends `track_analysis` where a row exists,
// and none is written any more. `music_state`'s helpers live here too (step 1's table).
import type { Db } from '../../objects/base';

/** Music schema step 3 (music.ts): expand only. No secondary index: the tables are read by key or
 * whole (the jobs are a few dozen rows; the passes over the others happen once a night). */
export const LISTEN_SQL = [
  `CREATE TABLE external_jobs (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    v INTEGER NOT NULL,
    spec_json TEXT NOT NULL,
    state TEXT NOT NULL,
    issued_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    collected_at INTEGER,
    counts_json TEXT
  ) WITHOUT ROWID`,
  `CREATE TABLE analysis (
    sha256 TEXT PRIMARY KEY,
    analyzer TEXT NOT NULL,
    v INTEGER,
    job_id TEXT NOT NULL,
    applied_at INTEGER NOT NULL,
    result_json TEXT,
    pack BLOB,
    failed TEXT,
    attempts INTEGER NOT NULL DEFAULT 0
  ) WITHOUT ROWID`,
  `CREATE TABLE track_analysis (
    track_id TEXT PRIMARY KEY,
    energy REAL,
    moods_json TEXT,
    neighbours_json TEXT
  ) WITHOUT ROWID`,
];

/** The step's tables, as music.ts lists them for the backup and the export. */
export const LISTEN_TABLES = ['external_jobs', 'analysis', 'track_analysis'] as const;

// --- music_state rows -----------------------------------------------------------------------------

export function getState<T>(db: Db, key: string): T | null {
  const r = db.one<{ value_json: string }>('SELECT value_json FROM music_state WHERE key = ?', key);
  return r ? (JSON.parse(r.value_json) as T) : null;
}

export function putState(db: Db, key: string, value: unknown): number {
  return db.run(
    `INSERT INTO music_state (key, value_json) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json WHERE music_state.value_json <> excluded.value_json`,
    key,
    JSON.stringify(value),
  );
}

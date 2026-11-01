// SQL for the listening pass (JOBS.md §3, DATA.md §6.2), in the Music object: Music schema step 3.
// `external_jobs` keeps each Actions spec (its songs' hashes, its state and counts; finished jobs are
// pruned after 90 days when the next job is issued). `analysis` keeps one row per audio hash: the
// last good result as the Worker re-wrote it from its known fields, a 56-byte `pack` of the numbers
// the phone and the neighbours step need, and the last attempt's analyzer version, failure and
// failures in a row. `track_analysis` is the per-track view other areas read (what the mind knows of
// each song, Music step 4, reads `listeningRows` from it): `energy`, `moods_json` (MUSIC_MOODS to 0–1)
// and `neighbours_json` (track ids, nearest first), filled as results and neighbours are applied. A
// put that changes nothing writes nothing, so a repeated step costs 0 rows.
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

export interface JobRow {
  id: string;
  kind: string;
  v: number;
  spec_json: string;
  state: string;
  issued_at: number;
  expires_at: number;
  collected_at: number | null;
  counts_json: string | null;
}

const JOB_COLS = 'id, kind, v, spec_json, state, issued_at, expires_at, collected_at, counts_json';
const OPEN = "state IN ('issued', 'validating')";

export function insertJob(db: Db, j: Omit<JobRow, 'collected_at' | 'counts_json'>): void {
  db.run(
    `INSERT INTO external_jobs (${JOB_COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
    j.id,
    j.kind,
    j.v,
    j.spec_json,
    j.state,
    j.issued_at,
    j.expires_at,
  );
}

export function job(db: Db, id: string): JobRow | null {
  return db.one<JobRow>(`SELECT ${JOB_COLS} FROM external_jobs WHERE id = ?`, id);
}

/** Newest first; `open`: issued or being applied only. */
export function jobs(db: Db, kind: string | null, open: boolean, limit: number): JobRow[] {
  return db.all<JobRow>(
    `SELECT ${JOB_COLS} FROM external_jobs WHERE (? IS NULL OR kind = ?) ${open ? `AND ${OPEN}` : ''}
     ORDER BY issued_at DESC LIMIT ?`,
    kind,
    kind,
    limit,
  );
}

export function setJob(
  db: Db,
  id: string,
  u: { state: string; collected_at?: number | null; counts?: unknown },
): number {
  return db.run(
    `UPDATE external_jobs SET state = ?, collected_at = coalesce(?, collected_at), counts_json = coalesce(?, counts_json)
     WHERE id = ?`,
    u.state,
    u.collected_at ?? null,
    u.counts === undefined ? null : JSON.stringify(u.counts),
    id,
  );
}

/** Jobs of a kind issued since `since` (the daily cap). */
export function issuedSince(db: Db, kind: string, since: number): number {
  return (
    db.one<{ n: number }>('SELECT count(*) AS n FROM external_jobs WHERE kind = ? AND issued_at >= ?', kind, since)
      ?.n ?? 0
  );
}

/** Issued specs past their time become `expired`; their ids. */
export function expire(db: Db, now: number): string[] {
  return db
    .all<{ id: string }>(
      "UPDATE external_jobs SET state = 'expired' WHERE state = 'issued' AND expires_at <= ? RETURNING id",
      now,
    )
    .map((r) => r.id);
}

/** Finished jobs older than `before`, at most `max` a call. */
export function pruneJobs(db: Db, before: number, max: number): number {
  return db.all(
    `DELETE FROM external_jobs WHERE id IN (SELECT id FROM external_jobs WHERE state NOT IN ('issued', 'validating')
       AND issued_at < ? LIMIT ?) RETURNING 1`,
    before,
    max,
  ).length;
}

// --- analysis ------------------------------------------------------------------------------------

/** Audio hashes due for analysis at `version`, in catalog order: native Opus files with no result,
 * one from another version, or a failure tried fewer than `tries` times. One row per hash. */
export function due(db: Db, version: string, tries: number, limit: number): string[] {
  return db
    .all<{ sha256: string }>(
      `SELECT t.sha256 AS sha256, min(t.ord) AS o FROM tracks t LEFT JOIN analysis a ON a.sha256 = t.sha256
       WHERE t.audio_key = 'native/audio/' || t.sha256 || '.opus'
         AND (a.sha256 IS NULL OR a.analyzer <> ? OR (a.failed IS NOT NULL AND a.attempts < ?))
       GROUP BY t.sha256 ORDER BY o LIMIT ?`,
      version,
      tries,
      limit,
    )
    .map((r) => r.sha256);
}

export interface ResultRow {
  sha256: string;
  analyzer: string;
  v: number;
  result_json: string;
  pack: Uint8Array;
  energy: number;
  /** The moods as `track_analysis` keeps them, or null when the job ran without the model. */
  moods_json: string | null;
}

/** A good result: replaces the row; the same job's result again writes nothing. */
export function putResult(db: Db, r: ResultRow, jobId: string, at: number): number {
  return db.run(
    `INSERT INTO analysis (sha256, analyzer, v, job_id, applied_at, result_json, pack, failed, attempts)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0)
     ON CONFLICT (sha256) DO UPDATE SET analyzer = excluded.analyzer, v = excluded.v, job_id = excluded.job_id,
       applied_at = excluded.applied_at, result_json = excluded.result_json, pack = excluded.pack, failed = NULL,
       attempts = 0
     WHERE analysis.job_id IS NOT excluded.job_id OR analysis.result_json IS NOT excluded.result_json`,
    r.sha256,
    r.analyzer,
    r.v,
    jobId,
    at,
    r.result_json,
    r.pack,
  );
}

/** A failure the job reported: counted in a row at this version; an older good result stays. */
export function putFailure(
  db: Db,
  sha256: string,
  analyzer: string,
  reason: string,
  jobId: string,
  at: number,
): number {
  return db.run(
    `INSERT INTO analysis (sha256, analyzer, v, job_id, applied_at, result_json, pack, failed, attempts)
     VALUES (?, ?, NULL, ?, ?, NULL, NULL, ?, 1)
     ON CONFLICT (sha256) DO UPDATE SET
       attempts = CASE WHEN analysis.analyzer = excluded.analyzer AND analysis.failed IS NOT NULL
         THEN analysis.attempts + 1 ELSE 1 END,
       analyzer = excluded.analyzer, job_id = excluded.job_id, applied_at = excluded.applied_at, failed = excluded.failed
     WHERE analysis.job_id IS NOT excluded.job_id`,
    sha256,
    analyzer,
    jobId,
    at,
    reason,
  );
}

export interface AnalysisRow {
  sha256: string;
  analyzer: string;
  v: number | null;
  result_json: string | null;
  pack: ArrayBuffer | null;
  failed: string | null;
  attempts: number;
  applied_at: number;
}

export function analysisOf(db: Db, sha256: string): AnalysisRow | null {
  return db.one<AnalysisRow>(
    'SELECT sha256, analyzer, v, result_json, pack, failed, attempts, applied_at FROM analysis WHERE sha256 = ?',
    sha256,
  );
}

const marks = (n: number) => Array.from({ length: n }, () => '?').join(', ');

export function packsOf(db: Db, shas: string[]): { sha256: string; pack: ArrayBuffer }[] {
  return shas.length
    ? db.all(`SELECT sha256, pack FROM analysis WHERE pack IS NOT NULL AND sha256 IN (${marks(shas.length)})`, ...shas)
    : [];
}

/** Every analysed hash still in the catalog with its pack, by hash: the neighbours step's order. */
export function embeddings(db: Db): { sha256: string; pack: ArrayBuffer }[] {
  return db.all(
    `SELECT a.sha256 AS sha256, a.pack AS pack FROM analysis a WHERE a.pack IS NOT NULL
       AND EXISTS (SELECT 1 FROM tracks t WHERE t.sha256 = a.sha256) ORDER BY a.sha256`,
  );
}

/** Every track with an analysis, in catalog order: the phone file's rows. */
export function packRows(db: Db): { id: string; sha256: string; pack: ArrayBuffer }[] {
  return db.all(
    `SELECT t.id AS id, t.sha256 AS sha256, a.pack AS pack FROM tracks t JOIN analysis a ON a.sha256 = t.sha256
     WHERE a.pack IS NOT NULL ORDER BY t.ord`,
  );
}

export function trackOf(db: Db, id: string): { id: string; sha256: string; audio_key: string } | null {
  return db.one('SELECT id, sha256, audio_key FROM tracks WHERE id = ?', id);
}

/** The tracks holding these hashes, in catalog order (their records, for titles). */
export function tracksOf(db: Db, shas: string[]): { id: string; sha256: string; record_json: string }[] {
  return shas.length
    ? db.all(`SELECT id, sha256, record_json FROM tracks WHERE sha256 IN (${marks(shas.length)}) ORDER BY ord`, ...shas)
    : [];
}

// --- the pass's own state (music_state rows `listen.*`) ------------------------------------------

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

// The listening pass (JOBS.md §3, MUSIC.md §9.1): every song analysed once in GitHub Actions, by
// its sha256 only, and the numbers brought back through the Worker. Two job kinds: `audio.analysis`
// (≤ 500 songs a job; one result each, schema v2) and `audio.neighbours` (once every song is done:
// each song's 50 nearest by cosine on the 32-d embedding). An Actions run is public and injectable,
// so a result holds numbers and keys from fixed lists only, never words; the schemas below are what
// the Worker checks with `additionalProperties: false`. Plain data with erasable types only, so
// Node can import it without a build (the Python job's own lists are checked against this file).
import type { Ms } from './api';
import { MUSIC_MOODS, type MusicMood } from './music.ts';
import type { Schema } from './work.ts';

export const LISTEN_KINDS = ['audio.analysis', 'audio.neighbours'] as const;
export type ListenKind = (typeof LISTEN_KINDS)[number];

/** Each kind's schema version: a result's `v` (analysis) and the spec's `v`. */
export const LISTEN_V = { 'audio.analysis': 2, 'audio.neighbours': 1 } as const satisfies Record<ListenKind, number>;

/** The analyzer this build expects (jobs/audio/__init__.py, kept equal by tests/jobs-audio.test.mjs).
 * A song analysed by another version is due again, so a new version re-runs the whole library. */
export const ANALYZER = { name: 'th-audio', version: '2.0.0' } as const;

export const LISTEN_LIMITS = {
  /** Songs in one analysis job (GET /v1/jobs/next?max=). */
  max_tracks: 500,
  /** Results a part file holds, in the manifest's `files` order: part-001.jsonl has files 0–49. */
  part_results: 50,
  /** One result's bytes (one line of a part). */
  result_bytes: 8 * 1024,
  /** A part: 50 results and their newlines. */
  part_bytes: 50 * (8 * 1024 + 1),
  manifest_bytes: 1024 * 1024,
  /** The neighbours file: n × k little-endian uint16 (20,000 songs × 50 = 2,000,000 bytes). */
  neighbours_bytes: 2_000_000,
  /** Songs the neighbours step takes at most (indexes are uint16; 0xFFFF means none). */
  neighbours_max: 20_000,
  /** Neighbours per song, and the embedding's dimensions. */
  k: 50,
  dim: 32,
  /** A spec not collected in this time expires; its songs are due again. */
  spec_ttl_ms: 72 * 60 * 60 * 1000,
  /** Open jobs (issued or being applied) of one kind at once. */
  open_jobs: 2,
  /** A song that failed this many times in a row at this analyzer version is not offered again. */
  failures_max: 3,
  /** Finished jobs are kept this long (pruned when the next job is issued). */
  keep_ms: 90 * 24 * 60 * 60 * 1000,
  /** GET /v1/music/analysis/:id?like= */
  like_max: 50,
} as const;

/** The fixed mood list: Music's own (`MUSIC_MOODS`, shared with what the mind knows of each song,
 * Music schema step 4), each scored by the listening pass from a text prompt in jobs/audio/moods.py. */
export const MOODS = MUSIC_MOODS;
export type Mood = MusicMood;

/** The 24 keys: pitch classes in sharps, `m` for minor. */
export const KEYS = [
  'C',
  'C#',
  'D',
  'D#',
  'E',
  'F',
  'F#',
  'G',
  'G#',
  'A',
  'A#',
  'B',
  'Cm',
  'C#m',
  'Dm',
  'D#m',
  'Em',
  'Fm',
  'F#m',
  'Gm',
  'G#m',
  'Am',
  'A#m',
  'Bm',
] as const;
export type KeyName = (typeof KEYS)[number];

export const FAIL_REASONS = ['download', 'hash_mismatch', 'decode', 'analyze', 'timeout'] as const;
export type FailReason = (typeof FAIL_REASONS)[number];

/** The CLAP model the embedding and moods come from (Apache-2.0, JOBS.md §3.2), by its pinned revision
 * (jobs/audio/clap.py, kept equal by tests/jobs-audio.test.mjs). */
export const CLAP_MODEL = { id: 'laion/clap-htsat-unfused', revision: '8fa0f1c6d0433df6e97c127f64b2a1d6c0dcda8a' } as const;

/** A key's place on the Camelot wheel (`8A` is A minor, `8B` C major), or null. */
export function camelotOf(key: string | null): string | null {
  const i = KEYS.indexOf(key as KeyName);
  if (i < 0) return null;
  const minor = i >= 12;
  // The relative major's pitch class, walked by fifths from C (8B).
  const pc = minor ? (i - 12 + 3) % 12 : i;
  return `${((((pc * 7) % 12) + 7) % 12) + 1}${minor ? 'A' : 'B'}`;
}

const HEX64 = '^[0-9a-f]{64}$';
const JOB_ID = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
const SEMVER = '^[0-9]{1,3}\\.[0-9]{1,3}\\.[0-9]{1,3}$';
const unit: Schema = { type: 'number', minimum: 0, maximum: 1 };
const nullable = (s: Schema): Schema => ({ ...s, type: [s.type as 'number', 'null'] });
const obj = (properties: Record<string, Schema>): Schema => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const int = (minimum: number, maximum: number): Schema => ({ type: 'integer', minimum, maximum });
const analyzer = obj({
  name: { type: 'string', enum: [ANALYZER.name] },
  version: { type: 'string', pattern: SEMVER, maxLength: 11 },
});
const MS_MAX = 4_102_444_800_000; // 2100-01-01

/** One song's result (`<sha>.json`, a line of a part), schema v2. v1's fields are kept as they were;
 * the CLAP fields are null when the job ran without the model. Every field is required. */
export const ANALYSIS_SCHEMA: Schema = obj({
  v: { type: 'integer', enum: [LISTEN_V['audio.analysis']] },
  sha256: { type: 'string', pattern: HEX64 },
  analyzer,
  duration_ms: int(1_000, 14_400_000),
  sample_rate: { type: 'integer', enum: [8000, 16000, 24000, 44100, 48000] },
  channels: { type: 'integer', enum: [1, 2] },
  lufs_i: { type: 'number', minimum: -70, maximum: 0 },
  true_peak_db: { type: 'number', minimum: -60, maximum: 3 },
  lra: { type: 'number', minimum: 0, maximum: 40 },
  bpm: nullable({ type: 'number', minimum: 30, maximum: 300 }),
  bpm_conf: unit,
  key: { type: ['string', 'null'], enum: [...KEYS, null] },
  key_conf: unit,
  start_silence_ms: int(0, 14_400_000),
  end_silence_ms: int(0, 14_400_000),
  energy: unit,
  valence: nullable(unit),
  arousal: nullable(unit),
  vocals: nullable(unit),
  moods: { ...obj(Object.fromEntries(MOODS.map((m) => [m, unit]))), type: ['object', 'null'] },
  emb: { type: ['array', 'null'], items: { type: 'number', minimum: -1, maximum: 1 }, minItems: 32, maxItems: 32 },
  emb_v: { type: ['integer', 'null'], enum: [1, null] },
});

/** The manifest of an analysis job (`manifest.json`, uploaded last). */
export const ANALYSIS_MANIFEST_SCHEMA: Schema = obj({
  v: { type: 'integer', enum: [1] },
  job_id: { type: 'string', pattern: JOB_ID },
  kind: { type: 'string', enum: ['audio.analysis'] },
  analyzer,
  started_at: int(0, MS_MAX),
  finished_at: int(0, MS_MAX),
  files: {
    type: 'array',
    maxItems: LISTEN_LIMITS.max_tracks,
    items: obj({
      sha256: { type: 'string', pattern: HEX64 },
      bytes: int(2, LISTEN_LIMITS.result_bytes),
      result_sha256: { type: 'string', pattern: HEX64 },
    }),
  },
  failed: {
    type: 'array',
    maxItems: LISTEN_LIMITS.max_tracks,
    items: obj({ sha256: { type: 'string', pattern: HEX64 }, reason: { type: 'string', enum: [...FAIL_REASONS] } }),
  },
});

/** The manifest of a neighbours job: `neighbours.bin` is n × k uint16, row i the song at index i. */
export const NEIGHBOURS_MANIFEST_SCHEMA: Schema = obj({
  v: { type: 'integer', enum: [1] },
  job_id: { type: 'string', pattern: JOB_ID },
  kind: { type: 'string', enum: ['audio.neighbours'] },
  analyzer,
  started_at: int(0, MS_MAX),
  finished_at: int(0, MS_MAX),
  n: int(2, LISTEN_LIMITS.neighbours_max),
  k: int(1, LISTEN_LIMITS.k),
  bytes: int(2, LISTEN_LIMITS.neighbours_bytes),
  sha256: { type: 'string', pattern: HEX64 },
});

export type JobState = 'issued' | 'validating' | 'applied' | 'rejected' | 'expired';

/** What a job counted: songs in the spec, results applied, refused, failed in the job, not returned. */
export interface JobCounts {
  expected: number;
  valid: number;
  invalid: number;
  failed: number;
  missing: number;
  /** Why results were refused, by fixed reason (never a hash). */
  reasons?: Record<string, number>;
}

/** GET /v1/jobs/next (200). The neighbours kind carries no hashes at all. */
export type JobIssued =
  | { job_id: string; kind: 'audio.analysis'; v: 2; shas: string[]; expires_at: Ms }
  | { job_id: string; kind: 'audio.neighbours'; v: 1; n: number; expires_at: Ms };

/** GET /v1/jobs/:id/spec (CI only), what the workflow works from. `emb`: base64 of n × 32 int8. */
export type JobSpec =
  | { job_id: string; kind: 'audio.analysis'; v: 2; shas: string[]; analyzer: typeof ANALYZER }
  | { job_id: string; kind: 'audio.neighbours'; v: 1; n: number; k: number; dim: number; emb: string };

/** GET /v1/jobs/:id and each item of GET /v1/jobs: states and counts, never hashes. */
export interface JobStatus {
  job_id: string;
  kind: ListenKind;
  v: number;
  state: JobState;
  issued_at: Ms;
  expires_at: Ms;
  collected_at: Ms | null;
  count: number;
  counts: JobCounts | null;
}

/** GET /v1/music/analysis/:id: one song's numbers and its nearest songs, for the mind. */
export interface TrackAnalysis {
  id: string;
  /** `done`, `due` (not analysed yet at this version), `failed` (given up after 3), `unsupported` (not Opus). */
  state: 'done' | 'due' | 'failed' | 'unsupported';
  analysis: {
    analyzer: string;
    duration_ms: number;
    lufs_i: number;
    true_peak_db: number;
    lra: number;
    bpm: number | null;
    bpm_conf: number;
    key: KeyName | null;
    key_conf: number;
    camelot: string | null;
    start_silence_ms: number;
    end_silence_ms: number;
    energy: number;
    valence: number | null;
    arousal: number | null;
    vocals: number | null;
    moods: Record<Mood, number> | null;
    /** The three strongest moods, strongest first. */
    top_moods: Mood[];
  } | null;
  like: { id: string; title: string; artist: string; sim: number }[];
  /** When the neighbours were last worked out (null: not yet). */
  like_at: Ms | null;
}

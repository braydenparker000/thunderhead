// The import of the old Worker's data (MIGRATION.md §3–4, DATA.md §12, API.md §11.17), as data:
// the parts the driver posts unchanged from the old export, the manifest it writes last, and the
// runs that turn one dataset's parts into rows. Each dataset names its old object and table, and
// one not built yet says what it waits for; a run of it is refused until then.
import type { Id, Ms } from './api';

/** At most this many rows, and bytes, in one part (the old export's own step). */
export const IMPORT_PART_ROWS = 2_000;
export const IMPORT_PART_BYTES = 5 * 1024 * 1024;
/** Source rows a finished run compares with what it wrote, chosen with a recorded seed. */
export const IMPORT_SPOT_CHECKS = 20;

export type ImportDataset = 'threads' | 'messages' | 'notebook' | 'muse' | 'board' | 'chat_files' | 'music';

export interface ImportDatasetSpec {
  /** MIGRATION.md §4's number. */
  item: string;
  instance: string;
  table: string;
  built: boolean;
  /** What a dataset not built yet waits for. */
  waits?: string;
  /** Datasets of the same export run that must be done first. */
  after?: readonly ImportDataset[];
}

export const IMPORT_DATASETS: Readonly<Record<ImportDataset, ImportDatasetSpec>> = {
  threads: { item: 'I1', instance: 'claude-chat-v1', table: 'cc_threads', built: true },
  messages: { item: 'I2', instance: 'claude-chat-v1', table: 'cc_messages', built: true, after: ['threads'] },
  notebook: { item: 'I3', instance: 'claude-chat-v1', table: 'cc_state', built: true },
  muse: {
    item: 'I4',
    instance: 'jarvis-shared-v2',
    table: 'relay_mast_entries',
    built: false,
    waits: 'work orders and the muse thread (P4)',
  },
  board: {
    item: 'I5',
    instance: 'jarvis-shared-v2',
    table: 'shared_entries',
    built: false,
    waits: 'the Board on the Briefing page (P4)',
  },
  chat_files: {
    item: 'I6',
    instance: 'claude-chat-v1',
    table: 'cc_messages',
    built: false,
    waits: 'a read binding to jarvis-music for the copy into the private bucket',
  },
  music: { item: 'I7', instance: 'music-catalog-v1', table: 'music_tracks', built: false, waits: 'the Music object (P5)' },
};
export const IMPORT_DATASET_NAMES = Object.keys(IMPORT_DATASETS) as [ImportDataset, ...ImportDataset[]];

/** Why a source row was not imported (DATA.md §12): already there with other content, nothing in
 * it, a reference to a row the export doesn't have, or a row the inventory drops. */
export type ImportSkipReason = 'duplicate' | 'empty' | 'invalid_ref' | 'dropped';
export type ImportState = 'queued' | 'running' | 'verifying' | 'done' | 'failed';

/** POST /v1/import/runs. `id` makes the request idempotent; a new id runs the dataset again. */
export interface ImportRunRequest {
  id: Id;
  run_id: string;
  dataset: ImportDataset;
}

export interface ImportCounts {
  /** The source table's rows, from the manifest. */
  expected: number;
  imported: number;
  skipped: number;
  skip_reasons: Partial<Record<ImportSkipReason, number>>;
  /** Imported messages whose attachments wait for the chat files (I6). */
  files_waiting: number;
}

/** GET /v1/import/runs/:id. `report` once the run is verified: the spot checks (old ids that
 * failed), for messages each thread's count and first and last times against the source's (new
 * thread ids that differ, at most 20), and, for a run of a dataset already imported, how many
 * rows it changed (0 expected). `last_error` is a code: `count_mismatch`, `spot_check_failed`,
 * `thread_shape_mismatch`, or a step's own (`missing_part`, `bad_part`, `not_configured`, …). */
export interface ImportStatus {
  id: Id;
  run_id: string;
  dataset: ImportDataset;
  state: ImportState;
  counts: ImportCounts;
  report: {
    spot_checks: { seed: number; checked: number; passed: number; failed: string[] };
    thread_shapes: { checked: number; failed: string[] } | null;
    rows_changed: number;
    rerun_delta: number | null;
  } | null;
  last_error: string | null;
  started_at: Ms;
  finished_at: Ms | null;
}

/** PUT /v1/ops/import/manifest/:run_id (MIGRATION.md §3): every table the export read, with its
 * rows and parts; a never-exported table has its count only. */
export interface ImportManifest {
  run_id: string;
  worker_version: string | null;
  started_at: Ms;
  finished_at: Ms;
  instances: Record<
    string,
    {
      tables: Record<
        string,
        {
          rows: number;
          parts: number;
          columns: string[];
          sha256s: string[];
          /** Each part's rows (the old export sends 2,000 a part but the last). */
          part_rows?: number[];
          never_export?: boolean;
        }
      >;
    }
  >;
}

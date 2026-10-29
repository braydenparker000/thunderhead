// Starting a run of one dataset (POST /v1/import/runs, DATA.md §12 step 2): an `imports` row and
// the job that does the work, in one commit. The same request id again answers the same run; a
// dataset that needs another one first (messages after threads) waits for it, and a dataset runs
// once at a time. A new id for a dataset done before runs it again, which should change no row.
import type { ImportRunRequest } from '../../../../shared/contract/api';
import { IMPORT_DATASETS } from '../../../../shared/contract/imports.ts';
import { uuidv7 } from '../../lib/ids';
import { Fail, invalid } from '../../lib/result';
import type { Caller } from '../../objects/caller';
import type { Writer } from '../../objects/commit';
import { insertJob } from '../jobs/store';
import type { ImportPayload } from './job';
import * as store from './store';

/** What the route read from the manifest for the run. */
export interface StartImport extends ImportRunRequest, Omit<ImportPayload, 'import_id' | 'run_id' | 'dataset'> {
  prefix: string;
}

export function start(w: Writer, _c: Caller, r: StartImport): { import_id: string } {
  const had = store.importRow(w.db, r.id);
  if (had) {
    if (had.run_id !== r.run_id || had.dataset !== r.dataset) throw new Fail('conflict');
    return { import_id: had.id };
  }
  for (const first of IMPORT_DATASETS[r.dataset].after ?? [])
    if (!store.doneBefore(w.db, r.run_id, first, r.id)) throw invalid('dataset', `import ${first} first`);
  if (store.going(w.db, r.run_id, r.dataset)) throw new Fail('conflict', { reason: 'running' });
  const jobId = uuidv7(w.at);
  const payload: ImportPayload = {
    import_id: r.id,
    run_id: r.run_id,
    dataset: r.dataset as ImportPayload['dataset'],
    instance: r.instance,
    table: r.table,
    rows: r.rows,
    sha256s: r.sha256s,
    part_rows: r.part_rows,
    run_started: r.run_started,
    threads: r.threads,
  };
  store.insertImport(w.db, {
    id: r.id,
    run_id: r.run_id,
    dataset: r.dataset,
    prefix: r.prefix,
    counts: { expected: r.rows, imported: 0, skipped: 0, skip_reasons: {}, files_waiting: 0, rows_changed: 0 },
    job_id: jobId,
    at: w.at,
  });
  insertJob(w.db, { id: jobId, kind: 'import', payload, at: w.at });
  return { import_id: r.id };
}

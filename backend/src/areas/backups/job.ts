// The weekly backup (JOBS.md §4.4 `export.weekly`, DATA.md §11): every table Core backs up, in
// key order, 5,000 rows a part as `backups/<date>/<class>/<table>.<nnnn>.jsonl.gz` in the private
// bucket with its SHA-256, then the manifest, written last: until it exists the backup doesn't
// count. A step's load reads the rows and writes the part (outside any transaction; a retry
// writes the same key again), and its commit records the part in the cursor. Reads only, so it
// stays off the bulk lane.
import {
  BACKUP_LIMITS,
  type BackupClass,
  type BackupManifest,
  type BackupTable,
} from '../../../../shared/contract/backups.ts';
import type { Db } from '../../objects/base';
import type { Writer } from '../../objects/commit';
import { musicObject } from '../../objects/music';
import { sha256 } from '../import/vault';
import { JobError, type JobHandler } from '../jobs/runner';
import { gzip, line, page } from './rows';
import * as store from './store';

export interface BackupPayload {
  backup_id: string;
  date: string;
  class: BackupClass;
  /** The tables to back up, in order (CORE_TABLES with `backup: true`, read when it started). */
  tables: string[];
  schema_version: number;
  bookmark: string | null;
  started_at: number;
}

type Cursor =
  | { phase: 'rows'; t: number; after: unknown[] | null; part: number; done: BackupTable[] }
  | { phase: 'manifest'; done: BackupTable[] };
type Input =
  | { part: BackupTable['parts'][number] | null; full: boolean; last: unknown[] | null }
  | { manifest: string; at: number };

export const backupPrefix = (date: string, cls: BackupClass) => `backups/${date}/${cls}/`;
export const manifestKey = (date: string, cls: BackupClass) => `${backupPrefix(date, cls)}manifest.json`;
const partKey = (date: string, cls: BackupClass, table: string, n: number) =>
  `${backupPrefix(date, cls)}${table}.${String(n).padStart(4, '0')}.jsonl.gz`;

export const vaultOf = (env: Env): R2Bucket => {
  const v = (env as { VAULT?: R2Bucket }).VAULT;
  if (!v) throw new JobError('not_configured');
  return v;
};

const START: Cursor = { phase: 'rows', t: 0, after: null, part: 0, done: [] };
const totals = (done: BackupTable[]) =>
  done.reduce(
    (a, t) => ({
      rows: a.rows + t.rows,
      bytes: a.bytes + t.parts.reduce((n, p) => n + p.bytes, 0),
      parts: a.parts + t.parts.length,
    }),
    { rows: 0, bytes: 0, parts: 0 },
  );

export const backupJob: JobHandler = {
  kind: 'export.weekly',
  lane: false,
  async load(env: Env, db: Db, payload: unknown, cursor: unknown): Promise<Input> {
    const p = payload as BackupPayload;
    const c = (cursor as Cursor | null) ?? START;
    const vault = vaultOf(env);
    if (c.phase === 'manifest') {
      const at = Date.now();
      const manifest: BackupManifest = {
        v: 1,
        date: p.date,
        class: p.class,
        schema_version: p.schema_version,
        bookmark: p.bookmark,
        started_at: p.started_at,
        finished_at: at,
        tables: c.done,
      };
      const key = manifestKey(p.date, p.class);
      await vault.put(key, JSON.stringify(manifest), { httpMetadata: { contentType: 'application/json' } });
      return { manifest: key, at };
    }
    const table = p.tables[c.t];
    // The Music object's rows come by RPC (its own key order); Core's are read here.
    const { rows, last } =
      p.class === 'music'
        ? ((await musicObject(env).page(table, c.after, BACKUP_LIMITS.part_rows)) as unknown as ReturnType<typeof page>)
        : page(db, table, c.after, BACKUP_LIMITS.part_rows);
    if (!rows.length) return { part: null, full: false, last: null };
    const bytes = await gzip(`${rows.map(line).join('\n')}\n`);
    const sha = await sha256(bytes);
    const key = partKey(p.date, p.class, table, c.part + 1);
    await vault.put(key, bytes, {
      sha256: sha,
      httpMetadata: { contentType: 'application/gzip' },
      customMetadata: { sha256: sha, rows: String(rows.length) },
    });
    return {
      part: { key, rows: rows.length, bytes: bytes.byteLength, sha256: sha },
      full: rows.length === BACKUP_LIMITS.part_rows,
      last,
    };
  },
  step(w: Writer, payload: unknown, cursor: unknown, input: unknown) {
    const p = payload as BackupPayload;
    const c = (cursor as Cursor | null) ?? START;
    const i = input as Input;
    if ('manifest' in i) {
      const t = totals(c.done);
      store.progressBackup(w.db, p.backup_id, t.rows, t.bytes, t.parts);
      store.finishBackup(w.db, p.backup_id, i.at, i.manifest);
      w.ledger({
        kind: 'note',
        actor: 'worker',
        what: `weekly ${p.class === 'music' ? 'music ' : ''}backup ${p.date} done: ${t.rows} rows of ${c.done.length} tables in ${t.parts} parts`,
        why: 'the weekly backup (DATA.md §11)',
        ref: `backup:${p.backup_id}`,
        undoable: false,
      });
      return { done: true as const };
    }
    if (c.phase !== 'rows') return { done: true as const };
    const name = p.tables[c.t];
    const done = [...c.done];
    let table = done.at(-1)?.name === name ? (done.pop() as BackupTable) : { name, rows: 0, parts: [] };
    if (i.part) table = { name, rows: table.rows + i.part.rows, parts: [...table.parts, i.part] };
    done.push(table);
    const t = totals(done);
    store.progressBackup(w.db, p.backup_id, t.rows, t.bytes, t.parts);
    if (i.full) return { next: { phase: 'rows', t: c.t, after: i.last, part: c.part + 1, done } satisfies Cursor };
    if (c.t + 1 < p.tables.length)
      return { next: { phase: 'rows', t: c.t + 1, after: null, part: 0, done } satisfies Cursor };
    return { next: { phase: 'manifest', done } satisfies Cursor };
  },
  failed(w: Writer, payload: unknown) {
    store.failBackup(w.db, (payload as BackupPayload).backup_id, w.at);
  },
};

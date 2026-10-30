// "Download everything" (MENU-AND-SETTINGS.md §4.9, JOBS.md §4.4): every table DATA.md §10 marks
// for export, 5,000 rows a file (`tables/<table>.jsonl`, then `<table>-2.jsonl`…), each deflated
// into `exports/<id>/<n>.bin` in the private bucket with its CRC-32 and sizes, then a README and a
// list of what is in it. The download (routes.ts) streams those parts as one ZIP for an hour. The
// other objects' tables come by RPC as `<class>.<table>` (Music and the senses' rollups from P5,
// Study's library from P7).
// Reads only, so it stays off the bulk lane.
import { BACKUP_LIMITS } from '../../../../shared/contract/backups.ts';
import { MINUTE } from '../../lib/time';
import type { Db } from '../../objects/base';
import type { Writer } from '../../objects/commit';
import type { JobHandler } from '../jobs/runner';
import { vaultOf } from './job';
import { pageOf, splitName } from './objects';
import { line, page } from './rows';
import * as store from './store';
import { crc32, deflate } from './zip';

export interface ExportPayload {
  export_id: string;
  date: string;
  tables: string[];
}

type Cursor = {
  t: number;
  after: unknown[] | null;
  n: number;
  files: store.ExportFile[];
  counts: Record<string, number>;
};
type Input =
  | { file: store.ExportFile | null; rows: number; full: boolean; last: unknown[] | null }
  | { files: store.ExportFile[] };

const START: Cursor = { t: 0, after: null, n: 0, files: [], counts: {} };
const enc = new TextEncoder();
export const exportPrefix = (id: string) => `exports/${id}/`;

async function put(vault: R2Bucket, id: string, n: number, name: string, text: string): Promise<store.ExportFile> {
  const raw = enc.encode(text);
  const body = await deflate(raw);
  const key = `${exportPrefix(id)}${String(n).padStart(4, '0')}.bin`;
  await vault.put(key, body, { httpMetadata: { contentType: 'application/octet-stream' } });
  return { name, key, crc: crc32(raw), size: raw.length, csize: body.byteLength };
}

const readme = (p: ExportPayload, counts: Record<string, number>) =>
  [
    `# Thunderhead export, ${p.date}`,
    '',
    'Everything the Thunderhead keeps about you that DATA.md marks for export: your conversations,',
    'what it remembers, day notes, loose ends, the ledger of what it did, decisions, your music',
    "library's catalog (`music.*`; the audio itself stays in your music bucket), the daily counts of",
    "what you did (`senses.rollups`; each day's events are archived in your private bucket), and",
    "your books' records, pages, highlights and reading places (`library.*`; the PDFs stay in your",
    'private bucket).',
    '',
    'Each table is in `tables/` as JSON Lines: one JSON object a line, one line a row, with the',
    "table's own column names. A big table continues in `<table>-2.jsonl`, `<table>-3.jsonl` and so on.",
    'Times are milliseconds since 1970 (UTC). A column ending in `_json` holds JSON as text.',
    'Binary values, if any, are written as {"$bytes": "<base64>"}.',
    '',
    'Not in it: sign-in data (your password hash, sessions and keys), search indexes (rebuilt from the',
    'rows), and working state (jobs, leases). Attachments are not stored yet, so there are none.',
    '',
    '## Rows',
    '',
    ...Object.entries(counts).map(([t, n]) => `- ${t}: ${n}`),
    '',
  ].join('\n');

export const exportJob: JobHandler = {
  kind: 'export.download',
  lane: false,
  maxAttempts: 4,
  async load(env: Env, db: Db, payload: unknown, cursor: unknown): Promise<Input> {
    const p = payload as ExportPayload;
    const c = (cursor as Cursor | null) ?? START;
    const vault = vaultOf(env);
    if (c.t >= p.tables.length) {
      const n = c.files.length;
      const files = [
        await put(vault, p.export_id, n + 1, 'README.md', readme(p, c.counts)),
        await put(
          vault,
          p.export_id,
          n + 2,
          'export.json',
          JSON.stringify({ v: 1, date: p.date, tables: c.counts }, null, 2),
        ),
      ];
      return { files };
    }
    const table = p.tables[c.t];
    const other = splitName(table);
    const { rows, last } = other
      ? await pageOf(env, other.cls, other.table, c.after, BACKUP_LIMITS.part_rows)
      : page(db, table, c.after, BACKUP_LIMITS.part_rows);
    if (!rows.length && c.n > 0) return { file: null, rows: 0, full: false, last: null };
    const name = `tables/${table}${c.n ? `-${c.n + 1}` : ''}.jsonl`;
    const text = rows.length ? `${rows.map(line).join('\n')}\n` : '';
    const file = await put(vault, p.export_id, c.files.length + 1, name, text);
    return { file, rows: rows.length, full: rows.length === BACKUP_LIMITS.part_rows, last };
  },
  step(w: Writer, payload: unknown, cursor: unknown, input: unknown) {
    const p = payload as ExportPayload;
    const c = (cursor as Cursor | null) ?? START;
    const i = input as Input;
    if ('files' in i) {
      const files = [...c.files, ...i.files];
      const bytes = files.reduce((n, f) => n + f.csize, 0);
      store.readyExport(w.db, p.export_id, w.at, BACKUP_LIMITS.export_ttl_min * MINUTE, bytes, files);
      return { done: true as const };
    }
    const table = p.tables[c.t];
    const files = i.file ? [...c.files, i.file] : c.files;
    const counts = { ...c.counts, [table]: (c.counts[table] ?? 0) + i.rows };
    const next: Cursor = i.full
      ? { t: c.t, after: i.last, n: c.n + 1, files, counts }
      : { t: c.t + 1, after: null, n: 0, files, counts };
    store.progressExport(w.db, p.export_id, Math.min(95, Math.round((next.t / p.tables.length) * 95)), files);
    return { next };
  },
  failed(w: Writer, payload: unknown) {
    store.failExport(w.db, (payload as ExportPayload).export_id);
  },
};

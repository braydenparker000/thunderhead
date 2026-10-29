// The monthly restore drill (OPERATIONS.md §4.4, JOBS.md §4.4 `drill.monthly`): the latest complete
// Core backup goes into the scratch instance `drill-<YYYYMM>`, a part a step, each part's SHA-256
// checked against the manifest before a row of it is used. A table over 30,000 rows is restored
// as every k-th row (the sample), its full count still read from the manifest. Then the counts
// are compared, the report goes to `drills/<YYYY-MM>/report.json` (counts and names only), and
// the scratch instance is emptied. The rows it writes are in the scratch instance, so each step
// tells the lane how many. A mismatch fails the drill, never the job: the report says what.
import {
  BACKUP_LIMITS,
  type BackupManifest,
  type DrillReport,
  type DrillTable,
} from '../../../../shared/contract/backups.ts';
import type { Db } from '../../objects/base';
import type { Writer } from '../../objects/commit';
import { sha256 } from '../import/vault';
import type { JobHandler } from '../jobs/runner';
import { vaultOf } from './job';
import { gunzip, parse, type Row } from './rows';
import * as store from './store';

export interface DrillPayload {
  month: string;
  instance: string;
  backup_date: string;
  manifest: BackupManifest;
}

/** What the drill calls on its scratch instance (Core's drill methods, which refuse anywhere else). */
export interface DrillTarget {
  drillReset(): Promise<void>;
  drillPut(table: string, rows: Row[]): Promise<number>;
  drillCounts(tables: string[]): Promise<Record<string, number>>;
  drillEmpty(): Promise<void>;
}

type Cursor =
  | { phase: 'reset' }
  | { phase: 'rows'; t: number; part: number; bad: string[] }
  | { phase: 'check'; bad: string[] };
type Input = { written: number; bad?: string } | { report: DrillReport; key: string };

export const drillInstance = (month: string) => `drill-${month.replace('-', '')}`;
export const reportKey = (month: string) => `drills/${month}/report.json`;

/** Every k-th row is kept above 30,000 rows, so at most 30,000 are written. */
export const sampleEvery = (rows: number) =>
  rows > BACKUP_LIMITS.drill_sample_over ? Math.ceil(rows / BACKUP_LIMITS.drill_sample_over) : 1;
/** The rows the drill should find after restoring a table of `rows` rows sampled every `k`. */
export const expectedRows = (rows: number) => {
  const k = sampleEvery(rows);
  return k === 1 ? rows : Math.ceil(rows / k);
};

const targetOf = (env: Env, instance: string) => env.CORE.get(env.CORE.idFromName(instance)) as unknown as DrillTarget;

/** The index (in the whole table) of the first row of part `n` (0-based): parts before it hold
 * 5,000 rows each (the manifest says so). */
const firstIndex = (p: DrillPayload, t: number, n: number) =>
  p.manifest.tables[t].parts.slice(0, n).reduce((a, x) => a + x.rows, 0);

export const drillJob: JobHandler = {
  kind: 'drill.monthly',
  lane: true,
  maxAttempts: 4,
  async load(env: Env, _db: Db, payload: unknown, cursor: unknown): Promise<Input> {
    const p = payload as DrillPayload;
    const c = (cursor as Cursor | null) ?? { phase: 'reset' };
    const target = targetOf(env, p.instance);
    if (c.phase === 'reset') {
      await target.drillReset();
      return { written: 0 };
    }
    if (c.phase === 'check') {
      const tables = p.manifest.tables.map((t) => t.name);
      const counts = await target.drillCounts(tables);
      const lines: DrillTable[] = p.manifest.tables.map((t) => ({
        name: t.name,
        rows: t.rows,
        expected: expectedRows(t.rows),
        restored: counts[t.name] ?? -1,
        sampled: sampleEvery(t.rows) > 1,
        parts_ok: !c.bad.some((b) => b.startsWith(`${t.name}.`)),
      }));
      const problems = [
        ...c.bad.map((b) => `part ${b}: its SHA-256 differs from the manifest's`),
        ...lines
          .filter((l) => l.restored !== l.expected)
          .map((l) => `${l.name}: ${l.restored} rows restored, ${l.expected} expected`),
      ];
      const report: DrillReport = {
        v: 1,
        month: p.month,
        backup_date: p.backup_date,
        started_at: 0,
        finished_at: Date.now(),
        passed: problems.length === 0,
        tables: lines,
        problems,
      };
      const key = reportKey(p.month);
      await vaultOf(env).put(key, JSON.stringify(report), { httpMetadata: { contentType: 'application/json' } });
      await target.drillEmpty();
      return { report, key };
    }
    const table = p.manifest.tables[c.t];
    const part = table.parts[c.part];
    const obj = await vaultOf(env).get(part.key);
    if (!obj) return { written: 0, bad: part.key.slice(part.key.lastIndexOf('/') + 1) };
    const bytes = await obj.arrayBuffer();
    if ((await sha256(bytes)) !== part.sha256)
      return { written: 0, bad: part.key.slice(part.key.lastIndexOf('/') + 1) };
    const k = sampleEvery(table.rows);
    const from = firstIndex(p, c.t, c.part);
    const rows = (await gunzip(bytes))
      .split('\n')
      .filter(Boolean)
      .map(parse)
      .filter((_r, i) => (from + i) % k === 0);
    return { written: await target.drillPut(table.name, rows) };
  },
  step(w: Writer, payload: unknown, cursor: unknown, input: unknown) {
    const p = payload as DrillPayload;
    const c = (cursor as Cursor | null) ?? { phase: 'reset' };
    const i = input as Input;
    if ('report' in i) {
      const r = { ...i.report, started_at: store.drill(w.db, p.month)?.started_at ?? 0 };
      store.finishDrill(w.db, p.month, r.passed, w.at, i.key, r.problems.length);
      w.ledger({
        kind: 'note',
        actor: 'worker',
        what: r.passed
          ? `restore drill ${p.month} passed: ${r.tables.length} tables of the ${p.backup_date} backup`
          : `restore drill ${p.month} failed: ${r.problems.length} problems (${r.problems.slice(0, 2).join('; ')})`.slice(
              0,
              400,
            ),
        why: 'the monthly restore drill (OPERATIONS.md §4.4)',
        ref: `drill:${p.month}`,
        undoable: false,
      });
      return { done: true as const };
    }
    const next = (bad: string[]): Cursor => {
      if (c.phase === 'reset') return firstPart(p, 0, bad);
      if (c.phase !== 'rows') return { phase: 'check', bad };
      const t = p.manifest.tables[c.t];
      if (c.part + 1 < t.parts.length) return { phase: 'rows', t: c.t, part: c.part + 1, bad };
      return firstPart(p, c.t + 1, bad);
    };
    const bad = c.phase === 'reset' ? [] : [...c.bad, ...('bad' in i && i.bad ? [i.bad] : [])];
    return { next: next(bad), rows: 'written' in i ? i.written : 0 };
  },
  failed(w: Writer, payload: unknown, code: string) {
    const p = payload as DrillPayload;
    store.finishDrill(w.db, p.month, false, w.at, null, 1);
    w.ledger({
      kind: 'note',
      actor: 'worker',
      what: `restore drill ${p.month} could not finish (${code})`,
      why: 'the monthly restore drill (OPERATIONS.md §4.4)',
      ref: `drill:${p.month}`,
      undoable: false,
    });
  },
};

/** The first table from `t` on that has a part; else the check. */
function firstPart(p: DrillPayload, t: number, bad: string[]): Cursor {
  for (let i = t; i < p.manifest.tables.length; i++)
    if (p.manifest.tables[i].parts.length) return { phase: 'rows', t: i, part: 0, bad };
  return { phase: 'check', bad };
}

// The monthly restore drill (OPERATIONS.md §4.4, JOBS.md §4.4 `drill.monthly`): the latest complete
// backup of each part (Core, Music, the senses, Study; never Auth) goes into that class's scratch
// instance `drill-<YYYYMM>`, a part a step, each part's SHA-256
// checked against the manifest before a row of it is used. A table over 30,000 rows is restored
// as every k-th row (the sample), its full count still read from the manifest. Then the counts
// are compared, the report goes to `drills/<YYYY-MM>/report.json` (counts and names only), and
// the scratch instance is emptied. The rows it writes are in the scratch instance, so each step
// tells the lane how many. A mismatch fails the drill, never the job: the report says what.
import {
  BACKUP_LIMITS,
  type BackupClass,
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
  /** Core's (the drill's own date), kept for a drill started before the other classes joined. */
  manifest: BackupManifest;
  /** Every class's newest complete backup, Core's first. */
  manifests?: BackupManifest[];
}

const manifestsOf = (p: DrillPayload) => p.manifests ?? [p.manifest];
/** A table's name in the report: Core's bare, the others' as `<class>.<table>`. */
const nameIn = (m: BackupManifest, table: string) => (m.class === 'core' ? table : `${m.class}.${table}`);

/** What the drill calls on its scratch instance (Core's drill methods, which refuse anywhere else). */
export interface DrillTarget {
  drillReset(): Promise<void>;
  drillPut(table: string, rows: Row[]): Promise<number>;
  drillCounts(tables: string[]): Promise<Record<string, number>>;
  drillEmpty(): Promise<void>;
}

type Cursor =
  | { phase: 'reset' }
  | { phase: 'rows'; m?: number; t: number; part: number; bad: string[] }
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

const targetOf = (env: Env, cls: BackupClass, instance: string) => {
  const ns = { core: env.CORE, music: env.MUSIC, senses: env.SENSES, library: env.LIBRARY }[cls];
  return ns.get(ns.idFromName(instance)) as unknown as DrillTarget;
};

/** The index (in the whole table) of the first row of part `n` (0-based): parts before it hold
 * 5,000 rows each (the manifest says so). */
const firstIndex = (m: BackupManifest, t: number, n: number) =>
  m.tables[t].parts.slice(0, n).reduce((a, x) => a + x.rows, 0);

export const drillJob: JobHandler = {
  kind: 'drill.monthly',
  lane: true,
  maxAttempts: 4,
  async load(env: Env, _db: Db, payload: unknown, cursor: unknown): Promise<Input> {
    const p = payload as DrillPayload;
    const c = (cursor as Cursor | null) ?? { phase: 'reset' };
    const ms = manifestsOf(p);
    if (c.phase === 'reset') {
      for (const m of ms) await targetOf(env, m.class, p.instance).drillReset();
      return { written: 0 };
    }
    if (c.phase === 'check') {
      const lines: DrillTable[] = [];
      for (const m of ms) {
        const counts = await targetOf(env, m.class, p.instance).drillCounts(m.tables.map((t) => t.name));
        for (const t of m.tables)
          lines.push({
            name: nameIn(m, t.name),
            rows: t.rows,
            expected: expectedRows(t.rows),
            restored: counts[t.name] ?? -1,
            sampled: sampleEvery(t.rows) > 1,
            parts_ok: !c.bad.some((b) => b.startsWith(`${nameIn(m, t.name)}.`)),
          });
      }
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
      for (const m of ms) await targetOf(env, m.class, p.instance).drillEmpty();
      return { report, key };
    }
    const m = ms[c.m ?? 0];
    const table = m.tables[c.t];
    const part = table.parts[c.part];
    const file = part.key.slice(part.key.lastIndexOf('/') + 1);
    const badName = m.class === 'core' ? file : `${m.class}.${file}`;
    const obj = await vaultOf(env).get(part.key);
    if (!obj) return { written: 0, bad: badName };
    const bytes = await obj.arrayBuffer();
    if ((await sha256(bytes)) !== part.sha256) return { written: 0, bad: badName };
    const k = sampleEvery(table.rows);
    const from = firstIndex(m, c.t, c.part);
    const rows = (await gunzip(bytes))
      .split('\n')
      .filter(Boolean)
      .map(parse)
      .filter((_r, i) => (from + i) % k === 0);
    return { written: await targetOf(env, m.class, p.instance).drillPut(table.name, rows) };
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
          ? `restore drill ${p.month} passed: ${r.tables.length} tables of ${manifestsOf(p)
              .map((m) => `${m.class} ${m.date}`)
              .join(', ')}`
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
      if (c.phase === 'reset') return firstPart(p, 0, 0, bad);
      if (c.phase !== 'rows') return { phase: 'check', bad };
      const m = c.m ?? 0;
      const t = manifestsOf(p)[m].tables[c.t];
      if (c.part + 1 < t.parts.length) return { phase: 'rows', m, t: c.t, part: c.part + 1, bad };
      return firstPart(p, m, c.t + 1, bad);
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

/** The first table from class `m`, table `t` on that has a part; else the check. */
function firstPart(p: DrillPayload, m: number, t: number, bad: string[]): Cursor {
  const ms = manifestsOf(p);
  for (let k = m; k < ms.length; k++)
    for (let i = k === m ? t : 0; i < ms[k].tables.length; i++)
      if (ms[k].tables[i].parts.length) return { phase: 'rows', m: k, t: i, part: 0, bad };
  return { phase: 'check', bad };
}

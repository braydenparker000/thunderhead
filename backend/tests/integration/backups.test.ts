// P4 stages E–F: the weekly backup (every backed-up table in parts of 5,000, the manifest written
// last, a step killed mid-way resumes to the same result), the CI round trip (every part restored
// into a fresh instance equals Core table for table, DATA.md §11.4), the monthly drill (passes,
// empties its instance; a part changed in the bucket fails it and trips `drill.failed`), the
// schedule (Sundays 02:30 local), `backup.stale` and deep health's last backup. "Download
// everything" is in export.test.ts.

import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import type { DeepHealthResponse, Page } from '../../../shared/contract/api';
import type {
  BackupItem,
  BackupManifest,
  BackupRunResponse,
  DrillReport,
  DrillRunResponse,
} from '../../../shared/contract/backups.ts';
import type { WatchdogsResponse } from '../../../shared/contract/watchdogs.ts';
import { drillJob } from '../../src/areas/backups/drill';
import { exportJob } from '../../src/areas/backups/export-job';
import { backupJob } from '../../src/areas/backups/job';
import { gunzip, keyOf, parse } from '../../src/areas/backups/rows';
import { importJob } from '../../src/areas/import/job';
import { MINUTE } from '../../src/lib/time';
import type { Core } from '../../src/objects/core';
import { CORE_TABLES } from '../../src/objects/core.migrations';
import { api, apiJson, core, coreSql, makeAgent } from '../helpers';
import { runJobsWith } from '../import-helpers';
import { ownerSays, type Principals, principals } from '../memory-helpers';

let p: Principals;
let I = '';
const REAL = {
  [backupJob.kind]: backupJob,
  [drillJob.kind]: drillJob,
  [exportJob.kind]: exportJob,
  [importJob.kind]: importJob,
};
const stub = () => core() as unknown as DurableObjectStub<Core>;
const alarm = () => runInDurableObject(stub(), (o: Core) => o.alarm());
const watch = (now = Date.now()) => runInDurableObject(stub(), (o: Core) => o.tick(now));
const BACKED = Object.entries(CORE_TABLES)
  .filter(([, t]) => t.backup)
  .map(([n]) => n);

async function until<T>(read: () => Promise<T>, done: (v: T) => boolean, rounds = 40): Promise<T> {
  for (let i = 0; i < rounds; i++) {
    const v = await read();
    if (done(v)) return v;
    await alarm();
  }
  throw new Error('did not finish');
}
const backups = async () => (await apiJson<Page<BackupItem>>('GET', '/v1/ops/backups', { token: p.D })).body.items;
const manifestOf = async (date: string) =>
  (await (await env.VAULT.get(`backups/${date}/core/manifest.json`))?.json()) as BackupManifest | undefined;

beforeAll(async () => {
  p = await principals();
  I = await makeAgent(p.D, 'ci');
  await ownerSays(p.D, 'A message that the backup keeps');
  // 12,000 ledger rows: three parts (5,000, 5,000, 2,000).
  await coreSql(
    `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 12000)
     INSERT INTO ledger (id, at, actor, kind, what, why, undoable, status, tainted)
     SELECT printf('l-bk-%05d', i), i, 'owner', 'note', 'row ' || i, 'a backup fixture', 0, 'done', 0 FROM n`,
  );
});

describe('the weekly backup', () => {
  let date = '';
  it('is started by night or ci only, writes every table in parts, and its manifest last', async () => {
    expect((await api('POST', '/v1/ops/backups/run', { token: p.D, body: {} })).status).toBe(403);
    expect((await api('POST', '/v1/ops/backups/run', { token: p.C, body: {} })).status).toBe(403);
    const r = await apiJson<BackupRunResponse>('POST', '/v1/ops/backups/run', { token: p.N, body: {} });
    expect(r.status).toBe(202);
    expect(r.body.job_ids).toHaveLength(1);
    // Asked again while it runs: the same job.
    expect((await apiJson<BackupRunResponse>('POST', '/v1/ops/backups/run', { token: I, body: {} })).body).toEqual(
      r.body,
    );
    const [first] = await backups();
    date = first.date;
    expect(first).toMatchObject({ class: 'core', complete: false });
    // A step killed mid-way: it retries from the stored cursor.
    let n = 0;
    const flaky = {
      ...REAL,
      [backupJob.kind]: {
        ...backupJob,
        step: (...a: Parameters<typeof backupJob.step>) => {
          if (++n === 3) throw new Error('killed');
          return backupJob.step(...a);
        },
      },
    };
    await runJobsWith(flaky);
    expect(await manifestOf(date)).toBeUndefined();
    for (let i = 0; i < 40 && !(await backups())[0].complete; i++) await runJobsWith(REAL, Date.now() + 10 * MINUTE);
    const [done] = await backups();
    expect(done.complete).toBe(true);
    const m = (await manifestOf(date)) as BackupManifest;
    expect(m).toMatchObject({ v: 1, date, class: 'core', schema_version: 18 });
    expect(m.tables.map((t) => t.name)).toEqual(BACKED);
    const ledger = m.tables.find((t) => t.name === 'ledger');
    const [{ n: ledgerRows }] = await coreSql<{ n: number }>('SELECT count(*) AS n FROM ledger');
    // The backup's own closing note came after it read the ledger.
    expect(ledgerRows - (ledger?.rows ?? 0)).toBe(1);
    expect(ledger?.parts.map((x) => x.rows)).toEqual([5_000, 5_000, (ledger?.rows ?? 0) - 10_000]);
    expect(done.rows).toBe(m.tables.reduce((a, t) => a + t.rows, 0));
    for (const t of m.tables)
      for (const part of t.parts) {
        const obj = await env.VAULT.get(part.key);
        const bytes = await (obj as R2ObjectBody).arrayBuffer();
        const d = await crypto.subtle.digest('SHA-256', bytes);
        expect(Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('')).toBe(part.sha256);
      }
    expect(m.tables.some((t) => t.name === 'jobs' || t.name.endsWith('_fts'))).toBe(false);
  });

  it('restores into a fresh instance equal to Core, table for table (the CI round trip)', async () => {
    const m = (await manifestOf(date)) as BackupManifest;
    const scratch = env.CORE.get(env.CORE.idFromName('drill-209901'));
    await scratch.drillReset();
    for (const t of m.tables)
      for (const part of t.parts) {
        const text = await gunzip(await ((await env.VAULT.get(part.key)) as R2ObjectBody).arrayBuffer());
        await scratch.drillPut(t.name, text.split('\n').filter(Boolean).map(parse));
      }
    const dump = (s: DurableObjectStub<Core>, table: string) =>
      runInDurableObject(s, (_o, state) => {
        const sql = state.storage.sql;
        const key = sql
          .exec('SELECT name FROM pragma_table_info(?) WHERE pk > 0 ORDER BY pk', table)
          .toArray()
          .map((r) => `"${r.name}"`);
        return sql.exec(`SELECT * FROM "${table}" ORDER BY ${key.length ? key.join(', ') : 'rowid'}`).toArray();
      });
    // The backup ran before these rows changed: compare what it saw (the ledger notes it wrote at
    // its end and the backups row itself came after).
    for (const t of m.tables) {
      if (t.name === 'ledger' || t.name === 'backups' || t.name === 'watchdogs') continue;
      expect(await dump(scratch as unknown as DurableObjectStub<Core>, t.name), t.name).toEqual(
        await dump(stub(), t.name),
      );
    }
    const ledger = await dump(scratch as unknown as DurableObjectStub<Core>, 'ledger');
    expect(ledger).toHaveLength(m.tables.find((t) => t.name === 'ledger')?.rows ?? -1);
    expect(await runInDurableObject(stub(), (o) => keyOf((o as unknown as { db: never }).db, 'ledger'))).toEqual([
      'seq',
    ]);
    await scratch.drillEmpty();
    // Every drill method refuses on any instance but a drill's.
    await runInDurableObject(stub(), async (o: Core) => {
      await expect(o.drillReset()).rejects.toThrow('only a drill instance');
      await expect(o.drillPut('ledger', [])).rejects.toThrow('only a drill instance');
    });
  });

  it('shows in deep health and in the list; the newest one counts for backup.stale', async () => {
    const h = await apiJson<DeepHealthResponse>('GET', '/v1/ops/health/deep', { token: I });
    expect(h.body.last_backup).toEqual({ date, age_h: 0 });
    expect(h.body.ok).toBe(true);
    await watch();
    const state = async () =>
      (await apiJson<WatchdogsResponse>('GET', '/v1/ops/watchdogs', { token: p.D })).body.items.find(
        (i) => i.name === 'backup.stale',
      )?.state;
    expect(await state()).toBe('ok');
    await coreSql("UPDATE backups SET finished_at = finished_at - 9 * 86400000 WHERE state = 'complete'");
    await watch();
    expect(await state()).toBe('tripped');
    expect((await apiJson<DeepHealthResponse>('GET', '/v1/ops/health/deep', { token: I })).body.ok).toBe(false);
    await coreSql("UPDATE backups SET finished_at = finished_at + 9 * 86400000 WHERE state = 'complete'");
    await watch();
    expect(await state()).toBe('ok');
  });

  it('starts on its own on Sundays from 02:30 local, once', async () => {
    const sunday = Date.parse('2026-11-01T02:20:00Z'); // the test owner's zone is UTC
    await watch(sunday);
    expect((await backups()).some((b) => b.date === '2026-11-01')).toBe(false);
    await watch(sunday + 15 * MINUTE);
    expect((await backups()).filter((b) => b.date === '2026-11-01')).toHaveLength(1);
    for (let i = 0; i < 40 && !(await backups()).find((x) => x.date === '2026-11-01')?.complete; i++)
      await runJobsWith(REAL, sunday + 20 * MINUTE);
    expect((await backups()).find((x) => x.date === '2026-11-01')?.complete).toBe(true);
    await watch(sunday + 30 * MINUTE);
    expect((await backups()).filter((b) => b.date === '2026-11-01')).toHaveLength(1);
  });
});

describe('the monthly drill', () => {
  type DrillRow = { state: string; month: string; report_key: string | null };
  const drillRow = (job: string) => async () =>
    (await coreSql<DrillRow>('SELECT * FROM drills WHERE job_id = ?', job))[0];
  // Each drill writes its rows into the scratch instance against the day's bulk lane (40,000):
  // these fixtures' 12,000 ledger rows and their indexes would pause the second until tomorrow.
  const freshLane = () => coreSql("DELETE FROM settings WHERE key = 'bulk.day'");
  it('restores the newest backup into its own instance, checks it, reports, and empties it', async () => {
    expect((await api('POST', '/v1/ops/drill/run', { token: p.D, body: {} })).status).toBe(403);
    await freshLane();
    const r = await apiJson<DrillRunResponse>('POST', '/v1/ops/drill/run', { token: p.N, body: {} });
    expect(r.status).toBe(202);
    const row = await until(drillRow(r.body.job_id), (d) => d?.state !== 'running');
    expect(row.state).toBe('passed');
    const report = (await (await env.VAULT.get(row.report_key as string))?.json()) as DrillReport;
    expect(report.passed).toBe(true);
    expect(report.problems).toEqual([]);
    expect(report.tables.find((t) => t.name === 'ledger')).toMatchObject({
      restored: report.tables.find((t) => t.name === 'ledger')?.rows,
      parts_ok: true,
      sampled: false,
    });
    const scratch = env.CORE.get(env.CORE.idFromName(`drill-${row.month.replace('-', '')}`));
    const left = await runInDurableObject(scratch as unknown as DurableObjectStub<Core>, (_o, s) =>
      s.storage.sql.exec("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'").one(),
    );
    expect(left).toEqual({ n: 0 });
  });

  it('fails on a part whose bytes changed, and drill.failed trips', async () => {
    const [b] = (await backups()).filter((x) => x.complete);
    const m = (await manifestOf(b.date)) as BackupManifest;
    const part = (m.tables.find((t) => t.name === 'ledger') as BackupManifest['tables'][number]).parts[1];
    await env.VAULT.put(part.key, new Uint8Array([31, 139, 8, 0, 0, 0, 0, 0, 0, 3, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
    await freshLane();
    const r = await apiJson<DrillRunResponse>('POST', '/v1/ops/drill/run', { token: I, body: {} });
    const row = await until(drillRow(r.body.job_id), (d) => d?.state !== 'running');
    expect(row.state).toBe('failed');
    const report = (await (await env.VAULT.get(row.report_key as string))?.json()) as DrillReport;
    expect(report.problems[0]).toMatch(/^part ledger\.0002\.jsonl\.gz: its SHA-256 differs/);
    expect(report.tables.find((t) => t.name === 'ledger')?.parts_ok).toBe(false);
    await watch();
    const items = (await apiJson<WatchdogsResponse>('GET', '/v1/ops/watchdogs', { token: p.D })).body.items;
    expect(items.find((i) => i.name === 'drill.failed')).toMatchObject({ state: 'tripped' });
    const notes = await coreSql<{ what: string }>("SELECT what FROM ledger WHERE ref LIKE 'drill:%' ORDER BY at");
    expect(notes.map((n) => n.what.split(':')[0])).toEqual([
      `restore drill ${row.month} passed`,
      `restore drill ${row.month} failed`,
    ]);
  });
});

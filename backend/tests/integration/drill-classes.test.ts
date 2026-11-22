// The monthly drill covers all four parts (OPERATIONS.md §4.4): Core's backup and Music's, the
// senses' and Study's newest complete ones, each restored into its own class's scratch instance
// `drill-<YYYYMM>` (emptied after), never Auth; the report names the others' tables as
// `<class>.<table>` and deep health shows the last drill and the parts it covered.
import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import type { DeepHealthResponse } from '../../../shared/contract/api';
import type { BackupItem, DrillReport, DrillRunResponse } from '../../../shared/contract/backups.ts';
import type { Core } from '../../src/objects/core';
import { api, apiJson, core, coreSql } from '../helpers';
import { ownerSays, type Principals, principals } from '../memory-helpers';

let p: Principals;
const alarm = () => runInDurableObject(core() as unknown as DurableObjectStub<Core>, (o: Core) => o.alarm());
const TABLES = "SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'";

async function until(done: () => Promise<boolean>): Promise<void> {
  for (let i = 0; i < 60 && !(await done()); i++) await alarm();
}

beforeAll(async () => {
  p = await principals();
  await ownerSays(p.D, 'A message the drill restores');
  await api('POST', '/v1/ops/backups/run', { token: p.N, body: {} });
  await until(async () =>
    (await apiJson<{ items: BackupItem[] }>('GET', '/v1/ops/backups', { token: p.D })).body.items.every(
      (b) => b.complete,
    ),
  );
});

describe('the drill of all four parts', () => {
  it('restores each part into its own scratch instance, checks it, and empties it', async () => {
    const r = await apiJson<DrillRunResponse>('POST', '/v1/ops/drill/run', { token: p.N, body: {} });
    expect(r.status).toBe(202);
    const row = async () =>
      (await coreSql<{ state: string; month: string; report_key: string }>('SELECT * FROM drills'))[0];
    await until(async () => (await row())?.state !== 'running');
    const d = await row();
    expect(d.state).toBe('passed');
    const report = (await (await env.VAULT.get(d.report_key))?.json()) as DrillReport;
    expect(report.problems).toEqual([]);
    expect(report.tables.some((t) => t.name.startsWith('auth.'))).toBe(false);
    expect(report.tables.some((t) => !t.name.includes('.'))).toBe(true);
    const instance = `drill-${d.month.replace('-', '')}`;
    for (const [cls, ns] of [
      ['core', env.CORE],
      ['music', env.MUSIC],
      ['senses', env.SENSES],
      ['library', env.LIBRARY],
    ] as const) {
      if (cls !== 'core') expect(report.tables.some((t) => t.name.startsWith(`${cls}.`))).toBe(true);
      const o = ns.get(ns.idFromName(instance)) as unknown as DurableObjectStub<Core>;
      expect(await runInDurableObject(o, (_o, s) => s.storage.sql.exec(TABLES).one())).toEqual({ n: 0 });
    }
    const deep = (await apiJson<DeepHealthResponse>('GET', '/v1/ops/health/deep', { token: p.D })).body;
    expect(deep.backups?.drill).toEqual({
      month: d.month,
      state: 'passed',
      problems: 0,
      classes: ['core', 'music', 'senses', 'library'],
    });
  });

  it('the drill methods refuse on any instance but a drill scratch, and on Auth', async () => {
    for (const ns of [env.MUSIC, env.SENSES, env.LIBRARY]) {
      const o = ns.get(ns.idFromName('owner-like')) as unknown as DurableObjectStub<Core>;
      await runInDurableObject(o, async (x: Core) => {
        await expect(x.drillReset()).rejects.toThrow('only a scratch instance');
      });
    }
    const a = env.AUTH.get(env.AUTH.idFromName('drill-209901')) as unknown as DurableObjectStub<Core>;
    await runInDurableObject(a, async (x: Core) => {
      await expect(x.drillReset()).rejects.toThrow('sign-in data is never restored');
      await expect(x.pitrProofArm()).rejects.toThrow('sign-in data is never restored');
    });
  });

  it('nothing can arm or restart a restore on a real object: the check refuses all but `pitr-proof`', async () => {
    for (const [ns, name] of [
      [env.CORE, 'owner'],
      [env.MUSIC, 'owner'],
      [env.SENSES, 'drill-209901'],
      [env.LIBRARY, 'owner'],
    ] as const) {
      const o = ns.get(ns.idFromName(name)) as unknown as DurableObjectStub<Core>;
      await runInDurableObject(o, async (x: Core) => {
        await expect(x.pitrProofArm()).rejects.toThrow('only a scratch instance');
        expect(() => x.pitrProofCheck()).toThrow('only a scratch instance');
        expect(() => x.pitrProofRestart()).toThrow('only a scratch instance');
        const methods = x as unknown as Record<string, unknown>;
        for (const m of ['pitrArm', 'pitrBookmark', 'pitrRestart', 'restoreStart', 'restoreUndo'])
          expect(methods[m]).toBeUndefined();
      });
    }
  });
});

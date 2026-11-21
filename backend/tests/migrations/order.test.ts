// DATA.md §9: a schema step merged after a higher one still runs. Step 41 is applied, then step 40
// arrives (a branch merged out of order): 40 runs, once, in its own transaction, and until it has
// run the class's health lists it as missing. Synthetic steps on a Senses object of its own.
import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { applyMigrations, Db, Meter, type Migration, missingVersions } from '../../src/objects/base';
import { SENSES_MIGRATIONS, type Senses } from '../../src/objects/senses';

const BASE = SENSES_MIGRATIONS.map((m) => m.version);
const step = (version: number): Migration => ({
  version,
  name: `step_${version}`,
  kind: 'expand',
  sql: [`CREATE TABLE step_${version} (id INTEGER PRIMARY KEY)`],
});

describe('schema steps out of order', () => {
  it('runs a step numbered below one already applied, and health lists it until then', async () => {
    const stub = env.SENSES.getByName('order-test') as unknown as DurableObjectStub<Senses>;
    expect((await stub.health()).missing).toEqual([]);
    await runInDurableObject(stub, async (_o, state) => {
      const db = new Db(state.storage.sql, new Meter());
      const versions = () =>
        state.storage.sql
          .exec('SELECT version FROM _migrations ORDER BY version')
          .toArray()
          .map((r) => r.version);
      expect(await applyMigrations(state.storage, db, [...SENSES_MIGRATIONS, step(41)])).toBe(41);
      const later = [...SENSES_MIGRATIONS, step(41), step(40)];
      expect(missingVersions(db, later)).toEqual([40]);
      expect(await applyMigrations(state.storage, db, later)).toBe(41);
      expect(versions()).toEqual([...BASE, 40, 41]);
      expect(state.storage.sql.exec("SELECT name FROM sqlite_master WHERE name = 'step_40'").toArray()).toHaveLength(1);
      expect(missingVersions(db, later)).toEqual([]);
      // Again: nothing runs twice.
      expect(await applyMigrations(state.storage, db, later)).toBe(41);
      expect(versions()).toEqual([...BASE, 40, 41]);
    });
  });
});

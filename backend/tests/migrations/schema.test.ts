// TESTING.md §7: from an empty object, every step gives exactly the committed schema snapshot,
// and the steps ran once each with their kind and a PITR bookmark. Any schema change updates
// the snapshot in the same commit.
import { runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { latestOf } from '../../../scripts/schema-version.mjs';
import type { Auth } from '../../src/objects/auth';
import { AUTH_MIGRATIONS } from '../../src/objects/auth.migrations';
import { CORE_MIGRATIONS } from '../../src/objects/core.migrations';
import { auth, core } from '../helpers';
import authSchema from './auth.schema.sql?raw';
import coreSchema from './core.schema.sql?raw';

type Stub = DurableObjectStub<Auth>;

/** sqlite_schema, normalised: our objects only, one statement per block, sorted by name. */
const schemaOf = (stub: Stub) =>
  runInDurableObject(stub, (_o, state) =>
    state.storage.sql
      .exec(
        "SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' ORDER BY name",
      )
      .toArray()
      .map((r) => `${String(r.sql).replace(/\n\s+/g, '\n  ')};`)
      .join('\n\n'),
  );

describe('schema snapshots', () => {
  it.each([
    ['auth', auth as () => Stub, authSchema],
    ['core', core as unknown as () => Stub, coreSchema],
  ])('%s: empty → current equals the snapshot', async (name, stub, snapshot) => {
    const got = await schemaOf(stub());
    if (got.trim() !== snapshot.trim()) console.log(`--- ${name}.schema.sql ---\n${got}\n--- end ---`);
    expect(got.trim()).toBe(snapshot.trim());
    const steps = await runInDurableObject(stub(), (_o, s) =>
      s.storage.sql.exec('SELECT version, kind, bookmark FROM _migrations').toArray(),
    );
    const expected = name === 'core' ? CORE_MIGRATIONS : AUTH_MIGRATIONS;
    expect(steps).toEqual(expected.map((m) => ({ version: m.version, kind: 'expand', bookmark: expect.any(String) })));
  });
});

describe('the deploy check knows the newest step', () => {
  // scripts/schema-version.mjs reads the migration files; the smoke check waits for its number.
  const raw = (files: Record<string, unknown>) => Object.values(files) as string[];
  it('core and auth: the script finds the highest version of the real lists', () => {
    const core = import.meta.glob(['../../src/objects/core.migrations.ts', '../../src/areas/*/migrations.ts'], {
      query: '?raw',
      import: 'default',
      eager: true,
    });
    const auth = import.meta.glob('../../src/objects/auth.migrations.ts', {
      query: '?raw',
      import: 'default',
      eager: true,
    });
    expect(latestOf(raw(core))).toBe(Math.max(...CORE_MIGRATIONS.map((m) => m.version)));
    expect(latestOf(raw(auth))).toBe(Math.max(...AUTH_MIGRATIONS.map((m) => m.version)));
  });
});

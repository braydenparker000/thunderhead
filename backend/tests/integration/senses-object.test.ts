// P5: the Senses object exists on its own (DATA.md §6.1): it migrates to its schema once, reports
// its health like the other objects, and holds its four tables, empty, with the one events index.

import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { Senses } from '../../src/objects/senses';

const senses = () => env.SENSES.get(env.SENSES.idFromName('owner')) as unknown as DurableObjectStub<Senses>;

describe('the Senses object', () => {
  it('migrates once to its schema and reports its health', async () => {
    expect(await senses().health()).toMatchObject({ schema: 1, expected: 1 });
    const names = (type: string) =>
      runInDurableObject(senses(), (_o, state) =>
        state.storage.sql
          .exec(
            "SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE '\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite_%' ORDER BY name",
            type,
          )
          .toArray()
          .map((r) => r.name),
      );
    expect(await names('table')).toEqual(['batches', 'events', 'exports', 'rollups']);
    expect(await names('index')).toEqual(['events_day_type']);
  });
});

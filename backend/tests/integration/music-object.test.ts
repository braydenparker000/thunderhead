// P5 step 1: the Music object exists on its own (MUSIC.md §1.2): it migrates to its schema once,
// reports its health like the other objects, and holds the catalog's three tables, empty.

import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { Music } from '../../src/objects/music';

const music = () => env.MUSIC.get(env.MUSIC.idFromName('library')) as unknown as DurableObjectStub<Music>;

describe('the Music object', () => {
  it('migrates once to its schema and reports its health', async () => {
    const h = await music().health();
    expect(h).toMatchObject({ schema: 1, expected: 1 });
    const tables = await runInDurableObject(music(), (_o, state) =>
      state.storage.sql
        .exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_%' ESCAPE '\\' ORDER BY name")
        .toArray()
        .map((r) => r.name),
    );
    expect(tables).toEqual(['catalog_log', 'music_state', 'tracks']);
    expect(
      await runInDurableObject(music(), (_o, state) =>
        state.storage.sql.exec('SELECT count(*) AS n FROM tracks').one(),
      ),
    ).toEqual({ n: 0 });
  });
});

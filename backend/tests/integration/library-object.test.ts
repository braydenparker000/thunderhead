// P7 step 1: the Library object exists on its own (STUDY.md §1.1, DATA.md §6.3): it migrates to its
// schema once, reports its health like the other objects, and holds its tables, empty, with the
// pages' full-text index kept as an external-content FTS5 table over `pages`.

import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { Library } from '../../src/objects/library';

const library = () => env.LIBRARY.get(env.LIBRARY.idFromName('owner')) as unknown as DurableObjectStub<Library>;

describe('the Library object', () => {
  it('migrates once to its schema and reports its health', async () => {
    expect(await library().health()).toMatchObject({ schema: 1, expected: 1 });
    const names = (type: string) =>
      runInDurableObject(library(), (_o, state) =>
        state.storage.sql
          .exec(
            "SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE '\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'pages_fts_%' ORDER BY name",
            type,
          )
          .toArray()
          .map((r) => r.name),
      );
    expect(await names('table')).toEqual([
      'books',
      'highlights',
      'ingest_jobs',
      'pages',
      'pages_fts',
      'positions',
      'verse_refs',
    ]);
    expect(await names('index')).toEqual([
      'highlights_book',
      'highlights_deleted',
      'highlights_ref',
      'ingest_jobs_state',
      'verse_refs_chapter',
    ]);
  });

  it('the full-text index follows its pages, accents ignored', async () => {
    const hits = await runInDurableObject(library(), (_o, state) => {
      const sql = state.storage.sql;
      const seq = sql
        .exec(
          "INSERT INTO pages (book_id, pdf_page, text, blocks_json, chars) VALUES ('b1', 1, 'Une prière du matin', '[[0,19]]', 19) RETURNING seq",
        )
        .one().seq;
      sql.exec("INSERT INTO pages_fts (rowid, text) VALUES (?, 'Une prière du matin')", seq);
      const found = sql.exec("SELECT rowid FROM pages_fts WHERE pages_fts MATCH 'priere'").toArray().length;
      sql.exec("INSERT INTO pages_fts (pages_fts, rowid, text) VALUES ('delete', ?, 'Une prière du matin')", seq);
      sql.exec('DELETE FROM pages WHERE seq = ?', seq);
      return [found, sql.exec("SELECT rowid FROM pages_fts WHERE pages_fts MATCH 'priere'").toArray().length];
    });
    expect(hits).toEqual([1, 0]);
  });
});

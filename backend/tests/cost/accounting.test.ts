// How local workerd counts SQLite rows, pinned as facts the schema design relies on (WITHOUT
// ROWID tables, no spare indexes, no count(*) on growing tables, DROP over DELETE for bulk).
// If a workerd update changes the accounting, this fails first. Production billing may differ.
import { runInDurableObject } from 'cloudflare:test';
import { expect, it } from 'vitest';
import { core } from '../helpers';

it('counts rows the way the schema design assumes', async () => {
  const facts = await runInDurableObject(core(), (_o, state) => {
    const sql = state.storage.sql;
    const m = (q: string, ...b: unknown[]) => {
      const c = sql.exec(q, ...b);
      c.toArray();
      return `${c.rowsRead}r/${c.rowsWritten}w`;
    };
    m('CREATE TABLE t_rowid (k TEXT PRIMARY KEY, v INTEGER)');
    m('CREATE TABLE t_norowid (k TEXT PRIMARY KEY, v INTEGER) WITHOUT ROWID');
    m('CREATE TABLE t_int (id INTEGER PRIMARY KEY, v INTEGER)');
    m('CREATE TABLE t_indexed (k TEXT PRIMARY KEY, v INTEGER) WITHOUT ROWID');
    m('CREATE INDEX t_indexed_v ON t_indexed (v)');
    const out = {
      insert_text_pk_rowid_table: m("INSERT INTO t_rowid VALUES ('a', 1)"),
      insert_without_rowid: m("INSERT INTO t_norowid VALUES ('a', 1)"),
      insert_integer_pk: m('INSERT INTO t_int VALUES (1, 1)'),
      insert_with_one_more_index: m("INSERT INTO t_indexed VALUES ('b', 2)"),
      update_by_pk_indexed_column: m("UPDATE t_indexed SET v = 3 WHERE k = 'b'"),
      upsert_hitting_conflict: m("INSERT INTO t_norowid VALUES ('a', 9) ON CONFLICT (k) DO UPDATE SET v = excluded.v"),
      delete_missing_row: m("DELETE FROM t_norowid WHERE k = 'zz'"),
      lookup_missing_row: m("SELECT v FROM t_norowid WHERE k = 'zz'"),
      insert_100_rows: m(
        'INSERT INTO t_int (v) SELECT value FROM json_each(?)',
        JSON.stringify([...Array(100).keys()]),
      ),
      count_star_101_rows: m('SELECT count(*) FROM t_int'),
      drop_table_101_rows: m('DROP TABLE t_int'),
    };
    for (const t of ['t_rowid', 't_norowid', 't_indexed']) m(`DROP TABLE ${t}`);
    return out;
  });
  expect(facts).toEqual({
    insert_text_pk_rowid_table: '0r/2w', // table + its hidden PK index
    insert_without_rowid: '0r/1w',
    insert_integer_pk: '1r/1w', // INTEGER PRIMARY KEY is the rowid itself
    insert_with_one_more_index: '0r/2w', // every index entry is a billed write
    update_by_pk_indexed_column: '1r/2w',
    upsert_hitting_conflict: '0r/1w', // an update in place, no index to touch
    delete_missing_row: '0r/0w', // clearing an absent counter is free
    lookup_missing_row: '0r/0w',
    insert_100_rows: '100r/100w',
    count_star_101_rows: '101r/0w', // count(*) is a billed full scan
    // Dropping writes nothing (it reads a few schema rows); deleting 101 rows would be 101 writes.
    drop_table_101_rows: expect.stringMatching(/^\d{1,2}r\/0w$/),
  });
});

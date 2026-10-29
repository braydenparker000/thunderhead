// Reading and writing any Core table a page at a time, for backups, the drill and the export:
// rows in primary-key order (rowid when a table has none), read after the last key of the page
// before, so rows written or pruned between steps never shift a page. Values are JSON; a BLOB
// travels as {"$bytes": "<base64>"}. Table and column names come from the schema itself, never
// from a request, and are still checked before they are quoted into SQL.
import type { Db } from '../../objects/base';

export type Row = Record<string, unknown>;
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const q = (name: string) => {
  if (!IDENT.test(name)) throw new Error('bad identifier');
  return `"${name}"`;
};

/** The table's key columns in order; empty for a table keyed by rowid. */
export function keyOf(db: Db, table: string): string[] {
  return db
    .all<{ name: string; pk: number }>('SELECT name, pk FROM pragma_table_info(?) WHERE pk > 0 ORDER BY pk', table)
    .map((c) => c.name);
}

/** The table's columns. */
export const columnsOf = (db: Db, table: string): string[] =>
  db.all<{ name: string }>('SELECT name FROM pragma_table_info(?)', table).map((c) => c.name);

/** Up to `limit` rows after `after` (the last page's last key, null from the start), and the key
 * to read on from. */
export function page(
  db: Db,
  table: string,
  after: unknown[] | null,
  limit: number,
): { rows: Row[]; last: unknown[] | null } {
  const key = keyOf(db, table);
  const cols = key.length ? key : ['rowid'];
  const select = key.length ? '*' : 'rowid AS "$rowid", *';
  const order = cols.map(q).join(', ');
  const tuple = `(${order})`;
  const marks = `(${cols.map(() => '?').join(', ')})`;
  const where = after ? `WHERE ${tuple} > ${marks}` : '';
  const rows = db.all<Row>(
    `SELECT ${select} FROM ${q(table)} ${where} ORDER BY ${order} LIMIT ?`,
    ...(after ?? []),
    limit,
  );
  const tail = rows.at(-1);
  const last = tail ? (key.length ? key.map((k) => tail[k]) : [tail.$rowid]) : null;
  if (!key.length) for (const r of rows) delete r.$rowid;
  return { rows, last };
}

export const count = (db: Db, table: string): number =>
  db.one<{ n: number }>(`SELECT count(*) AS n FROM ${q(table)}`)?.n ?? 0;

const toB64 = (b: ArrayBuffer) => {
  let s = '';
  for (const x of new Uint8Array(b)) s += String.fromCharCode(x);
  return btoa(s);
};
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)).buffer;

/** One row as a JSON line. */
export const line = (r: Row): string =>
  JSON.stringify(r, (_k, v) => (v instanceof ArrayBuffer ? { $bytes: toB64(v) } : v));

/** A JSON line back to a row. */
export function parse(text: string): Row {
  return JSON.parse(text, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v) && typeof v.$bytes === 'string' && Object.keys(v).length === 1
      ? fromB64(v.$bytes)
      : v,
  ) as Row;
}

/** Puts rows into `table` by key (a row already there is replaced), only into columns the table
 * has; returns the rows written. */
export function putRows(db: Db, table: string, rows: Row[]): number {
  const have = new Set(columnsOf(db, table));
  let written = 0;
  for (const r of rows) {
    const cols = Object.keys(r).filter((c) => have.has(c));
    if (!cols.length) continue;
    written += db.run(
      `INSERT OR REPLACE INTO ${q(table)} (${cols.map(q).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      ...cols.map((c) => r[c] as SqlStorageValue),
    );
  }
  return written;
}

/** Bytes gzipped, and gzip bytes back to text. */
export async function gzip(text: string): Promise<ArrayBuffer> {
  return new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
}
export async function gunzip(bytes: ArrayBuffer): Promise<string> {
  return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
}

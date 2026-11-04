// The recall index's half in the Library object (MEMORY.md §10.6, DATA.md §6.3): one vector per
// indexed row (a message, a fact, a day note, a Study page), keyed by its ref, with the snippet its
// hit shows. The search area's indexer (areas/search/embed-job.ts) writes it a batch at a time and
// its recall reads it: brute-force cosine over unit vectors (a dot product), since the table is
// capped at a few thousand rows by design and at most 10,000 (the oldest go first). Study's pages
// come to the indexer from here, in `seq` order, ready books only.
import type { Db } from '../../objects/base';

/** The most rows the index keeps; past it the oldest (`at`) are dropped. */
export const EMBED_CAP = 10_000;
/** A vector's length: the small English embedding model's (areas/search/embed.ts). */
export const DIMS = 384;

export interface VectorIn {
  ref: string;
  source: string;
  vector: Float32Array;
  snippet: string;
  at: number;
  provenance: string | null;
}

export interface VectorHit {
  ref: string;
  source: string;
  snippet: string;
  at: number;
  provenance: string | null;
  score: number;
}

/** Writes (or replaces) each row's vector; returns rows written. */
export function putVectors(db: Db, rows: VectorIn[], now: number): number {
  let written = 0;
  for (const r of rows)
    written += db.run(
      `INSERT INTO embeddings (ref, source, vector, snippet, at, provenance, indexed_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (ref) DO UPDATE SET source = excluded.source, vector = excluded.vector, snippet = excluded.snippet,
         at = excluded.at, provenance = excluded.provenance, indexed_at = excluded.indexed_at`,
      r.ref,
      r.source,
      r.vector.buffer.slice(r.vector.byteOffset, r.vector.byteOffset + r.vector.byteLength),
      r.snippet,
      r.at,
      r.provenance,
      now,
    );
  return written;
}

/** Past the cap, the oldest rows go (once a run, at the sweep's end: the count reads every row). */
export function trim(db: Db): number {
  const n = db.one<{ n: number }>('SELECT count(*) AS n FROM embeddings')?.n ?? 0;
  if (n <= EMBED_CAP) return 0;
  return db.run('DELETE FROM embeddings WHERE ref IN (SELECT ref FROM embeddings ORDER BY at LIMIT ?)', n - EMBED_CAP);
}

const dot = (a: Float32Array, b: Float32Array) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

/** The `limit` nearest rows of `sources` to `query` (a unit vector), best first. Reads every row of
 * those sources once: the index is small by design. */
export function nearest(db: Db, query: Float32Array, sources: string[], limit: number): VectorHit[] {
  const rows = db.all<Omit<VectorHit, 'score'> & { vector: ArrayBuffer }>(
    `SELECT ref, source, vector, snippet, at, provenance FROM embeddings
     WHERE source IN (SELECT value FROM json_each(?))`,
    JSON.stringify(sources),
  );
  const hits: VectorHit[] = [];
  for (const { vector, ...r } of rows) {
    const v = new Float32Array(vector);
    if (v.length === query.length) hits.push({ ...r, score: dot(query, v) });
  }
  return hits.sort((a, b) => b.score - a.score || b.at - a.at).slice(0, limit);
}

/** A page of the index's refs in key order, for the indexer's sweep of rows gone from their source. */
export function refsAfter(db: Db, after: string, limit: number): string[] {
  return db
    .all<{ ref: string }>('SELECT ref FROM embeddings WHERE ref > ? ORDER BY ref LIMIT ?', after, limit)
    .map((r) => r.ref);
}

/** Drops these refs' rows; rows written. */
export function dropVectors(db: Db, refs: string[]): number {
  if (!refs.length) return 0;
  return db.run('DELETE FROM embeddings WHERE ref IN (SELECT value FROM json_each(?))', JSON.stringify(refs));
}

export interface PageToEmbed {
  seq: number;
  book_id: string;
  pdf_page: number;
  text: string;
  at: number;
}

/** Study's pages after `after` (seq), of ready books, for the indexer. A page of a book still being
 * read stops the page there (`next` stays before it), so it is indexed once its book is ready; a
 * failed or duplicate book's pages are passed over. */
export function pagesAfter(db: Db, after: number, limit: number): { pages: PageToEmbed[]; next: number } {
  const rows = db.all<PageToEmbed & { state: string }>(
    `SELECT p.seq, p.book_id, p.pdf_page, p.text, b.state, coalesce(b.ingested_at, b.updated_at) AS at
     FROM pages p JOIN books b ON b.id = p.book_id WHERE p.seq > ? ORDER BY p.seq LIMIT ?`,
    after,
    limit,
  );
  const pages: PageToEmbed[] = [];
  let next = after;
  for (const { state, ...p } of rows) {
    if (state !== 'ready' && state !== 'failed' && state !== 'duplicate') break;
    if (state === 'ready' && p.text.trim()) pages.push(p);
    next = p.seq;
  }
  return { pages, next };
}

/** Whether these pages are still in a ready book (a ref `book:<id>#p<n>`), for the recall. */
export function livePages(db: Db, refs: string[]): Set<string> {
  const keys = refs.flatMap((r) => {
    const m = /^book:([0-9a-f-]{36})#p(\d+)$/.exec(r);
    return m ? [[m[1], Number(m[2])]] : [];
  });
  if (!keys.length) return new Set();
  const rows = db.all<{ book_id: string; pdf_page: number }>(
    `SELECT p.book_id, p.pdf_page FROM json_each(?) AS k
     JOIN pages p ON p.book_id = json_extract(k.value, '$[0]') AND p.pdf_page = json_extract(k.value, '$[1]')
     JOIN books b ON b.id = p.book_id AND b.state = 'ready'`,
    JSON.stringify(keys),
  );
  return new Set(rows.map((r) => `book:${r.book_id}#p${r.pdf_page}`));
}

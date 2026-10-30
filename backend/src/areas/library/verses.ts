// "Cited in your books" for a verse (STUDY.md §7.5, §7.6): the blocks whose references name it or
// a range around it (a whole-chapter reference too), by weight, then the books opened most
// recently, then page; each with its book's title, the page's printed number and the block's
// first line (at most 140 characters, cut at a word). And the owner's highlights on that verse.
// One index seek on (book_code, chapter); the pages and books are read by key.
import type { CitedBlock, Highlight } from '../../../../shared/contract/library.ts';
import type { Db } from '../../objects/base';
import * as store from './store';

const LINE = 140;

/** The first line of a block, cut at a word. @internal */
export function firstLine(text: string): string {
  const line = text.split('\n').find((l) => l.trim()) ?? '';
  const t = line.replace(/\s+/g, ' ').trim();
  if (t.length <= LINE) return t;
  const cut = t.slice(0, LINE + 1).lastIndexOf(' ');
  return `${t.slice(0, cut > 60 ? cut : LINE)}…`;
}

interface Row {
  book_id: string;
  pdf_page: number;
  block: number;
  weight: number;
  title: string;
  page_label: string | null;
  text: string;
  blocks_json: string;
  opened: number;
}

export function cited(
  db: Db,
  code: string,
  chapter: number,
  v1: number | null,
  v2: number | null,
  limit: number,
): { cited: CitedBlock[]; total: number } {
  // A verse range overlaps a ref's range; a whole-chapter ref names every verse of it.
  const where = `r.book_code = ? AND r.chapter = ? AND (? IS NULL OR r.v_start IS NULL OR (r.v_start <= ? AND r.v_end >= ?))`;
  const args = [code, chapter, v1, v2, v1];
  const total =
    db.one<{ n: number }>(
      `SELECT count(*) AS n FROM (SELECT DISTINCT r.book_id, r.pdf_page, r.block FROM verse_refs r WHERE ${where})`,
      ...args,
    )?.n ?? 0;
  const rows = db.all<Row>(
    `SELECT r.book_id, r.pdf_page, r.block, max(r.weight) AS weight, b.title, p.page_label, p.text, p.blocks_json,
       coalesce(pos.at, 0) AS opened
     FROM verse_refs r
     JOIN pages p ON p.book_id = r.book_id AND p.pdf_page = r.pdf_page
     JOIN books b ON b.id = r.book_id
     LEFT JOIN positions pos ON pos.book_id = r.book_id
     WHERE ${where}
     GROUP BY r.book_id, r.pdf_page, r.block
     ORDER BY weight DESC, opened DESC, r.pdf_page
     LIMIT ?`,
    ...args,
    limit,
  );
  return {
    total,
    cited: rows.map((r) => {
      const [a, z] = (JSON.parse(r.blocks_json) as [number, number][])[r.block - 1] ?? [0, 0];
      return {
        book_id: r.book_id,
        title: r.title,
        pdf_page: r.pdf_page,
        page_label: r.page_label,
        block: r.block,
        line: firstLine(r.text.slice(a, z)),
        weight: r.weight,
      };
    }),
  };
}

/** The owner's highlights whose verse is in this chapter and overlaps the verses asked for (all of
 * the chapter's, for a chapter). By the `ref` index: the chapter's own ref and its verses' range. */
export function highlightsOn(db: Db, code: string, chapter: number, v1: number | null, v2: number | null): Highlight[] {
  const prefix = `verse:${code}/${chapter}`;
  const ids = db.all<{ id: string; ref: string }>(
    'SELECT id, ref FROM highlights WHERE (ref = ? OR (ref >= ? AND ref < ?)) AND deleted_at IS NULL',
    prefix,
    `${prefix}/`,
    `${prefix}0`,
  );
  return ids
    .filter((h) => {
      const m = /\/(\d+)(?:-(\d+))?$/.exec(h.ref.slice(prefix.length));
      if (!m || v1 === null) return true;
      const a = Number(m[1]);
      const z = m[2] ? Number(m[2]) : a;
      return a <= (v2 ?? v1) && z >= v1;
    })
    .map((h) => store.highlight(db, h.id) as Highlight);
}

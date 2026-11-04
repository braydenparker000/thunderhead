// Where each book the owner read this week stands, for night step 13's next passage (growth.ts
// StudyPlace): the PDF page they left off on, the book's pages, the printed labels of the pages from
// there to a day's pace on, and the highlights made in it since the week began. Ids, numbers and
// page labels only, never a page's text. By key: a position, a book, at most `ahead + 2` pages by
// (book_id, pdf_page), and the book's highlights by its index.
import { GROWTH, type StudyPlace } from '../../../../shared/contract/growth.ts';
import type { Db } from '../../objects/base';

export function placeOf(db: Db, id: string, ahead: number, since: number): StudyPlace {
  const page = db.one<{ pdf_page: number }>('SELECT pdf_page FROM positions WHERE book_id = ?', id)?.pdf_page ?? null;
  const pdf_pages =
    db.one<{ pdf_pages: number | null }>('SELECT pdf_pages FROM books WHERE id = ?', id)?.pdf_pages ?? null;
  const labels: Record<string, string | null> = {};
  if (page !== null) {
    const last = page + Math.min(GROWTH.passage_max, Math.max(1, ahead));
    for (const r of db.all<{ pdf_page: number; page_label: string | null }>(
      'SELECT pdf_page, page_label FROM pages WHERE book_id = ? AND pdf_page >= ? AND pdf_page <= ?',
      id,
      page,
      last,
    ))
      labels[String(r.pdf_page)] = r.page_label;
  }
  const highlights =
    db.one<{ n: number }>(
      'SELECT count(*) AS n FROM highlights WHERE book_id = ? AND created_at >= ? AND deleted_at IS NULL',
      id,
      since,
    )?.n ?? 0;
  return { id, page, pdf_pages, labels, highlights };
}

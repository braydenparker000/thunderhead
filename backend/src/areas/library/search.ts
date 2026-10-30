// Search across the owner's books (STUDY.md §6): FTS5 over `pages_fts` with bm25 ranking, ready
// books only. The owner's words become a query FTS can't misread: each word is a quoted term (all
// must match), a "quoted phrase" stays a phrase, a trailing `*` makes a prefix; everything else FTS
// would treat as syntax is inside quotes. Accents are ignored by the tokenizer. The snippet comes
// back as safe HTML: the page's text escaped, `<mark>` only around the matched words.
import type { SearchHit } from '../../../../shared/contract/library.ts';
import type { Db } from '../../objects/base';

const WORDY = /[\p{L}\p{N}]/u;
const clean = (w: string) => w.replace(/"/g, '');

/** The owner's search as an FTS5 query, or null when it has no word to look for. */
export function ftsQuery(q: string): string | null {
  const parts: string[] = [];
  for (const m of q.matchAll(/"([^"]*)"?|(\S+)/g)) {
    if (m[1] !== undefined) {
      const words = m[1]
        .split(/\s+/)
        .map(clean)
        .filter((w) => WORDY.test(w));
      if (words.length) parts.push(`"${words.join(' ')}"`);
      continue;
    }
    const prefix = m[2].endsWith('*');
    const w = clean(m[2].replace(/\*+$/, ''));
    if (WORDY.test(w)) parts.push(`"${w}"${prefix ? ' *' : ''}`);
  }
  return parts.length ? parts.join(' AND ') : null;
}

// What FTS puts around the matches: a control character and a Unicode noncharacter, a pair no
// extracted page holds. The text is escaped, then they become marks.
const OPEN = '\u0001\uFDD0';
const CLOSE = '\uFDD1\u0001';
const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const markSnippet = (s: string) => escapeHtml(s).replaceAll(OPEN, '<mark>').replaceAll(CLOSE, '</mark>');

/** Up to `limit` hits after `offset`, best first, in ready books (one book when asked). */
export function search(db: Db, match: string, bookId: string | null, limit: number, offset: number): SearchHit[] {
  const rows = db.all<SearchHit>(
    `SELECT p.book_id, p.pdf_page, p.page_label,
       snippet(pages_fts, 0, ?, ?, '…', 12) AS snippet, bm25(pages_fts) AS score
     FROM pages_fts JOIN pages p ON p.seq = pages_fts.rowid
     WHERE pages_fts MATCH ? AND (? IS NULL OR p.book_id = ?)
       AND p.book_id IN (SELECT id FROM books WHERE state = 'ready')
     ORDER BY score, p.seq LIMIT ? OFFSET ?`,
    OPEN,
    CLOSE,
    match,
    bookId,
    bookId,
    limit,
    offset,
  );
  return rows.map((r) => ({ ...r, snippet: markSnippet(r.snippet) }));
}

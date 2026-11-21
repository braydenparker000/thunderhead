// Search across the owner's books (STUDY.md §6): FTS5 with bm25 ranking, ready books only, over
// `pages_stem` (word forms: "prayers" finds "prayer") once it holds every page, else `pages_fts`
// (stems.ts). The owner's words become a query FTS can't misread: each word is a quoted term, a
// "quoted phrase" stays a phrase, a trailing `*` makes a prefix; everything else FTS would treat as
// syntax is inside quotes. All words must match; when no page has them all, any of them may (the
// response says `any`, and its cursor keeps to it). Accents are ignored by the tokenizers. The
// snippet comes back as safe HTML: the page's text escaped, `<mark>` only around the matched words.
import type { LibrarySearchResponse, SearchHit } from '../../../../shared/contract/library.ts';
import type { Db } from '../../objects/base';
import { stemmed } from './stems';
import { notReady } from './store';

const WORDY = /[\p{L}\p{N}]/u;
const clean = (w: string) => w.replace(/"/g, '');

/** The owner's search as an FTS5 query (all words, or with `any` any of them), or null when it has
 * no word to look for. */
export function ftsQuery(q: string, any = false): string | null {
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
  return parts.length ? parts.join(any ? ' OR ' : ' AND ') : null;
}

// What FTS puts around the matches: a control character and a Unicode noncharacter, a pair no
// extracted page holds. The text is escaped, then they become marks.
const OPEN = '\u0001\uFDD0';
const CLOSE = '\uFDD1\u0001';
const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const markSnippet = (s: string) => escapeHtml(s).replaceAll(OPEN, '<mark>').replaceAll(CLOSE, '</mark>');

/** Up to `limit` hits after `offset`, best first, in ready books (one book when asked). */
export function search(
  db: Db,
  match: string,
  bookId: string | null,
  limit: number,
  offset: number,
  table: 'pages_fts' | 'pages_stem' = 'pages_fts',
): SearchHit[] {
  const rows = db.all<SearchHit>(
    `SELECT p.book_id, p.pdf_page, p.page_label,
       snippet(${table}, 0, ?, ?, '…', 12) AS snippet, bm25(${table}) AS score
     FROM ${table} JOIN pages p ON p.seq = ${table}.rowid
     WHERE ${table} MATCH ? AND (? IS NULL OR p.book_id = ?)
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

/** GET /v1/library/search: a page of hits. The cursor is `o<offset>` (all words) or `r<offset>`
 * (any word, after all of them found nothing), so "More" goes on past the first page as it began. */
export function searchBooks(
  db: Db,
  q: string,
  bookId: string | null,
  limit: number,
  cursor: string | null,
): LibrarySearchResponse {
  const all = ftsQuery(q);
  if (!all) return { items: [], next: null, not_ready: 0 };
  const table = stemmed(db) ? 'pages_stem' : 'pages_fts';
  let any = cursor?.startsWith('r') ?? false;
  const offset = cursor ? Number(cursor.slice(1)) : 0;
  let items = search(db, any ? (ftsQuery(q, true) as string) : all, bookId, limit + 1, offset, table);
  const either = ftsQuery(q, true) as string;
  if (!items.length && !any && !offset && either !== all) {
    any = true;
    items = search(db, either, bookId, limit + 1, 0, table);
  }
  const more = items.length > limit;
  return {
    items: items.slice(0, limit),
    next: more ? `${any ? 'r' : 'o'}${offset + limit}` : null,
    not_ready: notReady(db),
    ...(any && items.length ? { any: true } : {}),
  };
}

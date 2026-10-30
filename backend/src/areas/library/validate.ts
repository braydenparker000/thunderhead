// The Library's request shapes (STUDY.md §3, §5.4, §5.5; API.md §11.21), checked once at the edge.
// A page's blocks must be in order inside its text and its refs must name one of them; a verse
// ref's shape is checked here, and against the private book table once the parser lands (P7
// step 4). Titles, quotes and notes are the owner's words: kept as given, never logged.
import * as z from 'zod/mini';
import { LIBRARY_LIMITS as L, type PageIn } from '../../../../shared/contract/library.ts';
import { ApiError } from '../../http/errors';

export const UUID7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const id = z.string().check(z.regex(UUID7));
const int = (min: number, max: number) => z.number().check(z.int(), z.gte(min), z.lte(max));
const ms = int(0, 8.64e15);
const page = int(1, 100_000);
const text = (max: number, min = 1) => z.string().check(z.minLength(min), z.maxLength(max));
const kind = z.enum(['book', 'manual', 'other']);
const language = z.string().check(z.regex(/^[a-z]{3}(\+[a-z]{3}){0,3}$/));
/** `verse:<code>/<chapter>[/<v>[-<v>]]` (STUDY.md §1.1). */
export const VERSE_REF = /^verse:[a-z0-9]+(-[a-z0-9]+)*\/[1-9]\d{0,3}(\/[1-9]\d{0,3}(-[1-9]\d{0,3})?)?$/;
const verseRef = z.string().check(z.regex(VERSE_REF));

export const createBody = z.strictObject({
  id,
  title: text(L.title_chars),
  author: z.optional(z.nullable(text(L.author_chars))),
  kind: z.optional(kind),
  language: z.optional(language),
  bytes: int(1, L.book_bytes),
});

export const editBody = z.strictObject({
  title: z.optional(text(L.title_chars)),
  author: z.optional(z.nullable(text(L.author_chars))),
  kind: z.optional(kind),
  language: z.optional(language),
});

export const positionBody = z.strictObject({
  pdf_page: page,
  scroll_frac: z.number().check(z.gte(0), z.lte(1)),
  at: ms,
});

const rect = z.tuple([
  z.number().check(z.gte(0), z.lte(1)),
  z.number().check(z.gte(0), z.lte(1)),
  z.number().check(z.gte(0), z.lte(1)),
  z.number().check(z.gte(0), z.lte(1)),
]);
export const highlightBody = z.strictObject({
  book_id: id,
  pdf_page: page,
  quote: text(L.quote_chars, 0),
  prefix: text(L.affix_chars, 0),
  suffix: text(L.affix_chars, 0),
  rects: z.nullable(z.array(rect).check(z.minLength(1), z.maxLength(L.rects_per_highlight))),
  color: z.enum(['green', 'gold', 'blue', 'rose']),
  note: z.nullable(text(L.note_chars, 0)),
  ref: z.nullable(verseRef),
  created_at: ms,
  updated_at: ms,
  deleted_at: z.nullable(ms),
});

export const searchQuery = z.object({
  q: text(L.search_q_chars, 2),
  book_id: z.optional(id),
  limit: z.optional(z.coerce.number().check(z.int(), z.gte(1), z.lte(L.search_hits))),
  cursor: z.optional(z.string().check(z.regex(/^o\d{1,5}$/))),
});

const pageRef = z.strictObject({
  block: int(1, L.blocks_per_page),
  book_code: z.string().check(z.regex(/^[a-z0-9]+(-[a-z0-9]+)*$/), z.maxLength(40)),
  chapter: int(1, 9_999),
  v_start: z.nullable(int(1, 9_999)),
  v_end: z.nullable(int(1, 9_999)),
  weight: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  in_heading: z.boolean(),
});
const pageIn = z.strictObject({
  pdf_page: page,
  page_label: z.nullable(text(24)),
  text: text(L.page_chars, 0),
  blocks: z.array(z.tuple([int(0, L.page_chars), int(0, L.page_chars)])).check(z.maxLength(L.blocks_per_page)),
  ocr: z.boolean(),
  ocr_conf: z.nullable(z.number().check(z.gte(0), z.lte(100))),
  refs: z.array(pageRef).check(z.maxLength(L.refs_per_page)),
});
export const pagesBody = z.strictObject({
  job_id: id,
  pages: z.array(pageIn).check(z.minLength(1), z.maxLength(L.pages_batch)),
});

export const ingestBody = z.strictObject({
  state: z.enum(['extracting', 'ocr', 'indexing', 'paused', 'ready', 'failed']),
  cursor: z.optional(int(0, 100_000)),
  pdf_pages: z.optional(page),
  sha256: z.optional(z.string().check(z.regex(/^[0-9a-f]{64}$/))),
  reason: z.optional(text(200)),
});

/** A page's blocks in order inside its text, and refs that name one of them with verses in order. */
export function checkPages(pages: PageIn[]): void {
  const issues: { path: string; issue: string }[] = [];
  const seen = new Set<number>();
  pages.forEach((p, i) => {
    if (seen.has(p.pdf_page)) issues.push({ path: `pages.${i}.pdf_page`, issue: 'twice in one batch' });
    seen.add(p.pdf_page);
    let end = 0;
    for (const [a, b] of p.blocks)
      if (a < end || b <= a || b > p.text.length) {
        issues.push({ path: `pages.${i}.blocks`, issue: 'in order, not empty, inside the text' });
        break;
      } else end = b;
    p.refs.forEach((r, k) => {
      const verses = r.v_start === null ? r.v_end === null : r.v_end !== null && r.v_end >= r.v_start;
      if (r.block > p.blocks.length || !verses)
        issues.push({ path: `pages.${i}.refs.${k}`, issue: 'a block of this page, verses in order' });
    });
  });
  if (issues.length) throw new ApiError('validation', issues);
}

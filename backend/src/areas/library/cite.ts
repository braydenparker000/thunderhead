// Answers from the owner's own books (STUDY.md §8): the candidate blocks for a question, and the
// check every cited answer passes before it is stored. Candidates are the blocks whose verse refs
// name a verse the question names (best weight first), then the blocks of the pages that best match
// the question's words (bm25), at most 20, each `book:<id>#p<n>.b<k>` with its label and text. The
// same question always gives the same candidates, so the check runs them again instead of keeping
// them. The check (§8.2): a sentence without a marker, or with only markers outside the candidates,
// is dropped; a quote must be in one of its sentence's blocks, one sentence and at most 40 words;
// at most 8 sentences; with nothing left, one plain line says so.
import type { CiteCandidate, CiteMeta } from '../../../../shared/contract/library.ts';
import type { Db } from '../../objects/base';

export const MAX_CANDIDATES = 20;
const VERSE_BLOCKS = 10;
const PAGE_HITS = 10;
const BLOCK_CHARS = 1_500;
const MAX_SENTENCES = 8;
const MAX_QUOTE_WORDS = 40;
export const NOTHING = "I couldn't find this in your books.";

const STOP = new Set(
  "the and for are but not you all any can had her was one our out has him his how its may new now old see two who did get let say she too use what when where which while with will would about above after again could does from have into just like more most much must only other over said same should some such than that their them then there these they this those through under very were your what's books book my me do say says tell about".split(
    ' ',
  ),
);

/** The question's words worth looking for, as an FTS5 query ("a" OR "b"), or null. */
export function citeQuery(q: string): string | null {
  const words = [
    ...new Set(
      (q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w)),
    ),
  ].slice(0, 8);
  return words.length ? words.map((w) => `"${w}"`).join(' OR ') : null;
}

const pageName = (n: number, label: string | null) => (label ? `p. ${label}` : `PDF p. ${n}`);

interface PageRow {
  book_id: string;
  pdf_page: number;
  page_label: string | null;
  text: string;
  blocks_json: string;
  title: string;
}

const candidate = (r: PageRow, block: number): CiteCandidate => {
  const [a, z] = (JSON.parse(r.blocks_json) as [number, number][])[block - 1] ?? [0, 0];
  return {
    ref: `book:${r.book_id}#p${r.pdf_page}.b${block}`,
    label: `${r.title}, ${pageName(r.pdf_page, r.page_label)}`,
    text: r.text.slice(a, z).slice(0, BLOCK_CHARS),
  };
};

const PAGE = `SELECT p.book_id, p.pdf_page, p.page_label, p.text, p.blocks_json, b.title
  FROM pages p JOIN books b ON b.id = p.book_id`;

/** The block of a page with the most of the question's words. */
function bestBlock(r: PageRow, words: string[]): number {
  const blocks = JSON.parse(r.blocks_json) as [number, number][];
  let best = 1;
  let most = -1;
  blocks.forEach(([a, z], i) => {
    const t = r.text.slice(a, z).toLowerCase();
    const n = words.reduce((s, w) => s + (t.includes(w) ? 1 : 0), 0);
    if (n > most) [best, most] = [i + 1, n];
  });
  return best;
}

/** The candidates in the Library: verse blocks first (`verses` from the parser), then FTS pages. */
export function candidatesOf(
  db: Db,
  verses: { code: string; chapter: number; v1: number | null; v2: number | null }[],
  match: string | null,
): CiteCandidate[] {
  const out = new Map<string, CiteCandidate>();
  for (const v of verses) {
    const rows = db.all<PageRow & { block: number }>(
      `SELECT r.block, max(r.weight) AS weight, p.book_id, p.pdf_page, p.page_label, p.text, p.blocks_json, b.title
       FROM verse_refs r JOIN pages p ON p.book_id = r.book_id AND p.pdf_page = r.pdf_page JOIN books b ON b.id = r.book_id
       WHERE r.book_code = ? AND r.chapter = ? AND (? IS NULL OR r.v_start IS NULL OR (r.v_start <= ? AND r.v_end >= ?))
       GROUP BY r.book_id, r.pdf_page, r.block ORDER BY weight DESC, r.pdf_page LIMIT ?`,
      v.code,
      v.chapter,
      v.v1,
      v.v2 ?? v.v1,
      v.v1,
      VERSE_BLOCKS,
    );
    for (const r of rows) {
      const c = candidate(r, r.block);
      out.set(c.ref, c);
    }
  }
  if (match) {
    const words = [...match.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    const rows = db.all<PageRow>(
      `${PAGE} JOIN pages_fts f ON f.rowid = p.seq
       WHERE pages_fts MATCH ? AND b.state = 'ready' ORDER BY bm25(pages_fts), p.seq LIMIT ?`,
      match,
      PAGE_HITS,
    );
    for (const r of rows) {
      const c = candidate(r, bestBlock(r, words));
      if (!out.has(c.ref)) out.set(c.ref, c);
    }
  }
  return [...out.values()].slice(0, MAX_CANDIDATES);
}

const MARK = /\[\[(book:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}#p\d{1,5}\.b\d{1,4})\]\]/g;
const ANY_MARK = /\[\[[^\]]*\]\]/g;
const norm = (s: string) =>
  s
    .replace(/[“”„"]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

/** The answer as sentences, each with the markers that follow its stop. "p. 212" and "2 Bet. 4:7"
 * don't end one: a stop ends a sentence only before a capital, a quote, a marker or the end. */
export function sentences(text: string): string[] {
  const out: string[] = [];
  const stop = /[.!?]["”’)]?(?=\s*$|\s+[\p{Lu}"“‘'([])/gu;
  let i = 0;
  while (i < text.length) {
    stop.lastIndex = i;
    const m = stop.exec(text);
    let end = m ? m.index + m[0].length : text.length;
    const after = /^(?:\s*\[\[[^\]]*\]\])+/.exec(text.slice(end));
    if (after) end += after[0].length;
    out.push(text.slice(i, end));
    i = end;
  }
  return out.filter((s) => s.trim());
}

/** A cited answer as it may be stored (§8.2). */
export function checkAnswer(body: string, candidates: CiteCandidate[]): { body: string; cite: Omit<CiteMeta, 'q'> } {
  const known = new Map(candidates.map((c) => [c.ref, c]));
  const kept: string[] = [];
  const used: string[] = [];
  let dropped = 0;
  for (const s of sentences(body)) {
    const refs = [...s.matchAll(MARK)].map((m) => m[1]).filter((r) => known.has(r));
    const text = s
      .replace(ANY_MARK, (m) => (refs.some((r) => m === `[[${r}]]`) ? m : ''))
      .replace(/[ \t]+([.!?,;:])/g, '$1');
    const blocks = refs.map((r) => norm((known.get(r) as CiteCandidate).text));
    const quotes = [...text.matchAll(/[“"]([^”"]+)[”"]/g)].map((m) => norm(m[1]));
    const quoteOk = (q: string) =>
      q.split(' ').length <= MAX_QUOTE_WORDS && !/[.!?]\s+\p{Lu}/u.test(q) && blocks.some((b) => b.includes(q));
    if (!refs.length || !quotes.every(quoteOk) || kept.length >= MAX_SENTENCES) {
      dropped++;
      continue;
    }
    kept.push(text);
    for (const r of refs) if (!used.includes(r)) used.push(r);
  }
  if (!kept.length) return { body: NOTHING, cite: { citations: [], dropped } };
  return {
    body: kept.join('').trim(),
    cite: { citations: used.map((r) => ({ ref: r, label: (known.get(r) as CiteCandidate).label })), dropped },
  };
}

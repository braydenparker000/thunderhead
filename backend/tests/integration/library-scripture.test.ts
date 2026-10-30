// P7 step 4: the owner's scripture table and text in the private bucket (STUDY.md §7.1, §7.6), the
// verse refs the Worker stores (no table, no refs; never a verse that isn't there), and "Cited in
// your books" with the owner's highlights on a verse. The table is the invented one of
// tests/study/table.json; no real book table or verse text is in the repository.
import { env, exports } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import type {
  IngestClaim,
  PageTextResponse,
  VerseResponse,
  VerseTextResponse,
} from '../../../shared/contract/library.ts';
import table from '../../../tests/study/table.json';
import { uuidv7 } from '../../src/lib/ids';
import { api, apiJson } from '../helpers';
import { type Principals, principals } from '../memory-helpers';

let p: Principals;
let book = '';
let job = '';
const PDF = new TextEncoder().encode('%PDF-1.4\n% a synthetic book\n%%EOF\n');
const page = (n: number, text: string, refs: object[] = []) => ({
  pdf_page: n,
  page_label: String(n),
  text,
  blocks: [[0, text.length]],
  ocr: false,
  ocr_conf: null,
  refs,
});
const ref = (chapter: number, v_start: number | null, v_end: number | null, weight = 2) => ({
  block: 1,
  book_code: 'a',
  chapter,
  v_start,
  v_end,
  weight,
  in_heading: false,
});
const pages = (list: object[]) =>
  apiJson<{ written: number; refs: number }>('PUT', `/v1/library/books/${book}/pages`, {
    token: p.N,
    body: { job_id: job, pages: list },
  });

beforeAll(async () => {
  p = await principals();
  book = uuidv7();
  await apiJson('POST', '/v1/library/books', {
    token: p.D,
    body: { id: book, title: 'A Synthetic Commentary', bytes: PDF.length },
  });
  await exports.default.fetch(
    new Request(`https://api.example.test/v1/library/books/${book}/parts/1`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${p.D}`,
        'CF-Connecting-IP': '192.0.2.10',
        'Content-Length': String(PDF.length),
      },
      body: PDF,
    }),
  );
  await apiJson('POST', `/v1/library/books/${book}/complete`, { token: p.D });
  job = (await apiJson<IngestClaim>('POST', '/v1/library/ingest/claim', { token: p.N })).body.job.id;
});

describe('the private table and text', () => {
  it('no table yet: none to read, and no verse ref is stored', async () => {
    expect((await api('GET', '/v1/library/scripture', { token: p.D })).status).toBe(404);
    const r = await pages([page(1, 'On Book A 3:12 at length.', [ref(3, 12, 12)])]);
    expect([
      r.status,
      (r.body as unknown as { error: { details: { issue: string }[] } }).error.details[0].issue,
    ]).toEqual([422, 'no scripture table yet']);
  });

  it('the mind stores the table, checked by the parser; the phone reads it with its ETag', async () => {
    expect((await api('PUT', '/v1/library/scripture', { token: p.D, body: table })).status).toBe(403);
    const bad = structuredClone(table);
    bad.books[0].verses.pop();
    expect((await api('PUT', '/v1/library/scripture', { token: p.N, body: bad })).status).toBe(422);
    const put = await apiJson<{ books: number }>('PUT', '/v1/library/scripture', { token: p.N, body: table });
    expect(put.body.books).toBe(7);
    const got = await api('GET', '/v1/library/scripture', { token: p.D });
    expect(got.status).toBe(200);
    expect(((await got.json()) as typeof table).books.map((b) => b.code)).toContain('2-beta');
    const etag = got.headers.get('ETag') ?? '';
    expect((await api('GET', '/v1/library/scripture', { token: p.D, headers: { 'If-None-Match': etag } })).status).toBe(
      304,
    );
    expect(await env.VAULT.head('study/scripture.json')).not.toBeNull();
  });

  it('one book’s text, every verse checked against the table; a chapter read back', async () => {
    const text = { chapters: { '3': { '12': 'An invented verse twelve.', '13': 'An invented verse thirteen.' } } };
    expect((await api('PUT', '/v1/library/scripture/text/a', { token: p.N, body: text })).status).toBe(200);
    const over = { chapters: { '3': { '25': 'No such verse.' } } };
    expect((await api('PUT', '/v1/library/scripture/text/a', { token: p.N, body: over })).status).toBe(422);
    expect((await api('PUT', '/v1/library/scripture/text/zeta', { token: p.N, body: text })).status).toBe(422);
    const back = await apiJson<VerseTextResponse>('GET', '/v1/library/scripture/text/a/3', { token: p.D });
    expect(back.body).toEqual({ code: 'a', chapter: 3, verses: text.chapters['3'] });
    expect((await api('GET', '/v1/library/scripture/text/a/4', { token: p.D })).status).toBe(404);
  });
});

describe('verse refs and "Cited in your books"', () => {
  it('stores only refs to verses that exist', async () => {
    expect((await pages([page(1, 'x', [ref(3, 25, 25)])])).status).toBe(422);
    expect((await pages([page(1, 'x', [ref(9, null, null)])])).status).toBe(422);
    const r = await pages([
      page(1, 'Book A 3:12 is the heart of it.\nMore on the same verse follows.', [ref(3, 12, 12, 3)]),
      page(2, 'A list: Book A 3:10–14 and Book A 4:2.', [ref(3, 10, 14, 1), ref(4, 2, 2, 1)]),
      page(3, 'The whole of Book A 3 is about morning.', [ref(3, null, null, 2)]),
    ]);
    expect(r.body).toEqual({ written: 3, refs: 4 });
    expect(
      (
        await apiJson('PATCH', `/v1/library/ingest/${job}`, {
          token: p.N,
          body: { state: 'ready', pdf_pages: 3, sha256: 'c'.repeat(64) },
        })
      ).status,
    ).toBe(200);
  });

  it('finds the blocks that cite a verse (a range around it, its whole chapter), best first, with its highlights', async () => {
    const now = Date.now();
    const h = {
      book_id: book,
      pdf_page: 1,
      quote: 'the heart of it',
      prefix: '',
      suffix: '',
      rects: null,
      color: 'gold',
      note: null,
      ref: 'verse:a/3/12',
      created_at: now,
      updated_at: now,
      deleted_at: null,
    };
    expect((await api('PUT', `/v1/library/highlights/${uuidv7()}`, { token: p.D, body: h })).status).toBe(200);
    expect(
      (await api('PUT', `/v1/library/highlights/${uuidv7()}`, { token: p.D, body: { ...h, ref: 'verse:a/3/25' } }))
        .status,
    ).toBe(422);
    const v = await apiJson<VerseResponse>('GET', '/v1/library/verses/a/3?v=12', { token: p.D });
    expect(v.body.ref).toBe('verse:a/3/12');
    expect(v.body.total).toBe(3);
    expect(v.body.cited.map((c) => [c.pdf_page, c.weight])).toEqual([
      [1, 3],
      [3, 2],
      [2, 1],
    ]);
    expect(v.body.cited[0]).toMatchObject({
      title: 'A Synthetic Commentary',
      page_label: '1',
      line: 'Book A 3:12 is the heart of it.',
    });
    expect(v.body.highlights.map((x) => x.quote)).toEqual(['the heart of it']);
    // Verse 2 of chapter 4: only its own block; a verse outside every range: the chapter's.
    expect((await apiJson<VerseResponse>('GET', '/v1/library/verses/a/4?v=2', { token: p.N })).body.total).toBe(1);
    expect(
      (await apiJson<VerseResponse>('GET', '/v1/library/verses/a/3?v=20', { token: p.C })).body.cited.map(
        (c) => c.pdf_page,
      ),
    ).toEqual([3]);
    expect((await api('GET', '/v1/library/verses/a/3?v=25', { token: p.D })).status).toBe(404);
    expect((await api('GET', '/v1/library/verses/zeta/1', { token: p.D })).status).toBe(404);
  });
});

describe("a book's stored text, for the mind", () => {
  it('reads pages from a number on, 50 at most a call; the mind only', async () => {
    const r = await apiJson<PageTextResponse>('GET', `/v1/library/books/${book}/pages?from=2&limit=1`, { token: p.N });
    expect(r.body).toEqual({
      items: [{ pdf_page: 2, page_label: '2', text: 'A list: Book A 3:10–14 and Book A 4:2.' }],
      next: 3,
    });
    const all = await apiJson<PageTextResponse>('GET', `/v1/library/books/${book}/pages`, { token: p.C });
    expect([all.body.items.map((x) => x.pdf_page), all.body.next]).toEqual([[1, 2, 3], null]);
    expect((await api('GET', `/v1/library/books/${book}/pages`, { token: p.D })).status).toBe(403);
    expect((await api('GET', `/v1/library/books/${uuidv7()}/pages`, { token: p.N })).status).toBe(404);
  });
});

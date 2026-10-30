// P7 step 6: answers from the owner's own books (STUDY.md §8). The mind asks for a question's
// candidate blocks (a verse's cited blocks first, then the pages that best match the question's
// words), writes an answer whose every sentence names its blocks, and the Worker keeps only what
// those blocks back before the message is stored. The table is the invented one; the book is
// synthetic.
import { exports } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Message } from '../../../shared/contract/api';
import type { CiteCandidate, CiteResponse, IngestClaim } from '../../../shared/contract/library.ts';
import { checkAnswer, NOTHING, sentences } from '../../src/areas/library/cite';
import { uuidv7 } from '../../src/lib/ids';
import { api, apiJson } from '../helpers';
import { as, CHAT_SESSION, type Principals, principals } from '../memory-helpers';
import { storeScripture } from '../scripture-helpers';

let p: Principals;
let book = '';
const PDF = new TextEncoder().encode('%PDF-1.4\n% a synthetic book for answers\n%%EOF\n');
const VERSE_BLOCK = 'Book A 3:12 speaks of patience at dawn, and the writer returns to it often.';
const OTHER = 'An unrelated first block about weather, long enough to stand as a block of its own here.';
const TOPIC = 'Patience grows in quiet mornings; the habit of waiting is learned slowly over years.';

beforeAll(async () => {
  p = await principals();
  await storeScripture();
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
  const job = (await apiJson<IngestClaim>('POST', '/v1/library/ingest/claim', { token: p.N })).body.job.id;
  const page = (n: number, blocks: string[], refs: object[] = []) => {
    const text = blocks.join('\n\n');
    let at = 0;
    const spans = blocks.map((b) => {
      const s = [at, at + b.length];
      at += b.length + 2;
      return s;
    });
    return { pdf_page: n, page_label: String(n + 10), text, blocks: spans, ocr: false, ocr_conf: null, refs };
  };
  const ref = { block: 1, book_code: 'a', chapter: 3, v_start: 12, v_end: 12, weight: 3, in_heading: true };
  const put = await apiJson('PUT', `/v1/library/books/${book}/pages`, {
    token: p.N,
    body: { job_id: job, pages: [page(1, [VERSE_BLOCK], [ref]), page(2, [OTHER, TOPIC])] },
  });
  expect(put.status).toBe(200);
  await apiJson('PATCH', `/v1/library/ingest/${job}`, {
    token: p.N,
    body: { state: 'ready', pdf_pages: 2, sha256: 'd'.repeat(64) },
  });
});

const cite = (q: string, token = p.C) =>
  apiJson<CiteResponse>('GET', `/v1/library/cite?q=${encodeURIComponent(q)}`, { token });

describe('the candidates', () => {
  it("a verse's cited blocks first, then the pages that best match the other words, at the block that matches", async () => {
    const r = await cite('What do my books say about Book A 3:12 and quiet mornings?');
    expect(r.body.candidates.map((c) => [c.ref, c.label])).toEqual([
      [`book:${book}#p1.b1`, 'A Synthetic Commentary, p. 11'],
      [`book:${book}#p2.b2`, 'A Synthetic Commentary, p. 12'],
    ]);
    expect(r.body.candidates[1].text).toBe(TOPIC);
    expect((await cite('what do my books say')).body.candidates).toEqual([]);
    expect((await cite('patience', p.D)).status).toBe(403);
    expect((await api('GET', '/v1/library/cite?q=', { token: p.N })).status).toBe(422);
  });
});

describe('the check (STUDY.md §8.2)', () => {
  const C: CiteCandidate[] = [
    { ref: `book:${'0'.repeat(8)}-0000-7000-8000-${'0'.repeat(12)}#p4.b1`, label: 'A, p. 4', text: TOPIC },
    { ref: `book:${'0'.repeat(8)}-0000-7000-8000-${'0'.repeat(12)}#p5.b2`, label: 'A, p. 5', text: VERSE_BLOCK },
  ];
  const [a, b] = C.map((c) => `[[${c.ref}]]`);

  it('keeps cited sentences; drops one with no marker or only unknown ones; "p. 12" is not a stop', () => {
    const unknown = `[[book:${'1'.repeat(8)}-0000-7000-8000-${'0'.repeat(12)}#p9.b1]]`;
    const r = checkAnswer(
      `On p. 12 the commentary ties patience to mornings ${a}. This has no source. This cites nothing real ${unknown}. Both agree ${a}${b}.`,
      C,
    );
    expect(r.body).toBe(`On p. 12 the commentary ties patience to mornings ${a}. Both agree ${a}${b}.`);
    expect(r.cite).toEqual({ citations: C.map((c) => ({ ref: c.ref, label: c.label })), dropped: 2 });
  });

  it('a quote must be in its own blocks, one sentence, at most 40 words', () => {
    expect(checkAnswer(`It says “the habit of waiting is learned slowly” ${a}.`, C).cite.dropped).toBe(0);
    expect(checkAnswer(`It says “the habit of waiting is learned quickly” ${a}.`, C).body).toBe(NOTHING);
    expect(checkAnswer(`It says “speaks of patience at dawn” ${a}.`, C).body).toBe(NOTHING);
    const long = Array.from({ length: 41 }, () => 'word').join(' ');
    expect(checkAnswer(`It says “${long}” ${a}.`, [{ ...C[0], text: long }]).body).toBe(NOTHING);
  });

  it('at most 8 sentences; nothing left is one plain line', () => {
    const many = Array.from({ length: 10 }, (_, i) => `Point ${i + 1} ${a}.`).join(' ');
    expect(sentences(checkAnswer(many, C).body)).toHaveLength(8);
    expect(checkAnswer('No markers at all.', C)).toEqual({ body: NOTHING, cite: { citations: [], dropped: 1 } });
  });
});

describe('a cited answer in the conversation', () => {
  const say = (body: string, meta: object | undefined, token = p.C) =>
    apiJson<Message>('PUT', `/v1/messages/${uuidv7()}`, { ...as(token, CHAT_SESSION), token, body: { body, meta } });

  it('is stored as checked, with its citations; without its question it is refused; the owner’s own words are untouched', async () => {
    const q = 'What do my books say about Book A 3:12?';
    const [m] = (await cite(q)).body.candidates.map((c) => `[[${c.ref}]]`);
    const r = await say(`The commentary ties the verse to patience at dawn ${m}. Something uncited.`, { cite: { q } });
    expect(r.status).toBe(201);
    expect(r.body.body).toBe(`The commentary ties the verse to patience at dawn ${m}.`);
    expect(r.body.meta).toEqual({
      cite: { q, citations: [{ ref: `book:${book}#p1.b1`, label: 'A Synthetic Commentary, p. 11' }], dropped: 1 },
    });
    expect((await say(`Cited ${m}.`, undefined)).status).toBe(422);
    const own = await apiJson<Message>('PUT', `/v1/messages/${uuidv7()}`, {
      token: p.D,
      body: { body: `Look at ${m} again` },
    });
    expect(own.body.body).toBe(`Look at ${m} again`);
  });
});

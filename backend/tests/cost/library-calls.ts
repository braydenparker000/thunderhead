// The P7 library calls of the cost suite (cost.test.ts checks every budget), metered in the Library
// object: the book list, a reading place (new, then moved), a highlight, a search, and one page of
// about 300 words with two references, which is the FTS write cost per page (DATA.md open question
// D3). The book is uploaded and read through the routes first.
import { env, exports } from 'cloudflare:workers';
import type { NewAgentResponse, SignedIn } from '../../../shared/contract/api';
import type { IngestClaim } from '../../../shared/contract/library.ts';
import { uuidv7 } from '../../src/lib/ids';
import { api, apiJson, PASSWORD } from '../helpers';

type Cost = (name: string, fn: () => Promise<Response>, status: number, stub?: never) => Promise<void>;

const WORDS = 'the light of morning falls across the quiet valley where a river turns slowly'.split(' ');
const words = (n: number) => Array.from({ length: n }, (_, i) => WORDS[i % WORDS.length]).join(' ');

export async function libraryCalls(cost: Cost, grant: (ip: string, password?: string) => Promise<SignedIn>) {
  const d = await grant('192.0.2.252', `${PASSWORD} new`);
  const night = (
    await apiJson<NewAgentResponse>('POST', '/v1/auth/agents', {
      token: d.token,
      body: { name: 'night-cost-7', role: 'mind:night', current_password: `${PASSWORD} new` },
    })
  ).body.token;
  const stub = env.LIBRARY.get(env.LIBRARY.idFromName('owner')) as unknown as never;
  const id = uuidv7();
  const pdf = new TextEncoder().encode('%PDF-1.4\n% a synthetic book for the cost suite\n%%EOF\n');
  await api('POST', '/v1/library/books', { token: d.token, body: { id, title: 'Cost book', bytes: pdf.byteLength } });
  await exports.default.fetch(
    new Request(`https://api.example.test/v1/library/books/${id}/parts/1`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${d.token}`,
        'CF-Connecting-IP': '192.0.2.10',
        'Content-Length': String(pdf.byteLength),
      },
      body: pdf,
    }),
  );
  await api('POST', `/v1/library/books/${id}/complete`, { token: d.token });
  const claim = (await apiJson<IngestClaim>('POST', '/v1/library/ingest/claim', { token: night })).body;
  const page = (n: number, text: string) => ({
    pdf_page: n,
    page_label: String(n),
    text,
    blocks: [[0, text.length]],
    ocr: false,
    ocr_conf: null,
    refs: [
      { block: 1, book_code: 'a', chapter: 3, v_start: 12, v_end: 12, weight: 2, in_heading: false },
      { block: 1, book_code: 'a', chapter: 4, v_start: 1, v_end: 3, weight: 1, in_heading: false },
    ],
  });
  await api('PUT', `/v1/library/books/${id}/pages`, {
    token: night,
    body: { job_id: claim.job.id, pages: [page(1, words(300)), page(2, words(300))] },
  });
  await cost(
    'PUT /v1/library/books/:id/pages (one page, 300 words, 2 refs)',
    () =>
      api('PUT', `/v1/library/books/${id}/pages`, {
        token: night,
        body: { job_id: claim.job.id, pages: [page(3, `${words(299)} evening`)] },
      }),
    200,
    stub,
  );
  await api('PATCH', `/v1/library/ingest/${claim.job.id}`, {
    token: night,
    body: { state: 'ready', pdf_pages: 3, sha256: 'b'.repeat(64) },
  });
  await cost('GET /v1/library/books (1 book)', () => api('GET', '/v1/library/books', { token: d.token }), 200, stub);
  await cost(
    'GET /v1/library/search (1 hit of 3 pages)',
    () => api('GET', '/v1/library/search?q=evening', { token: d.token }),
    200,
    stub,
  );
  const at = Date.now();
  const place = (pdf_page: number, t: number) =>
    api('PUT', `/v1/library/positions/${id}`, { token: d.token, body: { pdf_page, scroll_frac: 0.5, at: t } });
  await cost('PUT /v1/library/positions/:book_id (first)', () => place(2, at), 200, stub);
  await cost('PUT /v1/library/positions/:book_id (moved)', () => place(3, at + 30_000), 200, stub);
  const h = {
    book_id: id,
    pdf_page: 2,
    quote: 'falls across the quiet valley',
    prefix: 'the light of morning ',
    suffix: ' where a river turns',
    rects: [[0.1, 0.3, 0.6, 0.02]],
    color: 'green',
    note: null,
    ref: null,
    created_at: at,
    updated_at: at,
    deleted_at: null,
  };
  await cost(
    'PUT /v1/library/highlights/:id (new)',
    () => api('PUT', `/v1/library/highlights/${uuidv7()}`, { token: d.token, body: h }),
    200,
    stub,
  );
}

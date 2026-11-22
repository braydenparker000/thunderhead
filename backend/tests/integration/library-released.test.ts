// A run that fails on its own side (its page reader, the network) releases its claim (2026-11-21:
// a book's first run claimed it, then its Python failed, and the retry had to wait for the claim
// to lapse): the book waits again at once, from where it was, with its attempts unchanged.
import { exports } from 'cloudflare:workers';
import { beforeAll, expect, it } from 'vitest';
import type { Book, IngestClaim } from '../../../shared/contract/library.ts';
import { uuidv7 } from '../../src/lib/ids';
import { apiJson } from '../helpers';
import { type Principals, principals } from '../memory-helpers';

let p: Principals;
const PDF = new TextEncoder().encode(`%PDF-1.4\n${'a book to read '.repeat(60)}\n%%EOF\n`);

beforeAll(async () => {
  p = await principals();
});

it('a released run is claimed again at once, at the same cursor and attempts', async () => {
  const id = uuidv7();
  await apiJson('POST', '/v1/library/books', { token: p.D, body: { id, title: 'A book', bytes: PDF.byteLength } });
  await exports.default.fetch(
    new Request(`https://api.example.test/v1/library/books/${id}/parts/1`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${p.D}`,
        'CF-Connecting-IP': '192.0.2.10',
        'Content-Length': String(PDF.byteLength),
      },
      body: PDF,
    }),
  );
  await apiJson('POST', `/v1/library/books/${id}/complete`, { token: p.D });
  const c = await apiJson<IngestClaim>('POST', '/v1/library/ingest/claim', { token: p.N });
  expect(c.status).toBe(200);
  const r = await apiJson<{ book: Book }>('PATCH', `/v1/library/ingest/${c.body.job.id}`, {
    token: p.N,
    body: { state: 'released', cursor: 0 },
  });
  expect(r.status).toBe(200);
  expect(r.body.book.state).toBe('queued');
  const again = await apiJson<IngestClaim>('POST', '/v1/library/ingest/claim', { token: p.N });
  expect(again.status).toBe(200);
  expect(again.body.job).toMatchObject({ id: c.body.job.id, cursor: 0, attempts: c.body.job.attempts });
});
